/**
 * A 1080 render proxy for a large original (migration 220).
 *
 * The Lab only outputs 1080×1920. A 4K original's 9:16 crop is larger than
 * that, and on the 2048 MB caption Lambda both the frame-sheet still and
 * the caption render stop with a failed fetch from the compositor (9 Nov
 * 2026: one local process peaked at 2.03–2.07 GB on a 2160×3840 clip,
 * 1.32 GB on a 1080 copy of the same clip). So the import scales such an
 * original down to 1920 high, stores it as its own creative_assets row and
 * links it on creative_lab_clips.render_asset_id. Renders and the text
 * check read the proxy; creative_asset_id stays the original for Drive and
 * download.
 *
 * ffmpeg is ffmpeg-static (a static linux-x64 build on Vercel, so the
 * function image's glibc does not matter; the local platform build in the
 * scripts). It is imported lazily, so tests and every path that never
 * makes a proxy do not load it.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { snapRatio } from "../clients/asset-queue/aspect-detect.ts";
import { fingerprintBytes, upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

export const PROXY_WIDTH = 1080;
export const PROXY_HEIGHT = 1920;
const BUCKET = "campaign-assets";

export type ProxySize = { width: number; height: number };

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * The proxy size, or null when the original's 9:16 crop is 1080×1920 or
 * smaller. A source 9:16 or wider is cropped to its full height, so it is
 * scaled to 1920 high (2160×3840 → 1080×1920, 3840×2160 → 3414×1920). A
 * source narrower than 9:16 is cropped to its full width, so it is scaled
 * to 1080 wide. Sides are even: H.264 4:2:0 refuses an odd width, so
 * 3840×2160 gives 3414, not 3413.
 */
export function renderProxySize(width: number, height: number): ProxySize | null {
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) return null;
  const nineBySixteenOrWider = width / height >= PROXY_WIDTH / PROXY_HEIGHT;
  const scale = nineBySixteenOrWider ? PROXY_HEIGHT / height : PROXY_WIDTH / width;
  if (scale >= 1) return null;
  return { width: even(width * scale), height: even(height * scale) };
}

/** The asset a Lab render or text check reads: the proxy when there is one, else the original. */
export function renderAssetId(clip: Row | null | undefined): string {
  const proxy = clip?.render_asset_id;
  if (typeof proxy === "string" && proxy) return proxy;
  const original = clip?.creative_asset_id;
  return typeof original === "string" ? original : String(original ?? "");
}

/** Beside the original (videos/creative-lab/{artist}/{hash}.{ext}), keyed on the original's hash. */
export function proxyStoragePath(artistId: string, originalHash: string): string {
  return `videos/creative-lab/${artistId}/proxy-1080/${originalHash}.mp4`;
}

/** H.264 High at CRF 16 (O68's ceiling), Lanczos, a keyframe every second, the source's audio, moov first. */
export function ffmpegProxyArgs(input: string, output: string, size: ProxySize): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `scale=${size.width}:${size.height}:flags=lanczos,setsar=1`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-force_key_frames", "expr:gte(t,n_forced*1)",
    "-c:a", "aac", "-b:a", "256k",
    "-movflags", "+faststart",
    output,
  ];
}

export type RenderProxyMaker = (bytes: Buffer, size: ProxySize) => Promise<Buffer>;

async function ffmpegStaticPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const resolved = typeof mod === "string" ? mod : mod.default;
  if (!resolved) throw new Error("ffmpeg-static has no binary for this platform");
  return resolved;
}

/** Writes the original to a temp folder, runs ffmpeg, reads the proxy back, and removes the folder. */
export const makeRenderProxy: RenderProxyMaker = async (bytes, size) => {
  const ffmpeg = await ffmpegStaticPath();
  const dir = await mkdtemp(path.join(tmpdir(), "lab-proxy-"));
  try {
    const input = path.join(dir, "original");
    const output = path.join(dir, "proxy.mp4");
    await writeFile(input, bytes);
    await promisify(execFile)(ffmpeg, ffmpegProxyArgs(input, output, size), { maxBuffer: 4 * 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export type AttachedProxy = { assetId: string; storagePath: string; size: ProxySize; created: boolean };

/**
 * Makes, stores, registers and links the proxy for one clip. Null when the
 * original is small enough. A clip that already has render_asset_id is
 * left as it is (a re-run makes no second proxy).
 */
export async function attachRenderProxy(
  db: ServiceRoleDb,
  args: {
    clipId: string;
    userId: string;
    artistId: string;
    name: string;
    original: Buffer;
    width: number;
    height: number;
    durationSeconds: number | null;
    make?: RenderProxyMaker;
    upload: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
  },
): Promise<AttachedProxy | null> {
  const size = renderProxySize(args.width, args.height);
  if (!size) return null;

  const clip = await db.from("creative_lab_clips").select("id, render_asset_id").eq("id", args.clipId).maybeSingle();
  if (clip.error) throw new Error(clip.error.message);
  const linked = (clip.data as Row | null)?.render_asset_id;
  if (typeof linked === "string" && linked) {
    const asset = await db.from("creative_assets").select("storage_path").eq("id", linked).maybeSingle();
    if (asset.error) throw new Error(asset.error.message);
    return { assetId: linked, storagePath: String((asset.data as Row | null)?.storage_path ?? ""), size, created: false };
  }

  const make = args.make ?? makeRenderProxy;
  const proxy = await make(args.original, size);
  const storagePath = proxyStoragePath(args.artistId, fingerprintBytes(args.original).contentHash);
  await args.upload(storagePath, proxy, "video/mp4");
  const base = args.name.replace(/\.[^.]+$/, "");
  const registered = await upsertRegisteredAsset(db, {
    userId: args.userId,
    identity: fingerprintBytes(proxy),
    filename: `${base} (1080 proxy).mp4`,
    mediaKind: "video",
    aspectRatio: snapRatio(size.width, size.height),
    durationSeconds: args.durationSeconds,
    storageBucket: BUCKET,
    storagePath,
  });
  if (!registered.ok) throw new Error(registered.error);
  const updated = await db.from("creative_lab_clips").update({ render_asset_id: registered.asset.id }).eq("id", args.clipId);
  if (updated.error) throw new Error(updated.error.message);
  return { assetId: registered.asset.id, storagePath, size, created: true };
}
