/**
 * Draft artist cards with their claim (overlay-templates issue 3, H25), for
 * Matas to judge the bands and the claim size. Local only: the cards go to
 * --out and nowhere else — this script has no Drive or Storage path, and a
 * watermarked card can't be exported (claim-approval.ts assertExportable).
 *
 *   node --max-old-space-size=12288 --env-file=.env.local --experimental-strip-types scripts/cta-drafts.mts \
 *     --event P26-BDAY --kit outputs/P26-BDAY/kits/puzzle-birthday-1-static --out <notes folder> \
 *     --pick 'Luke Dean#1=<asset id>' --pick 'Luke Dean#2=<asset id>' --pick 'Enzo Siragusa#1=<asset id>' \
 *
 * Every pick in the round's two versions (Matas, 10 Nov; draft-versions.ts):
 * v1, no CTA; v2, the selling-fast roll-call from the event's live tiers
 * (event_releases, read only), stamped by its ticket_warnings row
 * ("DRAFT · claim not approved" while held). "General sale live" is out of
 * date and isn't drawn; the stress fixtures stay in the tests.
 * Fonts from FONTS_DIR (default ~/Library/Fonts), read in place.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { CLAIM_FACE_BAND, renderClaimCard, type ClaimCardResult } from "../lib/creative-lab/artist-card-claim.ts";
import { O20, trimToInk, type Piece } from "../lib/creative-lab/artist-card.ts";
import { type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { draftVersions, releaseFromRow, type DraftVersion } from "../lib/creative-lab/draft-versions.ts";
import { detectFaces, eyesMeasurable, faceGeometry } from "../lib/creative-lab/face-detect.ts";
import { fontsDir, indexFonts } from "../lib/creative-lab/kit-font.ts";
import { DEFAULT_GRADIENT_SHADOW } from "../lib/creative-lab/overlay-gradient.ts";
import { segmentPerson } from "../lib/creative-lab/segment.ts";
import { artistSlug } from "../lib/drive/tree.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
const code = flag("--event") ?? "";
const kitDir = flag("--kit") ?? "";
const outDir = flag("--out") ?? "";
const picks = many("--pick").map((p) => {
  const at = p.lastIndexOf("=");
  const [artist, n] = p.slice(0, at).split("#");
  return { key: `${artist!.trim()}#${n ?? "1"}`, artist: artist!.trim(), card: Number(n ?? "1"), assetId: p.slice(at + 1).trim() };
});
const fail = (m: string): never => {
  console.error(m);
  process.exit(2);
};
if (!code || !kitDir || !outDir || !picks.length) fail("--event, --kit, --out and --pick are required");
if (argv.includes("--apply")) fail("this script never files: drafts go to --out only");
if (argv.includes("--sample") || argv.includes("--bands-compare")) fail("--sample and --bands-compare are gone: a round draws the two versions for every pick");

type PieceRecord = { role: string; label: string; artist: string | null; file: string; cap_px: number };
const kit = JSON.parse(readFileSync(join(kitDir, "pieces.json"), "utf8")) as { psd: string; pieces: PieceRecord[] };
const piece = async (r: PieceRecord): Promise<Piece> => {
  const t = await trimToInk(readFileSync(join(kitDir, r.file)));
  return { png: t.png, width: t.width, height: t.height, capPx: Math.min(r.cap_px, t.height), label: r.label };
};
const info = await Promise.all(kit.pieces.filter((p) => p.role === "info").map(piece));
const lockupRec = kit.pieces.find((p) => p.role === "logo");
const lockup = lockupRec ? await piece(lockupRec) : null;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ev = await supabase.from("events").select("id, name, status").eq("event_code", code).maybeSingle();
if (ev.error || !ev.data) fail(`No event ${code}`);
const event = ev.data!;
// Live read, select only: never written, never approved here.
const tw = await supabase.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to, updated_at").eq("event_id", event.id).range(0, 999);
if (tw.error) fail(`ticket_warnings: ${tw.error.message}`);
const rows = (tw.data ?? []) as (WarningRow & { updated_at: string })[];
const er = await supabase.from("event_releases").select("*").eq("event_id", event.id).order("position").range(0, 99);
if (er.error) fail(`event_releases: ${er.error.message}`);
let versions: DraftVersion[] = [];
try {
  versions = draftVersions(((er.data ?? []) as Record<string, unknown>[]).map(releaseFromRow), rows);
} catch (e) {
  fail((e as Error).message);
}

const fonts = indexFonts(fontsDir());
mkdirSync(outDir, { recursive: true });
const lines: string[] = [];
const say = (s = "") => {
  console.log(s);
  lines.push(s);
};
say(`# Draft CTA cards · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`);
say(`Versions: ${versions.map((v) => `${v.id} (${v.title}${v.claim ? `: "${v.claim.replace("\n", " / ")}", ${v.why}` : ""})`).join(" · ")}`);
say(`Fonts: ${fontsDir()} (${fonts.length} faces indexed, read in place)`);
say("");

async function download(id: string): Promise<{ bytes: Buffer; name: string }> {
  const a = await supabase.from("creative_assets").select("storage_path, filename").eq("id", id).maybeSingle();
  if (a.error || !a.data) fail(`asset ${id}`);
  const f = await supabase.storage.from("campaign-assets").download(String(a.data!.storage_path));
  if (f.error || !f.data) fail(`download ${id}`);
  return { bytes: Buffer.from(await f.data!.arrayBuffer()), name: String(a.data!.filename) };
}

type Job = { pick: (typeof picks)[number]; label: string; claimText: string | null; watermark: string | null; why: string; bands: boolean };
const jobs: Job[] = picks.flatMap((p) => versions.map((v) => ({ pick: p, label: v.id, claimText: v.claim, watermark: v.watermark, why: v.claim ? v.why : "no claim", bands: true })));

const cache = new Map<string, Awaited<ReturnType<typeof prepare>>>();
async function prepare(p: (typeof picks)[number]) {
  const { bytes, name } = await download(p.assetId);
  const faces = await detectFaces(bytes, { minConfidence: 0.3 });
  const geometry = faces.length ? ((await faceGeometry(bytes, faces.slice(0, 1)))[0] ?? null) : null;
  const eyes = geometry ? eyesMeasurable(geometry) : undefined;
  const mask = await segmentPerson(bytes);
  const nameRec = kit.pieces.find((r) => r.role === "name" && r.artist?.toLowerCase() === p.artist.toLowerCase());
  if (!nameRec) fail(`${p.artist}: no name piece`);
  return { bytes, name, faces, geometry, eyes, mask, namePiece: await piece(nameRec!) };
}

const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)} %`);
const table: string[] = ["| card | photo | claim source | claim | text box | claim box | red line | head / eyes / chin | face box | scale | extension | B rules | files |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
for (const job of jobs) {
  const prep = cache.get(job.pick.assetId) ?? (await prepare(job.pick));
  cache.set(job.pick.assetId, prep);
  const watermark = job.watermark;
  const res: ClaimCardResult = await renderClaimCard({
    photo: prep.bytes,
    face: prep.geometry,
    eyes: prep.eyes,
    faces: prep.faces,
    mask: prep.mask,
    name: prep.namePiece,
    info,
    lockup,
    claimText: job.claimText,
    band: CLAIM_FACE_BAND,
    bands: job.bands ? DEFAULT_GRADIENT_SHADOW : null,
    fonts,
    watermark,
  });
  const slug = `${code}_${artistSlug(job.pick.artist)}_card-${job.pick.card}_${job.label}`;
  const files: string[] = [];
  if (res.master) for (const [fmt, buf] of [["9x16", res.master], ["4x5", res.crop45], ["1x1", res.square]] as const) {
    const f = `${slug}_${fmt}${watermark ? "_DRAFT" : ""}${res.pass ? "" : "_HELD"}.png`;
    writeFileSync(join(outDir, f), buf!);
    files.push(f);
  }
  const p = res.plan;
  const srcLabel = job.why;
  const fails = res.rules.filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail}`);
  say(`## ${job.pick.artist} ${job.pick.card} · ${job.label} · ${prep.name}${res.held ? ` · HELD: ${res.held}` : ""}${!res.held && !res.placed ? " · not drawn: the face can't be placed in the claim's band" : ""}`);
  say(`claim ${job.claimText ? JSON.stringify(job.claimText) : "none"} · source ${srcLabel}${watermark ? ` · watermark "${watermark}"` : ""} · bands ${job.bands ? "on" : "off"}`);
  if (res.claim) say(`slot: ${res.claim.kind} · ${res.claim.lines.map((l) => `"${l.text}" ${l.color}${l.color === "red" && res.redLineWhite ? "→white" : ""} cap ${l.capPx.toFixed(1)} px top y ${l.capTop.toFixed(1)} width ${Math.round(l.widthPx)} px`).join(" · ")} · k ${res.claim.k.toFixed(3)}`);
  say(`contrast: text box ${pct(res.contrast.textBox)} · claim box ${pct(res.contrast.claimBox)} · red line ${pct(res.contrast.redLine)} below 2:1${res.approvalLines.length ? ` · approval line: ${res.approvalLines.join("; ")}` : ""}`);
  // H66, measured on the card: the mean luma of each row across line 1's ink, from line 1's baseline to line 2's cap top.
  if (res.master && res.claim && res.claim.lines.length === 2 && res.redBacking != null) {
    const [l1, l2] = res.claim.lines as [(typeof res.claim.lines)[number], (typeof res.claim.lines)[number]];
    const { data, info } = await sharp(res.master).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const x0 = Math.round((info.width - l1.widthPx) / 2);
    const x1 = Math.round((info.width + l1.widthPx) / 2);
    const rowLuma = (y: number) => {
      let sum = 0;
      for (let x = x0; x < x1; x += 1) {
        const i = (y * info.width + x) * info.channels;
        sum += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
      }
      return sum / Math.max(1, x1 - x0);
    };
    const y0 = Math.ceil(l1.capTop + l1.capPx);
    const y1 = Math.floor(l2.capTop);
    let worst = 0;
    let at = y0;
    for (let y = y0; y < y1; y += 1) {
      const d = Math.abs(rowLuma(y + 1) - rowLuma(y));
      if (d > worst) {
        worst = d;
        at = y;
      }
    }
    say(`H66 (O66): backing ${Math.round(res.redBacking * 100)} % · gap y ${y0}–${y1} · largest row-to-row step of mean luma across line 1's width ${worst.toFixed(1)} levels at y ${at} (limit 6) → ${worst <= 6 ? "passes" : "fails"}`);
  }
  say(`placement: ${p ? `head ${p.headTop.toFixed(3)} · eyes ${p.eyes.toFixed(3)} · chin ${p.chin.toFixed(3)} H · face box ${Math.round(p.faceWidthPx)} px · scale ${p.scale.toFixed(3)}` : "–"} · ${res.extensionLabel || "no extension"}`);
  // O20's figures for every extended edge, each beside its limit (design checks them, not only "pass").
  for (const x of res.extension) {
    const lim = (v: number, max: number, digits = 2) => `${v.toFixed(digits)} (max ${max}) ${v <= max ? "✓" : "✗"}`;
    say(`O20 ${x.edge} strip, ${x.px} px: residual ${lim(x.detailStdev, O20.maxDetailStdev)} · Sobel > ${O20.sobelThreshold}: ${(x.sobelShare * 100).toFixed(2)} % (max ${O20.maxSobelShare * 100} %) ${x.sobelShare <= O20.maxSobelShare ? "✓" : "✗"} · person mask ${x.maskPixels} px (max 0) ${x.maskPixels === 0 ? "✓" : "✗"} · column ΔE ${lim(x.columnMaxDeltaE, O20.maxColumnDeltaE)} · drift ΔE p95 ${lim(x.driftP95, O20.maxDriftP95)} · seam ΔE p95 after fill ${x.seamP95 == null ? "–" : lim(x.seamP95, O20.maxSeamP95)}`);
  }
  say(`rules: ${res.pass ? "all pass" : fails.join("; ")}`);
  for (const f of files) say(`- ${f}`);
  say("");
  table.push(`| ${job.pick.artist} ${job.pick.card} ${job.label} | ${prep.name} | ${srcLabel} | ${job.claimText ? job.claimText.replace(/\n/g, " / ") : "–"} | ${pct(res.contrast.textBox)} | ${pct(res.contrast.claimBox)} | ${pct(res.contrast.redLine)}${res.redLineWhite ? " → white" : ""} | ${p ? `${p.headTop.toFixed(3)} / ${p.eyes.toFixed(3)} / ${p.chin.toFixed(3)}` : "–"} | ${p ? Math.round(p.faceWidthPx) : "–"} px | ${p ? p.scale.toFixed(3) : "–"} | ${res.extensionLabel || "none"} | ${res.held ? `held: ${res.held}` : res.pass ? "pass" : fails.map((x) => x.split(":")[0]).join(", ")} | ${files.length ? files.map((f) => f.replace(`${code}_`, "")).join("<br>") : "–"} |`);
}
say(table.join("\n"));
writeFileSync(join(outDir, "report.md"), lines.join("\n") + "\n");
if (!existsSync(outDir)) fail("no output");
