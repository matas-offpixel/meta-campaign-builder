/**
 * VW1's run: decode a clip's sound and store its drops and window.
 *
 * The sound is read from the render copy (O68), else the original
 * (renderSourceAsset), through a signed Storage URL. ffmpeg reads the URL
 * itself (as the face check does), decodes the first audio stream only
 * (-vn: cover art and video are never decoded) to mono 16 kHz s16le on its
 * stdout, and nothing is written to disk: a 400 MB 4K original costs its
 * download, not /tmp. Ten minutes of sound is 19 MB in memory.
 *
 * Never blocks an import: storeClipDropsSafely catches everything, stores
 * the failure on the clip (VW3 then refuses it with the no-drop words) and
 * returns. The window detection writes is VW2's, into in_s / out_s, unless
 * the operator set one by hand that still keeps VW2's limits.
 */

import { spawn } from "node:child_process";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { DROP_RULE, analyseClipSound, pcmSamples } from "./clip-drops.ts";
import { mainDropOf, parseStoredDrops, windowState, type StoredDrops } from "./edit-window.ts";
import type { ServiceRoleDb } from "./load.ts";
import { ffmpegFailure, redactSecrets } from "./render-proxy.ts";
import { renderSourceAsset } from "./render-source.ts";

type Row = Record<string, unknown>;

/** The longest sound decoded, seconds. Past this the clip is far beyond any edit and the rest is not read. */
export const MAX_DECODE_S = 30 * 60;
const SIGNED_URL_SECONDS = 60 * 30;
const STDERR_KEEP = 64 * 1024;

/** ffmpeg: the first audio stream only, mono, 16 kHz, s16le, to stdout. */
export function dropDecodeArgs(input: string): string[] {
  return [
    "-hide_banner", "-nostats", "-nostdin",
    "-i", input,
    "-vn", "-sn", "-dn",
    "-map", "0:a:0",
    "-t", String(MAX_DECODE_S),
    "-ac", "1", "-ar", String(DROP_RULE.sampleRate),
    "-f", "s16le", "-acodec", "pcm_s16le",
    "pipe:1",
  ];
}

/** The container's length from ffmpeg's banner, seconds, or null. */
export function parseDurationS(stderr: string): number | null {
  const m = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!m) return null;
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/** True when ffmpeg refused because the file has no audio stream. */
export function noAudioStream(stderr: string): boolean {
  return /Stream map '0:a:0' matches no streams|does not contain any stream|Output file #0 does not contain any stream|matches no streams/i.test(stderr);
}

export type DecodedSound = { pcm: Uint8Array; stderr: string; noAudio: boolean };

/** The ffmpeg binary isn't on this function (only routes that trace it carry it; next.config.ts). Nothing is stored. */
export class FfmpegUnavailable extends Error {
  constructor() {
    super("ffmpeg is not available here");
    this.name = "FfmpegUnavailable";
  }
}
export type SoundDecoder = (url: string) => Promise<DecodedSound>;

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const resolved = typeof mod === "string" ? mod : mod.default;
  if (!resolved) throw new Error("ffmpeg-static has no binary for this platform");
  return resolved;
}

/** Spawns ffmpeg on the URL and keeps its stdout. A file with no audio stream resolves with noAudio. */
export const decodeClipSound: SoundDecoder = async (url) => {
  const bin = await ffmpegPath().catch(() => {
    throw new FfmpegUnavailable();
  });
  return new Promise<DecodedSound>((resolve, reject) => {
    const child = spawn(bin, dropDecodeArgs(url), { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_KEEP);
    });
    child.on("error", (err) => reject((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "EACCES" ? new FfmpegUnavailable() : ffmpegFailure(err)));
    child.on("close", (code, signal) => {
      if (code === 0) return resolve({ pcm: new Uint8Array(Buffer.concat(chunks)), stderr, noAudio: false });
      if (noAudioStream(stderr)) return resolve({ pcm: new Uint8Array(0), stderr, noAudio: true });
      reject(ffmpegFailure({ message: "ffmpeg", stderr, code: code ?? undefined, signal }));
    });
  });
};

