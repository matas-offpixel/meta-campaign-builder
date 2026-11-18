/**
 * Top tracks: one reel assembled end to end (HK1–HK6), shared by the drafts
 * script and the render tick. In: the picked tracks (each with its TK3
 * window and its cut already made), the options, the kit face and pieces,
 * the press shot and its face. Out: the composition's props and the joined
 * audio, or a refusal in the record's words. The caller renders the props
 * silent (locally or on Lambda) and muxes the audio on.
 */

import { join } from "node:path";

import sharp from "sharp";

import { watermarkLayer } from "../../creative-lab/artist-card-claim.ts";
import type { FontEntry } from "../../creative-lab/kit-font.ts";
import { artistSlug } from "../../drive/tree.ts";
import type { TopTracksProps } from "../../../src/remotion/compositions/TopTracks.tsx";
import type { SnippetWindow } from "./audio-rules.ts";
import { joinSnippets, measureReel, type ReelLoudness } from "./ffmpeg.ts";
import { layoutEndCard } from "./layout.ts";
import {
  CENTRED_HEAD,
  CLAIM_DOESNT_FIT,
  TOO_BUSY,
  canTick,
  headOnList,
  headline,
  headlineTooLong,
  isLayout,
  kitCase,
  layoutReel,
  photoCantClear,
  playOrder,
  reelTimeline,
  rowForPlay,
  rowMarkers,
  titleTooLong,
  topTracksFileName,
  withLine,
  type ReelOptions,
  type ReelTimeline,
} from "./reel.ts";
import { bandsPng, dataUri, judgeStill, pieceFor, placePressShot, setEndCard, setRows, topTracksProps, wordMeasure } from "./render.ts";

export type BuildTrack = {
  /** The audio file's id (row or Drive). */
  key: string;
  title: string;
  /** Spotify's artists on the track, for TK5's "with" line. */
  artists: readonly string[];
  /** Its place in Spotify's top tracks, or null for a Drive-only file. */
  spotifyRank: number | null;
  window: SnippetWindow;
  /** The snippet cut (CT1's fades, −14 LUFS), made from the Lab's copy of the file. */
  cutFile: string;
};

export type FaceGeo = { box: { x: number; y: number; width: number; height: number }; eyeY: number; headTopY: number; chinY: number } | null;

export type BuildInput = {
  eventCode: string | null;
  artist: string;
  kitCaseMode: "upper" | "as-is";
  options: ReelOptions;
  /** The list top-down: Spotify's order under Ranked and Level, the operator's under the other two. */
  tracks: readonly BuildTrack[];
  face: FontEntry;
  accentHex: string;
  /** The press shot, already upright (sharp().rotate()), and the face found on that same image. */
  photo: Buffer;
  faceGeo: FaceGeo;
  lockupPng: Buffer | null;
  datePng: Buffer | null;
  dateText: string;
  /** The event's approved live claim (rule 11, the approved ladder), or null. Never edited to fit. */
  claim: string | null;
  /** O36's stamp text, or null when everything on it is approved. */
  stamp: string | null;
  stage: string;
  roundNo: number;
  draft: boolean;
  workDir: string;
};

export type BuildResult =
  | { ok: true; name: string; props: TopTracksProps; joinedAudio: string; loudness: ReelLoudness; timeline: ReelTimeline; step: number; accentWhite: boolean; p95ByStep: number[] }
  | { ok: false; refusal: string; p95ByStep?: number[] };

