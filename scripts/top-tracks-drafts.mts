/**
 * Top tracks drafts (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * TK11's Round 1 (or any round) rendered on this machine for Matas to judge.
 * Local only: Remotion renders here, the kit face is read in place from
 * FONTS_DIR, and the audio is the event's own Drive files (CT2), read and
 * never moved. Nothing is written to the database. With --file, the drafts
 * are uploaded to the Lab's own filing folder for the background's owner
 * (D1, D2) with "_draft" in the S14 name; never overwriting (S14's _v2).
 *
 *   npx tsx --conditions react-server scripts/top-tracks-drafts.mts \
 *     --event P26-BDAY --artist "Luke Dean" \
 *     --track "Can't Decide=<drive file id>" --track "…=…" --track "…=…" \   (Spotify's order, top first)
 *     --photo <drive file id of the press shot> --kit <kit folder with pieces.json> \
 *     --out <dir> [--round 1] [--framing ranked …] [--claim "…"] [--bass-stem <python>] \
 *     [--file "<drive folder id of {owner} / Videos>"] [--keep]
 *
 * Every reel carries the draft stamp (O36). The run prints each track's
 * drop, hook and window, each reel's length, loudness, band step and face
 * test, and stops on any refusal with the record's words. --keep leaves the
 * work folder (audio and renders); by default it's removed after filing.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

import { muxSnippet } from "../lib/creative-tests/audio-ffmpeg.ts";
import { readEnvelopes, ENVELOPE_RATE, runFfmpegArgs } from "../lib/creative-tests/audio-ffmpeg.ts";
import { rmsEnvelope } from "../lib/creative-tests/drop.ts";
import { findDrops, findKicks, pcm16ToFloat, trackFeatures } from "../lib/creative-tests/top-tracks/analysis.ts";
import { mmss, planTrack, type TrackPlan } from "../lib/creative-tests/top-tracks/audio-rules.ts";
import { bassStemTop2, detectorCandidates, localDemucs } from "../lib/creative-tests/top-tracks/bass-stem.ts";
import { cutTrackSnippet, decodeForAnalysis, joinSnippets, loudnessOk, measureReel } from "../lib/creative-tests/top-tracks/ffmpeg.ts";
import { CENTRED_HEAD, CLAIM_DOESNT_FIT, headOnList, headlineTooLong, photoCantClear, TOO_BUSY, titleTooLong } from "../lib/creative-tests/top-tracks/reel.ts";
import {
  FRAMINGS,
  headline,
  isLayout,
  kitCase,
  layoutReel,
  playOrder,
  reelTimeline,
  rowForPlay,
  rowMarkers,
  topTracksFileName,
  withLine,
  type Framing,
  type ReelOptions,
} from "../lib/creative-tests/top-tracks/reel.ts";
import { layoutEndCard } from "../lib/creative-tests/top-tracks/layout.ts";
import { bandsPng, dataUri, judgeStill, pieceFor, placePressShot, setEndCard, setRows, topTracksProps, wordMeasure } from "../lib/creative-tests/top-tracks/render.ts";
import { roundVariants, round1Base, type RoundNo } from "../lib/creative-tests/top-tracks/test-plan.ts";
import { artistSlug } from "../lib/drive/tree.ts";
import { driveFromEnv, APP_ID_KEY, APP_TAG_KEY } from "../lib/drive/client.ts";
import { CLAIM_FONT, KIT_RED } from "../lib/creative-lab/claim-slot.ts";
import { fontsDir, indexFonts, requireFont } from "../lib/creative-lab/kit-font.ts";
import { watermarkLayer } from "../lib/creative-lab/artist-card-claim.ts";
import { detectFaces, faceGeometry } from "../lib/creative-lab/face-detect.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const many = (n: string) => argv.flatMap((a, i) => (a === n && argv[i + 1] ? [argv[i + 1]!] : []));
const fail = (m: string): never => {
  console.error(m);
  process.exit(1);
};

const eventCode = flag("--event") ?? fail("--event CODE");
const artist = flag("--artist") ?? fail("--artist NAME (as the Lab lineup writes it)");
const outDir = resolve(flag("--out") ?? fail("--out DIR"));
const kitDir = flag("--kit") ?? fail("--kit DIR (the kit's pieces.json: lockup, date line)");
const photoId = flag("--photo");
const photoFile = flag("--photo-file");
if (!photoId && !photoFile) fail("--photo DRIVE_FILE_ID or --photo-file PATH (the press shot: an artist-card still, O19)");
const round = Number(flag("--round") ?? 1) as RoundNo;
const onlyFramings = many("--framing") as Framing[];
const claim = flag("--claim") ?? null;
const stemPython = flag("--bass-stem");
const fileTo = flag("--file");
const keep = argv.includes("--keep");
// --set key=value (repeatable): the round's held options, as TK10's Edit rows (tracks, rowsAppear, ladder, end, endCard, list).
const overrides: Partial<ReelOptions> = {};
for (const kv of many("--set")) {
  const [k, v] = kv.split("=");
  if (!k || v === undefined || !["tracks", "rowsAppear", "ladder", "end", "endCard", "list"].includes(k)) fail(`--set ${kv}: one of tracks, rowsAppear, ladder, end, endCard, list`);
  (overrides as Record<string, unknown>)[k!] = k === "tracks" ? Number(v) : v;
}
// --track "Title=<id>" or "Title|Artist, Other=<id>" (Spotify's artist list, for TK5's "with" line).
const trackSpecs = many("--track").map((s) => {
  const at = s.lastIndexOf("=");
  if (at < 1) fail(`--track "${s}": want "Title=<drive file id>" or "Title|Artist, Other=<drive file id>"`);
  const [title, artists] = s.slice(0, at).split("|");
  return { title: title!.trim(), artists: (artists ?? "").split(",").map((a) => a.trim()).filter(Boolean), driveId: s.slice(at + 1) };
});
if (trackSpecs.length < 3 || trackSpecs.length > 5) fail("3 to 5 --track, in Spotify's top-tracks order (TK2: Ranked and Level are Spotify's order)");

const { drive, reason } = driveFromEnv();
if (!drive) fail(`Drive: ${reason}`);
const work = join(outDir, "_work");
mkdirSync(work, { recursive: true });

// ─── Kit (read only) ─────────────────────────────────────────────────────────
const face = requireFont(CLAIM_FONT, indexFonts(fontsDir()));
type PieceRecord = { role: string; label: string; artist?: string | null; file: string };
const kit = JSON.parse(readFileSync(join(kitDir, "pieces.json"), "utf8")) as { pieces: PieceRecord[] };
const lockupRec = kit.pieces.find((p) => p.role === "logo");
const dateRec = kit.pieces.find((p) => p.role === "info" && /DAY\b/i.test(p.label));
const lockupPng = lockupRec ? readFileSync(join(kitDir, lockupRec.file)) : null;
const datePng = dateRec ? readFileSync(join(kitDir, dateRec.file)) : null;
const dateText = dateRec?.label ?? "";

// ─── The audio: the event's Drive files, read and kept as they are (CT2) ────
type Track = { title: string; artists: string[]; driveId: string; file: string; spotifyRank: number; plan: Extract<TrackPlan, { ok: true }> };
const stems = stemPython ? localDemucs({ python: stemPython }) : null;
const tracks: Track[] = [];
for (const [i, spec] of trackSpecs.entries()) {
  const meta = await drive!.getFile(spec.driveId);
  if (!meta) fail(`${spec.title}: the Drive file is gone`);
  const local = join(work, `track-${i + 1}${meta!.name.slice(meta!.name.lastIndexOf("."))}`);
  if (!existsSync(local)) writeFileSync(local, await drive!.download(spec.driveId));
  const f = trackFeatures(pcm16ToFloat(await decodeForAnalysis(local)));
  const kicks = findKicks(f);
  const drops = findDrops(f, kicks);
  let top2: number[] | null = null;
  // TK3: the bass stem only when VW14 finds no qualifying drop.
  const first = planTrack({ title: spec.title, features: f, kicks, drops, bassStemTop2: null });
  let plan = first;
  if (!first.ok && stems) {
    const wav = join(work, `track-${i + 1}.wav`);
    await runFfmpegArgs(["-hide_banner", "-nostats", "-y", "-i", local, "-vn", "-ar", "44100", "-ac", "2", wav]);
    top2 = bassStemTop2(detectorCandidates(rmsEnvelope((await readEnvelopes(local)).low, ENVELOPE_RATE)), await stems.stems(wav), kicks);
    plan = planTrack({ title: spec.title, features: f, kicks, drops, bassStemTop2: top2 });
  }
  console.log(`${i + 1} · ${spec.title} · ${mmss(f.durationS)} · VW14 drops ${drops.map((d) => mmss(d.tS)).join(", ") || "none"}${top2 ? ` · bass stem top 2 ${top2.map(mmss).join(", ")}` : ""}`);
  for (const line of plan.lines) console.log(`    ${line}`);
  if (!plan.ok) fail(plan.refusal);
  tracks.push({ title: spec.title, artists: spec.artists, driveId: spec.driveId, file: local, spotifyRank: i + 1, plan: plan as Extract<TrackPlan, { ok: true }> });
}

// Each track's cut, made once (CT1's fades, −14 LUFS, −1 dBTP).
const cuts = new Map<string, string>();
for (const [i, t] of tracks.entries()) {
  const out = join(work, `cut-${i + 1}.m4a`);
  await cutTrackSnippet(t.file, out, { startS: t.plan.window.startS, lengthS: t.plan.window.lengthS });
  cuts.set(t.driveId, out);
}

// ─── The background: the press shot (TK7) ────────────────────────────────────
const photo = photoFile ? readFileSync(photoFile) : Buffer.from(await drive!.download(photoId!));
const faces = await detectFaces(photo);
const main = faces.sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
const geo = main ? (await faceGeometry(photo, [main]))[0] ?? null : null;

// ─── The reels ───────────────────────────────────────────────────────────────
const serveUrl = await bundle({ entryPoint: resolve("src/remotion/index.tsx") });
const variants = roundVariants(round, round1Base(overrides), artist).filter((v) => !onlyFramings.length || onlyFramings.includes(v.options.framing));
const report: Record<string, unknown>[] = [];
for (const v of variants) {
  const o: ReelOptions = v.options;
  const picked = tracks.slice(0, o.tracks);
  const name = topTracksFileName({ eventCode, artistSlug: artistSlug(artist), framing: o.framing, tracks: o.tracks, end: o.end, stage: "on-sale", roundNo: round, draft: true });
  const head = kitCase(headline(o.framing, artist, o.tracks), "upper");
  const markers = rowMarkers(o.framing, o.tracks, o.ladder);
  const rowsIn = picked.map((t, i) => {
    const w = withLine(t.title, t.artists, artist);
    return { title: kitCase(t.title, "upper"), withText: w ? kitCase(w, "upper") : null, marker: markers[i] ?? null };
  });
  const measure = await wordMeasure([head, ...rowsIn.map((r) => r.title), ...rowsIn.map((r) => r.withText ?? ""), ...markers.filter((m): m is string => !!m), kitCase(artist, "upper"), claim ?? ""], face);
  const layout = layoutReel({ headline: head, artist: kitCase(artist, "upper"), rows: rowsIn, list: o.list, measure, markerKind: o.framing === "ranked" ? "number" : o.framing === "level" ? "rung" : "none" });
  if (!isLayout(layout)) fail(layout.refused === "headline" ? headlineTooLong(artist) : titleTooLong(layout.title));
  const still = await placePressShot(photo, geo ? { box: geo.box, eyeY: geo.eyeY, headTopY: geo.headTopY, chinY: geo.chinY } : null, o.list);
  if (!still.ok) fail(still.refusal === "cant_clear" ? photoCantClear(still.side) : headOnList("photo"));
  const headlinePieces = await Promise.all((isLayout(layout) ? layout.headline : []).map((l) => pieceFor(l, "#FFFFFF", face)));
  const L = layout as Exclude<typeof layout, { refused: unknown }>;
  // TK8's accent is decided per reel: judged on the pieces' boxes before the accent copies are set.
  const pre = await setRows(L, face, KIT_RED);
  let endPieces: { pieces: { url: string; left: number; top: number; width: number; height: number }[]; boxes: { left: number; top: number; width: number; height: number }[] } | null = null;
  if (o.end === "date") {
    const sharpL = (await import("sharp")).default;
    const lm = lockupPng ? await sharpL(lockupPng).metadata() : null;
    const end = layoutEndCard({ place: o.endCard, column: L.column, lockupAspect: lm ? (lm.width ?? 1) / (lm.height ?? 1) : 4, name: kitCase(artist, "upper"), date: dateText, claim: claim ? kitCase(claim, "upper") : null, measure });
    if ("refused" in end) fail(CLAIM_DOESNT_FIT);
    const e = end as Exclude<typeof end, { refused: unknown }>;
    endPieces = await setEndCard({ layout: e, lockupPng, datePng, face });
  }
  const boxes = [...headlinePieces.map((p) => p.box), ...pre.boxes, ...(endPieces?.boxes ?? [])];
  const verdict = judgeStill(boxes, still as Extract<typeof still, { ok: true }>, o.list, KIT_RED);
  if ("refused" in verdict) {
    const sharpD = (await import("sharp")).default;
    const st0 = still as Extract<typeof still, { ok: true }>;
    await sharpD(Buffer.from(st0.rgb.data), { raw: { width: st0.rgb.width, height: st0.rgb.height, channels: st0.rgb.channels as 3 } }).png().toFile(join(work, `${o.framing}-still.png`));
    console.error(`p95 background luminance under the text, by side-band step 55 / 70 / 85 %: ${verdict.p95ByStep.join(" / ")} (white needs ≤ 0.183 for 4.5:1)`);
    fail(TOO_BUSY);
  }
  const vd = verdict as Exclude<typeof verdict, { refused: unknown }>;
  const rowsSet = vd.accentWhite ? await setRows(L, face, "#FFFFFF") : pre;
  if (!vd.faceOk) fail(o.end === "date" && o.endCard === "centred" ? CENTRED_HEAD : headOnList("photo"));
  if (!vd.bandOk) fail(`${name}: a piece sits outside O96's band`);
  // Play order (TK4): Ranked counts down.
  const order = playOrder(o.framing, picked);
  const snippets = order.map((t) => ({ lengthS: t.plan.window.lengthS, dropInS: t.plan.window.dropS - t.plan.window.startS }));
  const timeline = reelTimeline(snippets, o.end);
  const joined = join(work, `${name}.m4a`);
  await joinSnippets(order.map((t) => cuts.get(t.driveId)!), timeline.startsS, joined);
  const loud = await measureReel(joined);
  const st = still as Extract<typeof still, { ok: true }>;
  const sharp = (await import("sharp")).default;
  const pm = await sharp(photo).metadata();
  const stamp = await watermarkLayer("DRAFT", { width: 1080, height: 1920 }, face.path, face.family ?? CLAIM_FONT, { avoid: boxes });
  const props = topTracksProps({
    durationS: timeline.totalS,
    background: { kind: "still", url: dataUri(await sharp(photo).jpeg({ quality: 92 }).toBuffer(), "image/jpeg"), width: pm.width ?? 0, height: pm.height ?? 0, scale: st.placed.scale, left: st.placed.left, top: st.placed.top, push: st.placed.push, pushOriginX: st.pushOrigin.x, pushOriginY: st.pushOrigin.y },
    bandsPng: await bandsPng(o.list, vd.step),
    headline: headlinePieces.map((p) => p.img),
    rows: rowsSet.rows,
    playRows: rowForPlay(o.framing, o.tracks),
    timeline,
    rowsAppear: o.rowsAppear,
    end: o.end,
    list: o.list,
    barColour: vd.accentWhite ? "#FFFFFF" : KIT_RED,
    column: L.column,
    endCard: endPieces?.pieces ?? null,
    stamp: { url: dataUri(stamp), left: 0, top: 0, width: 1080, height: 1920 },
  });
  const comp = await selectComposition({ serveUrl, id: "TopTracks", inputProps: props as unknown as Record<string, unknown> });
  const silent = join(work, `${name}.silent.mp4`);
  await renderMedia({ composition: comp, serveUrl, codec: "h264", outputLocation: silent, inputProps: props as unknown as Record<string, unknown>, muted: true, crf: 18 });
  const final = join(outDir, name);
  await muxSnippet(silent, joined, final);
  console.log(`${name} · ${timeline.totalS.toFixed(1)} s · ${loud.lufs} LUFS · ${loud.truePeakDb} dBTP${loudnessOk(loud) ? "" : " · LOUDNESS OUT OF RANGE"} · side band step ${vd.step} (p95 ${vd.p95ByStep.join(" / ")}) · accent ${vd.accentWhite ? "white" : "kit red"} · face clear`);
  report.push({ name, framing: o.framing, totalS: timeline.totalS, drops: timeline.dropsS, rowsAt: o.rowsAppear === "start" ? timeline.startsS : timeline.dropsS, endFromS: timeline.endFromS, lufs: loud.lufs, truePeakDb: loud.truePeakDb, step: vd.step, accentWhite: vd.accentWhite });
}

writeFileSync(join(outDir, "report.json"), JSON.stringify({ tracks: tracks.map((t) => ({ title: t.title, spotifyRank: t.spotifyRank, lines: t.plan.lines, window: t.plan.window, choice: t.plan.choice.kind, hook: t.plan.hook })), reels: report }, null, 2));

// ─── Filing (--file): the owner's Videos folder, never overwriting ──────────
if (fileTo) {
  const taken = new Set((await drive!.listChildren(fileTo)).map((f) => f.name));
  for (const r of report) {
    let n = String(r.name);
    for (let k = 2; taken.has(n); k += 1) n = String(r.name).replace(/_r(\d+)_draft_9x16\.mp4$/, `_r$1_v${k}_draft_9x16.mp4`);
    const up = await drive!.uploadFile({ parentId: fileTo, name: n, mimeType: "video/mp4", bytes: readFileSync(join(outDir, String(r.name))), appProperties: { [APP_TAG_KEY]: "lab_top_tracks_draft", [APP_ID_KEY]: `${eventCode}:${n}` } });
    taken.add(n);
    console.log(`filed ${n} → https://drive.google.com/file/d/${up.id}/view`);
  }
}
if (!keep) rmSync(work, { recursive: true, force: true });
