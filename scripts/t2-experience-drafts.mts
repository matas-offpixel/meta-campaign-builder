/**
 * H85 drafts: T2 on the photo ground (overlay templates issue 11) for Matas
 * to judge. Local stills; clips render on Lambda from the first promoter
 * clips (see below). Drafts go to --out and nowhere else: no Drive or
 * Storage write, no approval, no export, no launch, and every draft is
 * stamped while its experience line or claim is held.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/t2-experience-drafts.mts \
 *     --event P26-BDAY --kit <the STORY PSD's kit folder> --out <drafts folder> \
 *     --experience "SOUTHAMPTON'S BIGGEST HOUSE PARTY" [--photo-asset <creative_assets id>] [--clip <clip id>]
 *
 * Footage (O76), read only: only the promoter's own. Clips must have
 * creative_lab_clips.owner = 'promoter'; an artist's clip is refused. Photos
 * carry no owner column yet, so a --photo-asset is the operator's statement
 * that the promoter owns it, and the report says so. With no promoter clip
 * on the event and no photo, nothing is rendered: the script prints what it
 * found and exits 3 ("ask ops to add Puzzle's candidate reels as promoter
 * clips"). It never adds or re-tags footage.
 *
 * The experience line is typed (Matas's, kept verbatim: the writer's bans
 * are for Suggest only), so no writer is called. Two versions (Matas,
 * 10 Nov): v1 with no claim, v2 the live roll-call, stamped while held.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { trimToInk } from "../lib/creative-lab/artist-card.ts";
import { type WarningRow } from "../lib/creative-lab/claim-approval.ts";
import { draftVersions, releaseFromRow, type DraftVersion } from "../lib/creative-lab/draft-versions.ts";
import { DOUBLE_SPACE, doubleSpaceRun, photoT2Stamp, saveExperienceLine } from "../lib/creative-lab/experience-line.ts";
import { detectFaces } from "../lib/creative-lab/face-detect.ts";
import { fontsDir, indexFonts, resolveFont } from "../lib/creative-lab/kit-font.ts";
import { releaseNamesOf } from "../lib/creative-lab/t1-video.ts";
import { T2P_INVENTED, dataNoteChecks, dataNoteWord, photoDetails, photoGroundAllowed, type PhotoFormat } from "../lib/creative-lab/t2-photo.ts";
import { renderPhotoStill, type PhotoStillResult } from "../lib/creative-lab/t2-photo-render.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
const fail = (m: string, code = 2): never => {
  console.error(m);
  process.exit(code);
};
const code = flag("--event") ?? "";
const kitDir = flag("--kit") ?? "";
const outDir = flag("--out") ?? "";
const typed = flag("--experience") ?? "";
if (!code || !kitDir || !outDir || !typed) fail("--event, --kit, --out and --experience are required");
if (argv.includes("--apply") || argv.includes("--export") || argv.includes("--approve")) fail("this script never files, approves or exports: drafts go to --out only");
// O88: a run of two spaces is asked about once on save. For the drafts the answer is --spaces keep|one (default keep: kept as typed).
const spaces = (flag("--spaces") ?? "keep") as "keep" | "one";
const saved = saveExperienceLine(typed, { answer: spaces });
if (saved.status === "refused") fail(saved.line);
const experience = saved.status === "saved" ? saved.text : "";
const askedSpaces = doubleSpaceRun(typed);

// ─── Live reads, select only ───────────────────────────────────────────────
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ev = await db.from("events").select("id, name, client_id, event_date, venue_name").eq("event_code", code).maybeSingle();
if (ev.error || !ev.data) fail(`No event ${code}: ${ev.error?.message ?? "not found"}`);
const event = ev.data!;

// O76: the promoter's own footage only.
const promo = await db.from("creative_lab_clips").select("id, owner, artist_id, event_id, shown_on_event_id, clip_no").eq("owner", "promoter").or(`event_id.eq.${event.id},shown_on_event_id.eq.${event.id}`).range(0, 199);
if (promo.error) fail(`creative_lab_clips: ${promo.error.message}`);
const askedClips = many("--clip");
for (const id of askedClips) {
  const c = await db.from("creative_lab_clips").select("id, owner").eq("id", id).maybeSingle();
  if (c.error || !c.data) fail(`clip ${id}: not found`);
  const allowed = photoGroundAllowed({ owner: (c.data!.owner as "promoter" | "artist" | null) ?? null });
  if (!allowed.ok) fail(`clip ${id}: ${allowed.line}`);
}
const photoAsset = flag("--photo-asset");
if (!photoAsset && !(promo.data ?? []).length && !askedClips.length) {
  const owners = await db.from("creative_lab_clips").select("owner").eq("event_id", event.id).range(0, 999);
  const tally: Record<string, number> = {};
  for (const r of owners.data ?? []) tally[String(r.owner)] = (tally[String(r.owner)] ?? 0) + 1;
  const cand = await db.from("creative_lab_ig_candidates").select("id, status, clip_id").eq("client_id", event.client_id).range(0, 199);
  const cands = cand.data ?? [];
  fail(
    [
      `Nothing rendered: ${code} has no promoter-owned clip and no photo was given.`,
      `Clips on the event by owner: ${JSON.stringify(tally)}. The client's Instagram candidates: ${cands.length} (${cands.filter((c) => c.clip_id).length} added as clips).`,
      "Ask ops to add Puzzle's candidate reels as promoter clips (and name the crowd photo to use).",
    ].join("\n"),
    3,
  );
}
if (askedClips.length || (promo.data ?? []).length) {
  // The clip path renders on Lambda through T1OnClip (bands and type from frame 0, the claim at 1.5 s, O83).
  // It is written against the first promoter clips so it is tested on real footage; until then it stops here.
  if (!photoAsset) fail(`promoter clips found (${[...askedClips, ...(promo.data ?? []).map((c) => c.id)].join(", ")}), but the clip path isn't built yet: it comes with the first promoter clips.`, 4);
  console.log("promoter clips found; this run draws the photo only (the clip path comes with the first promoter clips).");
}

const tw = await db.from("ticket_warnings").select("id, claim, format, state, approved_by, approved_at, runs_from, runs_to, updated_at").eq("event_id", event.id).range(0, 999);
if (tw.error) fail(`ticket_warnings: ${tw.error.message}`);
const rows = (tw.data ?? []) as (WarningRow & { updated_at: string })[];
const er = await db.from("event_releases").select("*").eq("event_id", event.id).order("position").range(0, 99);
if (er.error) fail(`event_releases: ${er.error.message}`);
const tiers = (er.data ?? []) as Record<string, unknown>[];
const releaseNames = releaseNamesOf(tiers as { name: string; position: number }[]);
let versions: DraftVersion[] = [];
try {
  versions = draftVersions(tiers.map(releaseFromRow), rows);
} catch (e) {
  fail((e as Error).message);
}
const facts = await db.from("creative_lab_event_facts").select("*").eq("event_id", event.id).maybeSingle();
const lineup = ((facts.data?.lineup as string[] | null) ?? []).filter(Boolean);
// O79: "& MORE" only when the facts say more acts are coming. No such field is on the facts yet, so it is never drawn.
const moreToAnnounce = facts.data?.more_to_announce === true;

// ─── Kit (read in place) ────────────────────────────────────────────────────
const pieces = JSON.parse(readFileSync(join(kitDir, "pieces.json"), "utf8")) as { pieces: { role: string; label: string; file: string }[] };
const logoRec = pieces.pieces.find((p) => p.role === "logo");
if (!logoRec) fail("the kit has no logo piece");
const logo = await trimToInk(readFileSync(join(kitDir, logoRec!.file)));
const info = pieces.pieces.filter((p) => p.role === "info").map((p) => p.label);
const live = [info.find((l) => /DAY\b/i.test(l)), info.find((l) => l.includes(">") && !/\dPM/i.test(l))].filter((l): l is string => !!l);
const details = photoDetails({ liveLayer: live.length === 2 ? live : null, date: (event.event_date as string | null) ?? null, venue: (event.venue_name as string | null) ?? null });
const font = resolveFont("BootzyCondensedTM-Regular", indexFonts(fontsDir()));
if (font.status !== "found") fail("the kit face (BootzyCondensedTM-Regular) isn't installed here");
const face = font.status === "found" ? font.entry : (null as never);

// ─── The photo (read only) ──────────────────────────────────────────────────
const asset = await db.from("creative_assets").select("id, storage_path").eq("id", photoAsset!).maybeSingle();
if (asset.error || !asset.data) fail(`photo asset ${photoAsset}: not found`);
const file = await db.storage.from("campaign-assets").download(String(asset.data!.storage_path));
if (file.error || !file.data) fail(`download ${photoAsset}`);
const photo = Buffer.from(await file.data!.arrayBuffer());
const faces = (await detectFaces(photo)).map((f) => ({ left: f.x, top: f.y, width: f.width, height: f.height }));

mkdirSync(outDir, { recursive: true });
const L: string[] = [];
const say = (s = "") => L.push(s);
say(`# T2 on the photo ground · ${code} · ${event.name} · ${new Date().toISOString().slice(0, 16)}Z`);
say();
say(`Experience line (typed by Matas, kept verbatim; the writer's bans apply only to Suggest): "${experience}". Not approved: every draft is stamped.${askedSpaces ? ` O88 asked "${DOUBLE_SPACE.ask(askedSpaces.word)}" — answered ${spaces === "keep" ? DOUBLE_SPACE.keep : DOUBLE_SPACE.makeOne} (--spaces).` : ""}`);
say(`Photo: creative_assets ${photoAsset} (${asset.data!.storage_path}). Photos carry no owner column yet: the operator states the promoter owns it (O76).`);
say(`Lineup (creative_lab_event_facts): ${lineup.join(" · ")} · "& MORE": ${moreToAnnounce ? "the facts say more acts are coming" : "not drawn (the facts have no flag)"}. Details: ${details.join(" / ")}.`);
say();
say("| Version | Format | Crop | Scale | Band steps (top / centre / bottom) | Red line | Data note (H86, ±0.005 H / W) | Result | File |");
say("|---|---|---|---|---|---|---|---|---|");
const sheet: { label: string; file: string }[] = [];
for (const v of versions) {
  const stamp = photoT2Stamp("held", v.claim ? (v.watermark ? "held" : "approved") : null);
  const r: PhotoStillResult = await renderPhotoStill({ photo, slots: { experience, claim: v.claim, releaseNames, lineup, moreToAnnounce, details, logo: { ink: { width: logo.width, height: logo.height }, kind: "lockup" } }, face, logoPng: logo.png, stamp, faces, cropFocusY: [0.5, 0.4, 0.6, 0.3, 0.7] });
  for (const fmt of ["9:16", "4:5", "1:1"] as PhotoFormat[]) {
    const name = `${v.id}_${fmt.replace(":", "x")}_DRAFT.png`;
    if (r.images[fmt]) {
      writeFileSync(join(outDir, name), r.images[fmt]!);
      sheet.push({ label: `${v.id} · ${fmt}`, file: join(outDir, name) });
    }
    const s = r.report.steps;
    const red = r.report.red ? `${(r.report.red.share * 100).toFixed(1)} % → ${r.report.red.verdict.white ? "white" : r.report.red.verdict.backing != null ? `red, backed ${Math.round(r.report.red.verdict.backing * 100)} %` : "red"}` : "–";
    say(`| ${v.id} | ${fmt} | ${r.report.crop ?? "–"} | ${r.report.scale?.toFixed(2) ?? "–"}× | ${s ? `+${s.top * 10} / +${s.centre * 10} / +${s.bottom * 10}` : "–"} | ${red} | ${r.report.layouts[fmt] ? dataNoteWord(dataNoteChecks(r.report.layouts[fmt]!)) : "–"} | ${r.held ?? `passes, "${stamp}"`} | ${r.images[fmt] ? name : "–"} |`);
  }
  for (const t of r.report.tried) say(`- ${v.id}: ${t}`);
}
say();
say("## Invented (T2P_INVENTED)");
for (const i of T2P_INVENTED) say(`- **${i.ruling}**: ${i.value}`);
writeFileSync(join(outDir, "report.md"), L.join("\n") + "\n");

// Contact sheet: each draft at 360 px wide.
if (sheet.length) {
  const tiles = await Promise.all(sheet.map(async (s) => sharp(readFileSync(s.file)).resize(360).png().toBuffer({ resolveWithObject: true })));
  const height = Math.max(...tiles.map((t) => t.info.height));
  const out = await sharp({ create: { width: 380 * tiles.length, height: height + 20, channels: 3, background: { r: 24, g: 24, b: 24 } } })
    .composite(tiles.map((t, i) => ({ input: t.data, left: 10 + 380 * i, top: 10 })))
    .png()
    .toBuffer();
  writeFileSync(join(outDir, "CONTACT-SHEET.png"), out);
}
console.log(`wrote ${sheet.length} drafts, CONTACT-SHEET.png and report.md to ${outDir}`);
