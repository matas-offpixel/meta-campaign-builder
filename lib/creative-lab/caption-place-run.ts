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
  type StoredFaceRect,
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
import { FACE_CHECK_BUDGET_MS, FACE_CHECK_TIMED_OUT, FACE_DETECTOR, FACE_SAMPLE_FPS } from "./caption-placement.ts";

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

/** Frames from the clip window, faces in 1080×1920 output pixels. */
export async function detectClipFaces(args: {
  url: string;
  inS: number;
  outS: number;
  sourceWidth: number;
  sourceHeight: number;
  cropFocusX: number;
  /** Samples a second (FACE_SAMPLE_FPS). */
  fps?: number;
  /** Past this (ms since epoch) the check stops and throws FACE_CHECK_TIMED_OUT, before the function limit. */
  deadline?: number;
}): Promise<StoredFaceRect[][]> {
  const { detectFaces } = await import("./face-detect.ts");
  const fps = args.fps ?? FACE_SAMPLE_FPS;
  const dir = await mkdtemp(join(tmpdir(), "caption-place-"));
  try {
    const ffmpeg = await ffmpegPath();
    await run(ffmpeg, [
      "-y", "-v", "error",
      "-ss", String(args.inS),
      "-t", String(Math.max(0, args.outS - args.inS)),
      "-i", args.url,
      // Frames at most FACE_FRAME_SIDE on the long side: the detector resizes to that anyway, and full-size 4K
      // PNGs cost ~21 s a frame to write, decode and re-encode (review of #1311) against ~3.5 s at 1080.
      "-vf", `fps=${fps},scale=${FACE_FRAME_SIDE}:${FACE_FRAME_SIDE}:force_original_aspect_ratio=decrease`,
      join(dir, "s%04d.png"),
    ], {
      maxBuffer: 4 * 1024 * 1024,
      // A stalled extract over the signed URL stops inside the budget, not at the function's kill.
      timeout: Math.max(1_000, (args.deadline ?? Date.now() + FACE_CHECK_BUDGET_MS) - Date.now()),
    });
    const frames = (await readdir(dir)).filter((name) => name.endsWith(".png")).sort();
    const crop = cropWindow(args.sourceWidth, args.sourceHeight, args.cropFocusX);
    const k = 1080 / crop.width;
    const faces: StoredFaceRect[][] = [];
    for (const name of frames) {
      if (args.deadline != null && Date.now() > args.deadline) {
        throw new Error(`${FACE_CHECK_TIMED_OUT} (${faces.length} of ${frames.length} frames in ${Math.round(FACE_CHECK_BUDGET_MS / 1000)} s)`);
      }
      const bytes = await readFile(join(dir, name));
      // Boxes come back in the scaled frame's pixels: back to the source's before the crop transform.
      const frameWidth = (await sharp(bytes).metadata()).width ?? args.sourceWidth;
      const toSource = args.sourceWidth / frameWidth;
      const found = await detectFaces(bytes, { minConfidence: 0.3 });
      faces.push(found.map((box) => ({
        left: (box.x * toSource - crop.left) * k,
        top: (box.y * toSource - crop.top) * k,
        width: box.width * toSource * k,
        height: box.height * toSource * k,
      })));
    }
    return faces;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type Row = Record<string, unknown>;

function num(value: unknown, fallback: number | null): number | null {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Detect one clip and store the samples, or the failure, for its current crop and window. */
export async function ensureClipFaces(db: ServiceRoleDb, clipId: string): Promise<"ready" | "failed"> {
  const clipRes = await db.from("creative_lab_clips").select("*").eq("id", clipId).maybeSingle();
  if (clipRes.error) throw new Error(`creative_lab_clips: ${clipRes.error.message}`);
  const clip = clipRes.data as Row | null;
  if (!clip) return "failed";
  const cropFocusX = num(clip.crop_focus_x, 0.5) ?? 0.5;
  const cropFocusY = num(clip.crop_focus_y, 0.5) ?? 0.5;
  const inS = num(clip.in_s, null);
  const outS = num(clip.out_s, null);
  const stamp = new Date().toISOString();
  const base = { detector: FACE_DETECTOR, fps: FACE_SAMPLE_FPS, cropFocusX, cropFocusY, inS, outS };
  const started = Date.now();
  try {
    const assetRes = await db.from("creative_assets").select("*").eq("id", renderAssetId(clip)).maybeSingle();
    if (assetRes.error) throw new Error(`creative_assets: ${assetRes.error.message}`);
    const asset = assetRes.data as Row | null;
    if (!asset?.storage_path) throw new Error("clip has no source asset");
    const bucket = String(asset.storage_bucket ?? "campaign-assets");
    const signed = await signUrl(bucket, String(asset.storage_path));
    const meta = await probeClip(signed);
    const window = clipWindow({
      fileSeconds: meta.durationInSeconds,
      inS,
      outS,
    });
    const end = window.outS ?? meta.durationInSeconds;
    const frames = await detectClipFaces({
      url: signed,
      inS: window.inS,
      outS: end,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      cropFocusX,
      fps: FACE_SAMPLE_FPS,
      deadline: started + FACE_CHECK_BUDGET_MS,
    });
    if (!frames.length) throw new Error("no frames");
    // Time per clip, for the function limit (17 Nov 2026: 5 fps never finished in 800 s).
    console.log(`[creative-lab-face-check] clip ${clipId}: ${frames.length} frames at ${FACE_SAMPLE_FPS} fps in ${Date.now() - started} ms`);
    const body: StoredFaceSamples = {
      ...base,
      samples: frames.map((faces, i) => ({ t: i / FACE_SAMPLE_FPS, faces })),
    };
    const update = await db.from("creative_lab_clips").update({ face_samples: body, face_samples_at: stamp }).eq("id", clipId);
    if (update.error) throw new Error(`creative_lab_clips: ${update.error.message}`);
    return "ready";
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.error(`[creative-lab-face-check] clip ${clipId}: failed after ${Date.now() - started} ms: ${message.slice(0, 120)}`);
    const body: StoredFaceSamples = { ...base, error: message };
    await db.from("creative_lab_clips").update({ face_samples: body, face_samples_at: stamp }).eq("id", clipId);
    return "failed";
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
