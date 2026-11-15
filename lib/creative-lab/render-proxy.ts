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
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { snapRatio } from "../clients/asset-queue/aspect-detect.ts";
import { fingerprintBytes, upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import { fingerprintFile } from "../creatives/stream-file.ts";
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

/**
 * The 9:16 column copy (Matas, 11 Nov: video is one 9:16, read in Feed's
 * centre 4:5 crop and the Reels / Stories safe zones). The original's
 * centred 9:16 window — the full height of a landscape frame, the full
 * width of a portrait one — scaled to 1080 × 1920. Used for an original
 * kept in Drive (migration 228): the whole-frame copy of the Rossi-show
 * 4K is 246–559 MB at CRF 16, over the storage cap, and this one is under.
 */
export const COLUMN_SIZE: ProxySize = { width: PROXY_WIDTH, height: PROXY_HEIGHT };

/** ffmpeg for the column copy: #1176's settings (Lanczos, CRF 16, a keyframe a second, AAC, moov first) after a centred 9:16 crop. */
export function ffmpegColumnArgs(input: string, output: string): string[] {
  const args = ffmpegProxyArgs(input, output, COLUMN_SIZE);
  const vf = args.indexOf("-vf");
  args[vf + 1] = `crop='trunc(min(iw,ih*9/16)/2)*2':'trunc(min(ih,iw*16/9)/2)*2',scale=${COLUMN_SIZE.width}:${COLUMN_SIZE.height}:flags=lanczos,setsar=1`;
  return args;
}

async function ffmpegStaticPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const resolved = typeof mod === "string" ? mod : mod.default;
  if (!resolved) throw new Error("ffmpeg-static has no binary for this platform");
  return resolved;
}

async function runFfmpeg(bytes: Buffer, args: (input: string, output: string) => string[]): Promise<Buffer> {
  const ffmpeg = await ffmpegStaticPath();
  const dir = await mkdtemp(path.join(tmpdir(), "lab-proxy-"));
  try {
    const input = path.join(dir, "original");
    const output = path.join(dir, "proxy.mp4");
    await writeFile(input, bytes);
    await promisify(execFile)(ffmpeg, args(input, output), { maxBuffer: 4 * 1024 * 1024 }).catch((err: unknown) => {
      throw ffmpegFailure(err);
    });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The file-to-file maker: reads the original at `input`, writes the copy to
 * `output`. Neither is held in memory, so a 400–450 MB 4K original costs
 * disk, not the function's memory (11 Nov 2026: two Rossi-show originals
 * read into Buffers killed the Drive pickup).
 */
export type FileProxyMaker = (input: string, output: string, size: ProxySize) => Promise<void>;

/** A copy over the cap it may be stored under. Thrown before anything is uploaded. */
export class ProxyOverLimit extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super("render copy over the storage cap");
    this.name = "ProxyOverLimit";
    this.bytes = bytes;
  }
}

/** The stored line for a failed import is cut here (cron_runs detail, the pickup's errors). */
export const FAILURE_REASON_MAX = 300;

/**
 * ffmpeg's ways of saying the output disk is full (11 Nov 2026, SWEELY 1.mp4:
 * "[vost#0:0/libx264 @ …] Error submitting a packet to the muxer: No space
 * left on device"; the macOS build says "No space left on device" beside
 * "Error muxing a packet").
 */
const NO_SPACE = /ENOSPC|No space left on device|Error submitting a packet/i;
/** A stderr line that names the failure. */
const CAUSE = /error|invalid|fail|no such|denied|not found|space|unable|could not|cannot/i;