export async function buildReel(input: BuildInput): Promise<BuildResult> {
  const o = input.options;
  const kc = (s: string) => kitCase(s, input.kitCaseMode);
  const picked = input.tracks.slice(0, o.tracks);
  if (picked.length !== o.tracks) return { ok: false, refusal: `${o.tracks} tracks needed, ${picked.length} picked` };
  for (const t of picked) {
    const tick = canTick(o.framing, t);
    if (!tick.ok) return { ok: false, refusal: tick.line };
  }
  const name = topTracksFileName({ eventCode: input.eventCode, artistSlug: artistSlug(input.artist), framing: o.framing, tracks: o.tracks, end: o.end, stage: input.stage, roundNo: input.roundNo, draft: input.draft });
  const head = kc(headline(o.framing, input.artist, o.tracks));
  const markers = rowMarkers(o.framing, o.tracks, o.ladder);
  const rowsIn = picked.map((t, i) => {
    const w = withLine(t.title, t.artists, input.artist);
    return { title: kc(t.title), withText: w ? kc(w) : null, marker: markers[i] ?? null };
  });
  const artistUp = kc(input.artist);
  const claim = input.claim ? kc(input.claim) : null;
  const measure = await wordMeasure([head, ...rowsIn.map((r) => r.title), ...rowsIn.map((r) => r.withText ?? ""), ...markers.filter((m): m is string => !!m), artistUp, claim ?? ""], input.face);
  const layout = layoutReel({ headline: head, artist: artistUp, rows: rowsIn, list: o.list, measure, markerKind: o.framing === "ranked" ? "number" : o.framing === "level" ? "rung" : "none" });
  if (!isLayout(layout)) return { ok: false, refusal: layout.refused === "headline" ? headlineTooLong(input.artist) : titleTooLong(layout.title) };
  const still = await placePressShot(input.photo, input.faceGeo, o.list);
  if (!still.ok) return { ok: false, refusal: still.refusal === "cant_clear" ? photoCantClear(still.side) : headOnList("photo") };
  const headlinePieces = await Promise.all(layout.headline.map((l) => pieceFor(l, "#FFFFFF", input.face)));
  const pre = await setRows(layout, input.face, input.accentHex);
  let endPieces: Awaited<ReturnType<typeof setEndCard>> | null = null;
  if (o.end === "date") {
    const lm = input.lockupPng ? await sharp(input.lockupPng).metadata() : null;
    const end = layoutEndCard({ place: o.endCard, column: layout.column, lockupAspect: lm ? (lm.width ?? 1) / (lm.height ?? 1) : 4, name: artistUp, date: input.dateText, claim, measure });
    if ("refused" in end) return { ok: false, refusal: CLAIM_DOESNT_FIT };
    endPieces = await setEndCard({ layout: end, lockupPng: input.lockupPng, datePng: input.datePng, face: input.face });
  }
  const boxes = [...headlinePieces.map((p) => p.box), ...pre.boxes, ...(endPieces?.boxes ?? [])];
  const verdict = judgeStill(boxes, still, o.list, input.accentHex);
  if ("refused" in verdict) return { ok: false, refusal: TOO_BUSY, p95ByStep: verdict.p95ByStep };
  if (!verdict.faceOk) return { ok: false, refusal: o.end === "date" && o.endCard === "centred" ? CENTRED_HEAD : headOnList("photo") };
  if (!verdict.bandOk) return { ok: false, refusal: `${name}: a piece sits outside O96's band` };
  const rowsSet = verdict.accentWhite ? await setRows(layout, input.face, "#FFFFFF") : pre;
  // TK4: Ranked counts down; the rest play top-down.
  const order = playOrder(o.framing, picked);
  const timeline = reelTimeline(order.map((t) => ({ lengthS: t.window.lengthS, dropInS: t.window.dropS - t.window.startS })), o.end);
  const joinedAudio = join(input.workDir, `${name}.m4a`);
  await joinSnippets(order.map((t) => t.cutFile), timeline.startsS, joinedAudio);
  const loudness = await measureReel(joinedAudio);
  const pm = await sharp(input.photo).metadata();
  // The still is sent at the size it's shown (no upscaling, so never larger than the photo), not the photo's own 20 MB.
  const shownW = Math.max(1, Math.round((pm.width ?? 1) * still.placed.scale));
  const shownH = Math.max(1, Math.round((pm.height ?? 1) * still.placed.scale));
  const shown = await sharp(input.photo).resize({ width: shownW, height: shownH }).jpeg({ quality: 92 }).toBuffer();
  const stamp = input.stamp ? await watermarkLayer(input.stamp, { width: 1080, height: 1920 }, input.face.path, input.face.family ?? "", { avoid: boxes }) : null;
  const props = topTracksProps({
    durationS: timeline.totalS,
    background: { kind: "still", url: dataUri(shown, "image/jpeg"), width: shownW, height: shownH, scale: 1, left: still.placed.left, top: still.placed.top, push: still.placed.push, pushOriginX: still.pushOrigin.x, pushOriginY: still.pushOrigin.y },
    bandsPng: await bandsPng(o.list, verdict.step),
    headline: headlinePieces.map((p) => p.img),
    rows: rowsSet.rows,
    playRows: rowForPlay(o.framing, o.tracks),
    timeline,
    rowsAppear: o.rowsAppear,
    end: o.end,
    list: o.list,
    barColour: verdict.accentWhite ? "#FFFFFF" : input.accentHex,
    column: layout.column,
    endCard: endPieces?.pieces ?? null,
    stamp: stamp ? { url: dataUri(stamp), left: 0, top: 0, width: 1080, height: 1920 } : null,
  });
  return { ok: true, name, props, joinedAudio, loudness, timeline, step: verdict.step, accentWhite: verdict.accentWhite, p95ByStep: verdict.p95ByStep };
}
