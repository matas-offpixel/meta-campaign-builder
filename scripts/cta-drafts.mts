/**
 * Draft artist cards with their claim (overlay-templates issue 3, H25), for
 * Matas to judge the bands and the claim size. Local only: the cards go to
 * --out and nowhere else — this script has no Drive or Storage path, and a
 * watermarked card can't be exported (claim-approval.ts assertExportable).
 *
 *   node --max-old-space-size=12288 --env-file=.env.local --experimental-strip-types scripts/cta-drafts.mts \
 *     --event P26-BDAY --kit outputs/P26-BDAY/kits/puzzle-birthday-1-static --out <notes folder> \
 *     --pick 'Luke Dean#1=<asset id>' --pick 'Luke Dean#2=<asset id>' --pick 'Enzo Siragusa#1=<asset id>' \
 *     [--sample 'Luke Dean#1'] [--bands-compare 'Luke Dean#1']
 *
 * (a) every pick with the event's approved claim, read live from
 *     ticket_warnings (select only); with none approved, the newest proposed
 *     claim is drawn and the card carries "DRAFT · claim not approved";
 * (b) --sample: a roll-call on that pick with fixture words, "DRAFT · sample claim";
 * (c) --bands-compare: that pick with no claim, bands on and off.
 * Fonts from FONTS_DIR (default ~/Library/Fonts), read in place.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { CLAIM_FACE_BAND, renderClaimCard, type ClaimCardResult } from "../lib/creative-lab/artist-card-claim.ts";
import { O20, trimToInk, type Piece } from "../lib/creative-lab/artist-card.ts";
import { SAMPLE_ROLL_CALL, approvedClaim, watermarkFor, type ClaimSource, type WarningRow } from "../lib/creative-lab/claim-approval.ts";
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
const sample = flag("--sample");
const compare = flag("--bands-compare");
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
const source = approvedClaim(rows, new Date());
const proposed = [...rows].filter((r) => r.state === "held").sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0] ?? null;

const fonts = indexFonts(fontsDir());
mkdirSync(outDir, { recursive: true });
const lines: string[] = [];
const say = (s = "") => {
  console.log(s);
  lines.push(s);
};
say(`# Draft CTA cards · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`);
say(`Claim source: ${source.kind === "approved" ? `approved ticket_warnings ${source.id} "${source.claim}" (format ${source.format}, approved ${source.approvedAt})` : source.kind === "none" ? `none approved — ${source.why}; drawing the newest proposal${proposed ? ` "${proposed.claim}" (${proposed.id}, held)` : " (none)"} under "DRAFT · claim not approved"` : source.kind}`);
say(`Fonts: ${fontsDir()} (${fonts.length} faces indexed, read in place)`);
say("");

async function download(id: string): Promise<{ bytes: Buffer; name: string }> {
  const a = await supabase.from("creative_assets").select("storage_path, filename").eq("id", id).maybeSingle();
  if (a.error || !a.data) fail(`asset ${id}`);
  const f = await supabase.storage.from("campaign-assets").download(String(a.data!.storage_path));
  if (f.error || !f.data) fail(`download ${id}`);
  return { bytes: Buffer.from(await f.data!.arrayBuffer()), name: String(a.data!.filename) };
}

type Job = { pick: (typeof picks)[number]; label: string; claimText: string | null; claimSource: ClaimSource; bands: boolean };
const jobs: Job[] = [];
for (const p of picks) {
  const text = source.kind === "approved" ? source.claim : proposed?.claim ?? null;
  jobs.push({ pick: p, label: "a", claimText: text, claimSource: source, bands: true });
}
const pickBy = (key: string | undefined) => picks.find((p) => p.key === key || `${p.artist}#${p.card}` === key);
if (sample && pickBy(sample)) jobs.push({ pick: pickBy(sample)!, label: "b-sample-roll-call", claimText: SAMPLE_ROLL_CALL, claimSource: { kind: "sample", claim: SAMPLE_ROLL_CALL }, bands: true });
if (compare && pickBy(compare)) {
  jobs.push({ pick: pickBy(compare)!, label: "c-no-claim-bands-on", claimText: null, claimSource: { kind: "off" }, bands: true });
  jobs.push({ pick: pickBy(compare)!, label: "c-no-claim-bands-off", claimText: null, claimSource: { kind: "off" }, bands: false });
}

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
  const watermark = watermarkFor(job.claimSource);
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
  const srcLabel = job.claimSource.kind === "approved" ? `approved (${job.claimSource.id})` : job.claimSource.kind === "none" ? `not approved — proposal ${proposed?.id ?? "–"} (held)` : job.claimSource.kind === "sample" ? "sample (fixture)" : "no claim";
  const fails = res.rules.filter((r) => !r.pass).map((r) => `${r.rule}: ${r.detail}`);
  say(`## ${job.pick.artist} ${job.pick.card} · ${job.label} · ${prep.name}${res.held ? ` · HELD: ${res.held}` : ""}${!res.held && !res.placed ? " · not drawn: the face can't be placed in the claim's band" : ""}`);
  say(`claim ${job.claimText ? JSON.stringify(job.claimText) : "none"} · source ${srcLabel}${watermark ? ` · watermark "${watermark}"` : ""} · bands ${job.bands ? "on" : "off"}`);
  if (res.claim) say(`slot: ${res.claim.kind} · ${res.claim.lines.map((l) => `"${l.text}" ${l.color}${l.color === "red" && res.redLineWhite ? "→white" : ""} cap ${l.capPx.toFixed(1)} px top y ${l.capTop.toFixed(1)} width ${Math.round(l.widthPx)} px`).join(" · ")} · k ${res.claim.k.toFixed(3)}`);
  say(`contrast: text box ${pct(res.contrast.textBox)} · claim box ${pct(res.contrast.claimBox)} · red line ${pct(res.contrast.redLine)} below 2:1${res.approvalLines.length ? ` · approval line: ${res.approvalLines.join("; ")}` : ""}`);
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
