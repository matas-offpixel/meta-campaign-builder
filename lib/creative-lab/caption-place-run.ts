/**
 * C1–C4 on a real clip. Faces are detected once, then every in-point is
 * judged with T1's judgeFaceOverTime. Contrast is measured on the place
 * that passes and stored, never used to refuse.
 * Not imported by a route. render-caption is at the function-size cap, and
 * face-detect is script-side only. The render takes `deps.place`.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";

import { lowContrastShare, type Rect } from "./artist-card.ts";
import {
  captionBoxesAt,
  labInPoints,
  searchPlacement,
  type PlaceHit,
  type PlaceMiss,
} from "./caption-placement.ts";
import { cropWindow } from "../../src/remotion/caption-style/profile.ts";
import { judgeFaceOverTime, nearestRank, T1V_FACE, type FaceSample } from "./t1-video.ts";

const run = promisify(execFile);

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as { default?: string | null } | string;
  const path = typeof mod === "string" ? mod : mod.default;
  if (!path) throw new Error("ffmpeg-static has no binary for this platform");
  return path;
}

export async function placeCaptionOnClip(args: {
  lines: readonly string[];
  baseScale: number;
  kind: "caption" | "quote";
  inS: number;
  outS: number;
  url: string;
  sourceWidth: number;
  sourceHeight: number;
  cropFocusX: number;
}): Promise<PlaceHit | PlaceMiss> {
  const { detectFaces } = await import("./face-detect.ts");
  const dir = await mkdtemp(join(tmpdir(), "caption-place-"));
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
    const k = 1080 / crop.width;
    const samples: { tS: number; faces: Rect[]; png: string }[] = [];
    for (const [i, name] of frames.entries()) {
      const png = join(dir, name);
      const faces = await detectFaces(await readFile(png), { minConfidence: 0.3 });
      samples.push({
        tS: i / T1V_FACE.fps,
        png,
        faces: faces.map((box) => ({
          left: (box.x - crop.left) * k,
          top: (box.y - crop.top) * k,
          width: box.width * k,
          height: box.height * k,
        })),
      });
    }
    const from = (start: number): FaceSample[] => samples
      .filter((sample) => sample.tS >= start - args.inS - 1e-6)
      .map((sample) => ({ tS: sample.tS - (start - args.inS), faces: sample.faces }));
    const found = searchPlacement({
      lines: args.lines,
      baseScale: args.baseScale,
      inPoints: labInPoints(args.inS, args.outS),
      kind: args.kind,
      judge: ({ boxes, inS }) => {
        const verdict = judgeFaceOverTime(from(inS), { always: boxes, claim: null }, { frameWidth: 1080 });
        return { ok: verdict.ok, topShare: verdict.topShare, longestRunS: verdict.longestRunS };
      },
    });
    if (!found.ok) return found;
    const boxes = captionBoxesAt(args.lines, found.scale, found.centre);
    const union = unionBox(boxes);
    const shares: number[] = [];
    for (const sample of samples.filter((item) => item.tS >= found.inS - args.inS - 1e-6)) {
      const ground = await sharp(sample.png)
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
      shares.push(lowContrastShare(ground.data, ground.info.width, ground.info.channels, union));
    }
    return { ...found, contrast: shares.length ? nearestRank(shares, 95) : null };
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
