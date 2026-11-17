/**
 * Detect faces for one clip, and measure contrast on a place already chosen.
 * The render tick is the only route that imports this. render-caption runs
 * the search on the stored samples and does not load the detector.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { lowContrastShare, type Rect } from "./artist-card.ts";
import {
  captionBoxesAt,
  readFaceSamples,
  type StoredFaceSamples,
} from "./caption-placement.ts";
import { cropWindow } from "../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "./load.ts";
import { probeClip } from "./render.ts";
import { renderAssetId } from "./render-proxy.ts";
import { clipWindow } from "./surface.ts";
import { T1V_FACE } from "./t1-face.ts";
import { nearestRank } from "./t1-video.ts";

const run = promisify(execFile);
/** The face check's frames are scaled to this on their long side before detection. */
export const FACE_FRAME_SIDE = 640;
export { FACE_DETECTOR } from "./caption-placement.ts";
import {
  FACE_CHECK_BUDGET_MS,
  FACE_CHECK_SLICE_MS,
  FACE_DETECT_ESTIMATE_S,
  FACE_DETECTOR,
  FACE_SAMPLE_FPS,
  FACE_SAMPLING,
  type FaceCheckProgress,
} from "./caption-placement.ts";
import { finishFaceCheck, parkFaceCheck } from "./face-check-lock.ts";
import { finishedSamples, newProgress, runFaceCheckSlice, type SliceStats } from "./face-check-slice.ts";
import { extractFaceFrames, scanFrameTimes } from "./face-frames.ts";
import { FACE_MAX_GAP_S, faceSampleSeed, planFrames, sampleTimes } from "./face-sampling.ts";

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as { default?: string | null } | string;
  const path = typeof mod === "string" ? mod : mod.default;
  if (!path) throw new Error("ffmpeg-static has no binary for this platform");
  return path;
}

function storageAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase storage admin requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return createSupabaseClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function signUrl(bucket: string, objectPath: string): Promise<string> {
  const { data, error } = await storageAdmin().storage.from(bucket).createSignedUrl(objectPath, 60 * 60);
  if (error || !data?.signedUrl) throw new Error(`signed url for ${objectPath}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

type Row = Record<string, unknown>;

function num(value: unknown, fallback: number | null): number | null {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export type FaceCheckClaimed = { stamp: string; attempt: number; progress: FaceCheckProgress | null };

/**
 * One tick's slice of the clip's face check, for its current crop and window (face-check-slice.ts), under the
 * tick's claim (face-check-lock.ts). It resumes the claim's progress, then parks the check with what it
 * checked ("checking": the next tick goes on from there) or stores the samples or the error. The writes land
 * only if the row is still the claim's.
 */
export async function ensureClipFaces(db: ServiceRoleDb, clipId: string, claim: FaceCheckClaimed): Promise<"ready" | "failed" | "checking"> {
  const clipRes = await db.from("creative_lab_clips").select("*").eq("id", clipId).maybeSingle();
  if (clipRes.error) throw new Error(`creative_lab_clips: ${clipRes.error.message}`);
  const clip = clipRes.data as Row | null;
  if (!clip) return "failed";
  const cropFocusX = num(clip.crop_focus_x, 0.5) ?? 0.5;
  const cropFocusY = num(clip.crop_focus_y, 0.5) ?? 0.5;
  const inS = num(clip.in_s, null);
  const outS = num(clip.out_s, null);
  const base = { detector: FACE_DETECTOR, fps: FACE_SAMPLE_FPS, cropFocusX, cropFocusY, inS, outS };
  const since = readFaceSamples(clip.face_samples)?.running?.since ?? claim.stamp;
  const started = Date.now();
  const stats: SliceStats = { frames: 0, extractS: 0, scanS: 0, detectS: 0, extracts: 0 };
  let progress: FaceCheckProgress | null = claim.progress;
  const prefix = `[creative-lab-face-check] clip ${clipId}`;
  // Split by stage, on every outcome, so the logs show where a slice's time went. No owner or person data.
  const timing = () => {
    const per = stats.frames ? `, ${(stats.detectS / stats.frames).toFixed(2)} s per frame` : "";
    const total = progress ? `, ${progress.done} of ${progress.frames.length} frames done (${progress.planned} planned), slice ${progress.slices}` : "";
    return `this slice ${stats.frames} frames in ${((Date.now() - started) / 1000).toFixed(1)} s: extract ${stats.extractS.toFixed(1)} s (${stats.extracts} runs), ` +
      `scan ${stats.scanS.toFixed(1)} s, detect ${stats.detectS.toFixed(1)} s${per}${total}`;
  };
  const write = (body: StoredFaceSamples): Promise<boolean> => finishFaceCheck(db, clipId, claim, body, new Date());
  const dir = await mkdtemp(join(tmpdir(), "caption-place-"));
  try {
    const { detectFaces } = await import("./face-detect.ts");
    const assetRes = await db.from("creative_assets").select("*").eq("id", renderAssetId(clip)).maybeSingle();
    if (assetRes.error) throw new Error(`creative_assets: ${assetRes.error.message}`);
    const asset = assetRes.data as Row | null;
    if (!asset?.storage_path) throw new Error("clip has no source asset");
    const bucket = String(asset.storage_bucket ?? "campaign-assets");
    const signed = await signUrl(bucket, String(asset.storage_path));
    const meta = await probeClip(signed);
    const window = clipWindow({ fileSeconds: meta.durationInSeconds, inS, outS });
    const end = window.outS ?? meta.durationInSeconds;
    const durationS = Math.max(0, end - window.inS);
    // Seeded by clip, crop and window, and stored with the progress: every slice checks the same frames, a crop
    // change new ones. No gap between them over FACE_MAX_GAP_S, window start and end included (face-sampling.ts).
    progress ??= newProgress(
      planFrames(sampleTimes(durationS, FACE_SAMPLING, faceSampleSeed({ id: clipId, cropFocusX, cropFocusY, inS, outS })), meta.fps, durationS).map((p) => p.frame),
    );
    const ffmpeg = await ffmpegPath();
    const crop = cropWindow(meta.width, meta.height, cropFocusX);
    const k = 1080 / crop.width;
    let batch = 0;
    const slice = await runFaceCheckSlice({
      progress,
      durationS,
      sliceEnd: started + FACE_CHECK_SLICE_MS,
      deadline: started + FACE_CHECK_BUDGET_MS,
      estimateS: FACE_DETECT_ESTIMATE_S,
      stats,
      extract: (frames, timeoutMs) =>
        extractFaceFrames({ ffmpeg, url: signed, inS: window.inS, outS: end, frames, dir, side: FACE_FRAME_SIDE, timeoutMs, prefix: `x${batch++}_` }),
      scan: (timeoutMs) => scanFrameTimes({ ffmpeg, url: signed, inS: window.inS, outS: end, timeoutMs }),
      detect: async (file) => {
        const bytes = await readFile(join(dir, file));
        // Boxes come back in the scaled frame's pixels: back to the source's before the crop transform.
        const frameWidth = (await sharp(bytes).metadata()).width ?? meta.width;
        const toSource = meta.width / frameWidth;
        const found = await detectFaces(bytes, { minConfidence: 0.3 });
        return found.map((box) => ({
          left: (box.x * toSource - crop.left) * k,
          top: (box.y * toSource - crop.top) * k,
          width: box.width * toSource * k,
          height: box.height * toSource * k,
        }));
      },
      done: (file) => rm(join(dir, file), { force: true }),
    });
    progress = slice.progress;
    if (slice.status === "parked") {
      const kept = await parkFaceCheck(db, clipId, { stamp: claim.stamp, attempt: claim.attempt, since }, base, progress, slice.madeProgress, new Date());
      const why = slice.stopped === "stall" ? "an ffmpeg run stalled" : "slice time up";
      console.log(`${prefix}: parked (${why}${slice.madeProgress ? "" : ", no progress"}${kept ? "" : ", lost the claim, not saved"}); ${timing()}`);
      return "checking";
    }
    const finished = finishedSamples(progress, durationS);
    if (!finished.samples.length) throw new Error("no frames");
    const line =
      `${prefix}: ready; requested ${finished.requested}, returned ${finished.samples.length}, ` +
      `largest gap ${finished.largestGapS.toFixed(3)} s, window ${durationS.toFixed(1)} s (${FACE_SAMPLING.kind}${finished.scanned ? ", frame times scanned" : ""}); ` +
      `${timing()}; every slice: extract ${progress.extractS.toFixed(1)} s, scan ${progress.scanS.toFixed(1)} s, detect ${progress.detectS.toFixed(1)} s` +
      (progress.checked ? `, ${(progress.detectS / progress.checked).toFixed(2)} s per frame` : "");
    if (finished.hole) console.warn(`${line}; the source has no frame in a ${finished.largestGapS.toFixed(3)} s stretch, so the ${FACE_MAX_GAP_S} s gap isn't guaranteed on this clip`);
    else console.log(line);
    const kept = await write({ ...base, samples: finished.samples });
    if (!kept) {
      console.warn(`${prefix}: finished but the row changed under the claim; not stored`);
      return "checking";
    }
    return "ready";
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`${prefix}: failed after ${Date.now() - started} ms: ${message.slice(0, 120)}; ${timing()}`);
    await write({ ...base, error: message }).catch((writeErr: unknown) => {
      console.error(`${prefix}: storing the failure: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`);
    });
    return "failed";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** O40 p95 on the placed block. Never a reason to refuse. */
export async function recordPlacementContrast(db: ServiceRoleDb, renderId: string): Promise<void> {
  const renderRes = await db.from("creative_lab_renders").select("*").eq("id", renderId).maybeSingle();
  if (renderRes.error) throw new Error(`creative_lab_renders: ${renderRes.error.message}`);
  const render = renderRes.data as Row | null;
  if (!render || render.placement_center_y == null || render.placement_scale == null) return;
  const [clipRes, captionRes] = await Promise.all([
    db.from("creative_lab_clips").select("*").eq("id", String(render.clip_id)).maybeSingle(),
    db.from("creative_lab_captions").select("lines").eq("id", String(render.caption_id)).maybeSingle(),
  ]);
  if (clipRes.error) throw new Error(`creative_lab_clips: ${clipRes.error.message}`);
  if (captionRes.error) throw new Error(`creative_lab_captions: ${captionRes.error.message}`);
  const clip = clipRes.data as Row | null;
  const lines = Array.isArray((captionRes.data as Row | null)?.lines) ? ((captionRes.data as Row).lines as string[]) : [];
  if (!clip || !lines.length) return;
  const stored = readFaceSamples(clip.face_samples);
  if (!stored?.samples?.length) return;
  const assetRes = await db.from("creative_assets").select("*").eq("id", renderAssetId(clip)).maybeSingle();
  if (assetRes.error) throw new Error(`creative_assets: ${assetRes.error.message}`);
  const asset = assetRes.data as Row | null;
  if (!asset?.storage_path) return;
  const signed = await signUrl(String(asset.storage_bucket ?? "campaign-assets"), String(asset.storage_path));
  const meta = await probeClip(signed);
  const window = clipWindow({
    fileSeconds: meta.durationInSeconds,
    inS: num(clip.in_s, null),
    outS: num(clip.out_s, null),
  });
  const end = window.outS ?? meta.durationInSeconds;
  const boxes = captionBoxesAt(lines, Number(render.placement_scale), Number(render.placement_center_y));
  const union = unionBox(boxes);
  const share = await contrastShare({
    url: signed,
    inS: window.inS,
    outS: end,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    cropFocusX: num(clip.crop_focus_x, 0.5) ?? 0.5,
    union,
  });
  if (share == null) return;
  const update = await db.from("creative_lab_renders").update({ contrast: share }).eq("id", renderId);
  if (update.error) throw new Error(`creative_lab_renders: ${update.error.message}`);
}

async function contrastShare(args: {
  url: string;
  inS: number;
  outS: number;
  sourceWidth: number;
  sourceHeight: number;
  cropFocusX: number;
  union: Rect;
}): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), "caption-contrast-"));
  try {
    const ffmpeg = await ffmpegPath();
    await run(ffmpeg, [
      "-y", "-v", "error",
      "-ss", String(args.inS),
      "-t", String(Math.max(0, args.outS - args.inS)),
      "-i", args.url,
      "-r", String(T1V_FACE.fps),
      join(dir, "s%04d.png"),
    ], { maxBuffer: 4 * 1024 * 1024 });
    const frames = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
    const crop = cropWindow(args.sourceWidth, args.sourceHeight, args.cropFocusX);
    const shares: number[] = [];
    for (const name of frames) {
      const ground = await sharp(join(dir, name))
        .extract({
          left: Math.max(0, Math.round(crop.left)),
          top: Math.max(0, Math.round(crop.top)),
          width: Math.max(1, Math.round(crop.width)),
          height: Math.max(1, Math.round(crop.height)),
        })
        .resize(1080, 1920)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      shares.push(lowContrastShare(ground.data, ground.info.width, ground.info.channels, args.union));
    }
    return shares.length ? nearestRank(shares, 95) : null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function unionBox(boxes: readonly Rect[]): Rect {
  const left = Math.min(...boxes.map((box) => box.left));
  const top = Math.min(...boxes.map((box) => box.top));
  return {
    left,
    top,
    width: Math.max(...boxes.map((box) => box.left + box.width)) - left,
    height: Math.max(...boxes.map((box) => box.top + box.height)) - top,
  };
}