/** Removes URLs, Authorization / Bearer values, and query-string keys and tokens from text that may be stored or logged. */
export function redactSecrets(text: string): string {
  return text
    .replace(/(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',]+/gi, "$1[redacted]")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi, "[url]")
    .replace(/([?&](?:access_token|token|key|sig|signature)=)[^&\s]+/gi, "$1[redacted]");
}

/** A failed ffmpeg run, with the useful part first: ffmpeg's own message, never the command line. */
export class FfmpegFailed extends Error {
  /** The output disk filled up. */
  readonly noSpace: boolean;
  constructor(message: string, noSpace: boolean) {
    super(message);
    this.name = "FfmpegFailed";
    this.noSpace = noSpace;
  }
}

/**
 * execFile's error says "Command failed: {the whole command}\n{stderr}", and
 * the stored reason was cut at 300 characters inside the command line. This
 * keeps ffmpeg's last stderr lines, the ones naming the failure first, drops the command,
 * redacts URLs and credentials, and caps the length.
 */
export function ffmpegFailure(err: unknown): FfmpegFailed {
  const e = (err ?? {}) as { message?: string; stderr?: string | Buffer; code?: string | number; signal?: string | null };
  const message = String(e.message ?? "");
  const stderr = e.stderr != null && String(e.stderr).trim() ? String(e.stderr) : message.split("\n").slice(1).join("\n");
  const lines = stderr
    .split("\n")
    .map((line) => line.replace(/^\s*\[[^\]]*@\s*0x[0-9a-f]+\]\s*/i, "").trim())
    .filter(Boolean);
  const noSpace = e.code === "ENOSPC" || NO_SPACE.test(stderr) || NO_SPACE.test(message);
  // The lines that say what went wrong first, in ffmpeg's order; each capped so one long line can't crowd out the cause.
  const tail = lines.slice(-4);
  const telling = tail.filter((line) => CAUSE.test(line));
  const ranked = [...telling, ...tail.filter((line) => !CAUSE.test(line))].map((line) => (line.length > 140 ? `${line.slice(0, 139)}…` : line));
  const cause = e.signal ? `killed by ${e.signal}` : ranked.length ? ranked.join(" · ") : `exit ${String(e.code ?? "unknown")}`;
  const text = redactSecrets(`ffmpeg: ${cause}`).replace(/\s+/g, " ").trim();
  return new FfmpegFailed(text.length > FAILURE_REASON_MAX ? `${text.slice(0, FAILURE_REASON_MAX - 1)}…` : text, noSpace);
}

async function execFfmpeg(args: string[]): Promise<void> {
  const ffmpeg = await ffmpegStaticPath();
  try {
    await promisify(execFile)(ffmpeg, args, { maxBuffer: 4 * 1024 * 1024 });
  } catch (err) {
    throw ffmpegFailure(err);
  }
}

/** ffmpeg file to file, at the proxy size. */
export const makeRenderProxyFile: FileProxyMaker = (input, output, size) => execFfmpeg(ffmpegProxyArgs(input, output, size));

/** ffmpeg file to file, the 9:16 column (COLUMN_SIZE); the size argument is ignored. */
export const makeColumnProxyFile: FileProxyMaker = (input, output) => execFfmpeg(ffmpegColumnArgs(input, output));

/** Writes the original to a temp folder, runs ffmpeg, reads the proxy back, and removes the folder. */
export const makeRenderProxy: RenderProxyMaker = async (bytes, size) => runFfmpeg(bytes, (input, output) => ffmpegProxyArgs(input, output, size));

/** The column copy (COLUMN_SIZE); the size argument is ignored. */
export const makeColumnProxy: RenderProxyMaker = async (bytes) => runFfmpeg(bytes, ffmpegColumnArgs);

export type FileUpload = (storagePath: string, filePath: string, contentType: string) => Promise<void>;

/** The original on disk, with the fingerprint taken while it was written. */
export type OriginalFile = { path: string; contentHash: string };

/**
 * storeRenderProxy for an original on disk: ffmpeg writes the copy to a temp
 * folder beside nothing else, its size is read with stat and its hash by
 * streaming, and it is uploaded from the file. `maxBytes` refuses a copy
 * over the cap (ProxyOverLimit) before the upload. The temp folder is
 * removed whatever happens.
 */
export async function storeRenderProxyFile(
  db: ServiceRoleDb,
  args: {
    userId: string;
    artistId: string;
    name: string;
    original: OriginalFile;
    size: ProxySize;
    durationSeconds: number | null;
    make?: FileProxyMaker;
    maxBytes?: number;
    uploadFile: FileUpload;
  },
): Promise<{ assetId: string; storagePath: string; size: ProxySize }> {
  const make = args.make ?? makeRenderProxyFile;
  const dir = await mkdtemp(path.join(tmpdir(), "lab-proxy-"));
  try {
    const output = path.join(dir, "proxy.mp4");
    await make(args.original.path, output, args.size);
    const { size: bytes } = await stat(output);
    if (args.maxBytes != null && bytes > args.maxBytes) throw new ProxyOverLimit(bytes);
    const identity = await fingerprintFile(output);
    const storagePath = proxyStoragePath(args.artistId, args.original.contentHash);
    await args.uploadFile(storagePath, output, "video/mp4");
    const base = args.name.replace(/\.[^.]+$/, "");
    const registered = await upsertRegisteredAsset(db, {
      userId: args.userId,
      identity,
      filename: `${base} (1080 proxy).mp4`,
      mediaKind: "video",
      aspectRatio: snapRatio(args.size.width, args.size.height),
      durationSeconds: args.durationSeconds,
      storageBucket: BUCKET,
      storagePath,
    });
    if (!registered.ok) throw new Error(registered.error);
    return { assetId: registered.asset.id, storagePath, size: args.size };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** attachRenderProxy for an original on disk (storeRenderProxyFile, then the link). */
export async function attachRenderProxyFile(
  db: ServiceRoleDb,
  args: {
    clipId: string;
    userId: string;
    artistId: string;
    name: string;
    original: OriginalFile;
    width: number;
    height: number;
    durationSeconds: number | null;
    make?: FileProxyMaker;
    uploadFile: FileUpload;
  },
): Promise<AttachedProxy | null> {
  const size = renderProxySize(args.width, args.height);
  if (!size) return null;
  const existing = await linkedProxy(db, args.clipId, size);
  if (existing) return existing;
  const stored = await storeRenderProxyFile(db, { ...args, size });
  await linkProxy(db, args.clipId, stored.assetId);
  return { ...stored, created: true };
}

async function linkedProxy(db: ServiceRoleDb, clipId: string, size: ProxySize): Promise<AttachedProxy | null> {
  const clip = await db.from("creative_lab_clips").select("id, render_asset_id").eq("id", clipId).maybeSingle();
  if (clip.error) throw new Error(clip.error.message);
  const linked = (clip.data as Row | null)?.render_asset_id;
  if (!(typeof linked === "string" && linked)) return null;
  const asset = await db.from("creative_assets").select("storage_path").eq("id", linked).maybeSingle();
  if (asset.error) throw new Error(asset.error.message);
  return { assetId: linked, storagePath: String((asset.data as Row | null)?.storage_path ?? ""), size, created: false };
}

async function linkProxy(db: ServiceRoleDb, clipId: string, assetId: string): Promise<void> {
  const updated = await db.from("creative_lab_clips").update({ render_asset_id: assetId }).eq("id", clipId);
  if (updated.error) throw new Error(updated.error.message);
}

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

  const existing = await linkedProxy(db, args.clipId, size);
  if (existing) return existing;

  const stored = await storeRenderProxy(db, { ...args, size });
  await linkProxy(db, args.clipId, stored.assetId);
  return { ...stored, created: true };
}

/**
 * Makes, stores and registers the proxy, without linking it to a clip.
 * The Drive-master import (migration 228) calls it before the clip row
 * exists, so the clip is inserted with render_asset_id already set; a
 * failure then leaves no clip behind.
 */
export async function storeRenderProxy(
  db: ServiceRoleDb,
  args: {
    userId: string;
    artistId: string;
    name: string;
    original: Buffer;
    size: ProxySize;
    durationSeconds: number | null;
    make?: RenderProxyMaker;
    upload: (storagePath: string, bytes: Buffer, contentType: string) => Promise<void>;
  },
): Promise<{ assetId: string; storagePath: string; size: ProxySize }> {
  const make = args.make ?? makeRenderProxy;
  const proxy = await make(args.original, args.size);
  const storagePath = proxyStoragePath(args.artistId, fingerprintBytes(args.original).contentHash);
  await args.upload(storagePath, proxy, "video/mp4");
  const base = args.name.replace(/\.[^.]+$/, "");
  const registered = await upsertRegisteredAsset(db, {
    userId: args.userId,
    identity: fingerprintBytes(proxy),
    filename: `${base} (1080 proxy).mp4`,
    mediaKind: "video",
    aspectRatio: snapRatio(args.size.width, args.size.height),
    durationSeconds: args.durationSeconds,
    storageBucket: BUCKET,
    storagePath,
  });
  if (!registered.ok) throw new Error(registered.error);
  return { assetId: registered.asset.id, storagePath, size: args.size };
}