/** VW1 on decoded sound, as stored. The clip's length is the container's, else the sound's. */
export function storedFromSound(decoded: DecodedSound, assetId: string): StoredDrops {
  const banner = parseDurationS(decoded.stderr);
  if (decoded.noAudio) {
    return { v: 1, status: "ok", assetId, durationS: Math.round((banner ?? 0) * 1000) / 1000, hasSound: false, lufs: null, candidates: [], mainS: null, peaks: [] };
  }
  const sound = analyseClipSound(pcmSamples(decoded.pcm));
  const durationS = Math.round((banner ?? sound.soundS) * 1000) / 1000;
  // VW7: the main drop is the last major candidate that fits VW2 on the clip's own length.
  const mainS = sound.hasSound ? mainDropOf({ candidates: sound.candidates, durationS })?.tS ?? null : null;
  return { v: 1, status: "ok", assetId, durationS, hasSound: sound.hasSound, lufs: sound.lufs, candidates: sound.candidates, mainS, peaks: sound.peaks };
}

/** The columns a detection writes: the drops, and VW2's window unless a hand-set one still fits. */
export function columnsAfterDetection(drops: StoredDrops, clip: Row, now: Date): Row {
  const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const byHand = clip.window_by_hand === true;
  const state = windowState(drops, {
    dropS: num(clip.window_drop_s),
    byHand,
    inS: byHand ? num(clip.in_s) : null,
    outS: byHand ? num(clip.out_s) : null,
  });
  const base: Row = { drops, drops_at: now.toISOString() };
  if (state.kind !== "ok") return { ...base, window_drop_s: null, window_by_hand: false };
  // VW9: a window set by hand that still fits is kept with its drop; a detected one follows VW7's main drop.
  return {
    ...base,
    in_s: state.window.inS,
    out_s: state.window.outS,
    window_drop_s: state.byHand ? state.window.dropS : null,
    window_by_hand: state.byHand,
  };
}

function storageAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase storage admin requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  return createSupabaseClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function defaultSign(bucket: string, objectPath: string): Promise<string> {
  const { data, error } = await storageAdmin().storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`signed url: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

export type DetectDeps = {
  sign?: (bucket: string, objectPath: string) => Promise<string>;
  decode?: SoundDecoder;
  now?: () => Date;
};

export type DetectResult = { clipId: string; drops: StoredDrops; columns: Row };

/** Reads the clip's render source and runs VW1. Writes nothing. Throws on a missing row or file, or a failed decode. */
export async function detectClipDrops(db: ServiceRoleDb, clipId: string, deps: DetectDeps = {}): Promise<DetectResult> {
  const clipRes = await db.from("creative_lab_clips").select("id, render_asset_id, creative_asset_id, in_s, out_s, window_drop_s, window_by_hand").eq("id", clipId).maybeSingle();
  if (clipRes.error) throw new Error(clipRes.error.message);
  const clip = clipRes.data as Row | null;
  if (!clip) throw new Error("No clip with that id.");
  const { assetId } = renderSourceAsset(clip);
  const assetRes = await db.from("creative_assets").select("storage_bucket, storage_path").eq("id", assetId).maybeSingle();
  if (assetRes.error) throw new Error(assetRes.error.message);
  const asset = assetRes.data as Row | null;
  const path = String(asset?.storage_path ?? "").trim();
  if (!path) throw new Error("The clip's file isn't in Storage.");
  const url = await (deps.sign ?? defaultSign)(String(asset?.storage_bucket ?? "").trim() || "campaign-assets", path);
  const decoded = await (deps.decode ?? decodeClipSound)(url);
  const drops = storedFromSound(decoded, assetId);
  return { clipId, drops, columns: columnsAfterDetection(drops, clip, (deps.now ?? (() => new Date()))()) };
}

/** Writes a detection's columns, and the window onto the clip's made triple-fit (it cuts its source's window). */
export async function writeClipDrops(db: ServiceRoleDb, result: DetectResult): Promise<void> {
  const res = await db.from("creative_lab_clips").update(result.columns).eq("id", result.clipId);
  if (res.error) throw new Error(res.error.message);
  if ("in_s" in result.columns) {
    const made = await db.from("creative_lab_clips").update({ in_s: result.columns.in_s, out_s: result.columns.out_s }).eq("triple_fit_source_id", result.clipId);
    if (made.error) throw new Error(made.error.message);
  }
}

/** The failure, as stored: VW3 refuses the clip until a re-run succeeds. */
export function failedDrops(error: unknown, assetId: string | null): StoredDrops {
  const message = error instanceof Error ? error.message : String(error);
  return { v: 1, status: "failed", assetId, error: redactSecrets(message).replace(/\s+/g, " ").slice(0, 300) };
}

/**
 * At import: detect and store, never throwing. A failure is stored on the
 * clip and logged without the URL. Returns what was stored, or null when
 * even the failure couldn't be written (the backfill then finds the clip
 * unchecked).
 */
export async function storeClipDropsSafely(db: ServiceRoleDb, clipId: string, deps: DetectDeps = {}): Promise<StoredDrops | null> {
  try {
    const result = await detectClipDrops(db, clipId, deps);
    await writeClipDrops(db, result);
    return result.drops;
  } catch (err) {
    // Not this clip's fault: leave it unchecked for the pickup's sweep or the backfill.
    if (err instanceof FfmpegUnavailable) return null;
    const drops = failedDrops(err, null);
    console.warn(JSON.stringify({ step: "clip_drops", clipId, error: drops.status === "failed" ? drops.error.slice(0, 160) : "" }));
    try {
      const res = await db.from("creative_lab_clips").update({ drops, drops_at: (deps.now ?? (() => new Date()))().toISOString(), window_drop_s: null, window_by_hand: false }).eq("id", clipId);
      if (res.error) return null;
      return drops;
    } catch {
      return null;
    }
  }
}

/** True when the stored drops are missing, failed, or read from a render source the clip no longer has. */
export function dropsNeedCheck(clip: Row): boolean {
  const drops = parseStoredDrops(clip.drops);
  if (!drops || drops.status === "failed") return true;
  try {
    return drops.assetId !== renderSourceAsset(clip).assetId;
  } catch {
    return false;
  }
}

/** The sweep looks back this far: a clip imported where ffmpeg isn't (the Instagram add, the upload) is checked within a day. Older clips are the backfill's. */
export const SWEEP_LOOKBACK_MS = 48 * 60 * 60 * 1000;

/**
 * Checks up to `limit` clips imported in the last 48 h that have no drops
 * yet. A made triple-fit is never checked: it cuts its source's window.
 * Before migration 258 the select fails and the sweep reports that, nothing
 * else.
 */
export async function sweepClipDrops(db: ServiceRoleDb, args: { limit: number; now?: Date; deps?: DetectDeps }): Promise<{ checked: number; refused: number; failed: number; skippedReason?: string }> {
  const now = args.now ?? new Date();
  const since = new Date(now.getTime() - SWEEP_LOOKBACK_MS).toISOString();
  const res = await db
    .from("creative_lab_clips")
    .select("id")
    .is("drops", null)
    .is("triple_fit_source_id", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(args.limit);
  if (res.error) return { checked: 0, refused: 0, failed: 0, skippedReason: "drops column not readable (migration 258)" };
  let checked = 0;
  let refused = 0;
  let failed = 0;
  for (const row of (res.data ?? []) as Row[]) {
    const drops = await storeClipDropsSafely(db, String(row.id), { ...args.deps, now: () => now });
    if (!drops) continue;
    checked += 1;
    if (drops.status === "failed") failed += 1;
    else if (windowState(drops, { dropS: null, byHand: false, inS: null, outS: null }).kind === "refused") refused += 1;
  }
  return { checked, refused, failed };
}
