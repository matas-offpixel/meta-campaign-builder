/**
 * Burn one caption onto one clip and register the mp4.
 *
 * Runs only from a route under /api/admin/remotion/**. next.config.ts
 * traces the Remotion bundle, the compositor and @sparticuz/chromium into
 * that path alone; anywhere else the bundle and Chrome are missing at
 * runtime. One creative_lab_renders row per call. No Meta or TikTok calls.
 *
 * The clip is probed with getVideoMetadata (@remotion/renderer) and the
 * output matches the source: a 720-wide source stays 720 wide, and a 4:5
 * render is a same-width crop. Never upscaled.
 *
 * The Vercel function image lacks glibc 2.35, so
 * @remotion/compositor-linux-x64-gnu does not start (`libm.so.6: version
 * GLIBC_2.35 not found`). Verified 5 Nov 2026 on Node 22.x and on Node 26.x.
 * The project setting is 24.x; `engines` `>=22` selects 26.x, so 24.x did
 * not run. The render path moves to Remotion Lambda in M2b.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { fingerprintBytes, upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import type { CaptionOnClipProps } from "../../src/remotion/compositions/CaptionOnClip.tsx";
import { outputSize, profile, styleVersion, type CaptionAspect } from "../../src/remotion/caption-style/profile.ts";
import type { ServiceRoleDb } from "./load.ts";

export const OFFTHREAD_VIDEO_CACHE_BYTES = 512 * 1024 * 1024;
const COMPOSITION_ID = "CaptionOnClip";
const BUCKET = "campaign-assets";
const SIGNED_URL_SECONDS = 60 * 30;

export type Probe = { width: number; height: number; fps: number; durationInSeconds: number };

export type CaptionRenderRequest = { props: CaptionOnClipProps; muted: boolean };

export type RenderDeps = {
  signUrl: (bucket: string, objectPath: string) => Promise<string>;
  probe: (url: string) => Promise<Probe>;
  renderToFile: (req: CaptionRenderRequest) => Promise<{ bytes: Uint8Array; renderMs: number }>;
  upload: (objectPath: string, bytes: Uint8Array) => Promise<void>;
};

type RowResult = { data: Record<string, unknown> | null; error: { message: string } | null };
type ListResult = { error: { message: string } | null };

interface Loose extends PromiseLike<ListResult> {
  select(columns: string): Loose;
  eq(column: string, value: unknown): Loose;
  update(patch: Record<string, unknown>): Loose;
  maybeSingle(): Promise<RowResult>;
}

function q(db: ServiceRoleDb, table: string): Loose {
  return db.from(table) as unknown as Loose;
}

async function one(db: ServiceRoleDb, table: string, id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await q(db, table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function patchRender(db: ServiceRoleDb, id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await q(db, "creative_lab_renders").update(patch).eq("id", id);
  if (error) throw new Error(`creative_lab_renders: ${error.message}`);
}

function storageAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase storage admin requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createSupabaseClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

async function defaultSign(bucket: string, objectPath: string): Promise<string> {
  const { data, error } = await storageAdmin().storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`signed url for ${objectPath}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

async function defaultUpload(objectPath: string, bytes: Uint8Array): Promise<void> {
  const { error } = await storageAdmin().storage.from(BUCKET).upload(objectPath, bytes, { contentType: "video/mp4", upsert: false });
  if (error) throw new Error(`storage upload: ${error.message}`);
}

/** Probe with Remotion's getVideoMetadata. Dynamic import so the tests never load the renderer. */
export async function probeClip(url: string): Promise<Probe> {
  const { getVideoMetadata } = await import("@remotion/renderer");
  const meta = await getVideoMetadata(url);
  if (!meta.width || !meta.height || !meta.durationInSeconds) throw new Error("clip has no dimensions or duration");
  return { width: meta.width, height: meta.height, fps: meta.fps || 30, durationInSeconds: meta.durationInSeconds };
}

/**
 * renderMedia, h264, veryfast, with the off-thread video cache capped at
 * 512 MB. `browserExecutable` null lets Remotion use its own Chrome (the
 * local reference check); the Vercel route passes @sparticuz/chromium.
 */
export async function renderCaptionWithRemotion(
  req: CaptionRenderRequest,
  env: { serveUrl: string; browserExecutable: string | null; outputLocation: string },
): Promise<{ bytes: Uint8Array; renderMs: number }> {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const inputProps = req.props as unknown as Record<string, unknown>;
  const composition = await selectComposition({
    serveUrl: env.serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    browserExecutable: env.browserExecutable,
  });
  const started = Date.now();
  await renderMedia({
    composition,
    serveUrl: env.serveUrl,
    codec: "h264",
    outputLocation: env.outputLocation,
    inputProps,
    imageFormat: "jpeg",
    pixelFormat: "yuv420p",
    crf: 23,
    x264Preset: "veryfast",
    offthreadVideoCacheSizeInBytes: OFFTHREAD_VIDEO_CACHE_BYTES,
    muted: req.muted,
    browserExecutable: env.browserExecutable,
    concurrency: 1,
  });
  return { bytes: new Uint8Array(await fs.readFile(env.outputLocation)), renderMs: Date.now() - started };
}

/** 'cleared' plays the clip's own audio, the same as 'original'. */
export function audioMode(status: string): CaptionOnClipProps["audio"] {
  if (status === "muted") return "muted";
  if (status === "replaced") return "replaced";
  return "original";
}

function asAspect(value: unknown): CaptionAspect {
  if (value === "9:16" || value === "4:5") return value;
  throw new Error(`aspect ${String(value)} is not 9:16 or 4:5`);
}

function asLines(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) throw new Error("caption lines are missing");
  return value as string[];
}

function storageName(renderId: string, aspect: CaptionAspect): string {
  return `videos/creative-lab/${renderId}-${aspect === "9:16" ? "9x16" : "4x5"}.mp4`;
}

export type RenderOutcome = {
  renderId: string;
  renderMs: number;
  creativeAssetId: string;
  aspect: CaptionAspect;
  width: number;
  height: number;
  storagePath: string;
  durationSeconds: number;
};

/**
 * Read the render row, burn the caption, upload the mp4 and point the row
 * at the new creative_assets row. On any failure the row is `failed` with
 * the error, and the error is rethrown.
 */
export async function renderCaptionOnClip(
  db: ServiceRoleDb,
  input: {
    renderId: string;
    userId: string;
    serveUrl?: string;
    browserExecutable?: string | null;
    deps?: Partial<RenderDeps>;
  },
): Promise<RenderOutcome> {
  const render = await one(db, "creative_lab_renders", input.renderId);
  if (!render) throw new Error(`render ${input.renderId} not found`);
  if (render.user_id !== input.userId) throw new Error("render belongs to another user");

  const started = Date.now();
  await patchRender(db, input.renderId, { status: "rendering", error: null });
  try {
    const [clip, caption, version] = await Promise.all([
      one(db, "creative_lab_clips", String(render.clip_id)),
      one(db, "creative_lab_captions", String(render.caption_id)),
      styleVersion(),
    ]);
    if (!clip) throw new Error("clip not found");
    if (!caption) throw new Error("caption not found");
    const aspect = asAspect(render.aspect);
    const lines = asLines(caption.lines);
    if (lines.length > profile.maxLines) throw new Error(`${lines.length} lines; at most ${profile.maxLines}`);
    const over = lines.find((line) => line.length > profile.charsPerLine);
    if (over) throw new Error(`"${over}" exceeds ${profile.charsPerLine} characters`);
    if (caption.style_version !== version || render.style_version !== version) {
      throw new Error(`style_version does not match the bundled profile ${version}`);
    }
    const audio = audioMode(String(clip.audio_status ?? "original"));
    if (audio === "replaced") throw new Error("replaced audio has no track on the clip yet");

    const source = await one(db, "creative_assets", String(clip.creative_asset_id));
    if (!source?.storage_path) throw new Error("clip has no source asset");
    const bucket = String(source.storage_bucket ?? BUCKET);
    const sign = input.deps?.signUrl ?? defaultSign;
    const probe = input.deps?.probe ?? probeClip;
    const signed = await sign(bucket, String(source.storage_path));
    const meta = await probe(signed);

    const inS = clip.in_s == null ? 0 : Number(clip.in_s);
    const outS = clip.out_s == null ? meta.durationInSeconds : Number(clip.out_s);
    const props: CaptionOnClipProps = {
      clipUrl: signed,
      lines,
      styleVersion: version,
      aspect,
      inS,
      outS,
      audio,
      cropFocusY: clip.crop_focus_y == null ? 0.5 : Number(clip.crop_focus_y),
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      fps: meta.fps,
      durationInSeconds: meta.durationInSeconds,
      plate: "video",
    };
    const renderToFile =
      input.deps?.renderToFile ??
      (async (req: CaptionRenderRequest) => {
        if (!input.serveUrl) throw new Error("serveUrl is required to render");
        const temp = path.join(os.tmpdir(), `caption-${randomUUID()}.mp4`);
        try {
          return await renderCaptionWithRemotion(req, {
            serveUrl: input.serveUrl,
            browserExecutable: input.browserExecutable ?? null,
            outputLocation: temp,
          });
        } finally {
          await fs.unlink(temp).catch(() => {});
        }
      });
    const size = outputSize(meta.width, meta.height, aspect);
    const { bytes, renderMs } = await renderToFile({ props, muted: audio === "muted" });

    const identity = fingerprintBytes(bytes);
    const storagePath = storageName(input.renderId, aspect);
    const upload = input.deps?.upload ?? defaultUpload;
    await upload(storagePath, bytes);
    const registered = await upsertRegisteredAsset(db, {
      userId: input.userId,
      identity,
      filename: `caption-${aspect.replace(":", "x")}.mp4`,
      mediaKind: "video",
      aspectRatio: aspect,
      durationSeconds: Math.round((outS - inS) * 1000) / 1000,
      storageBucket: BUCKET,
      storagePath,
    });
    if (!registered.ok) throw new Error(registered.error);

    await patchRender(db, input.renderId, {
      status: "done",
      error: null,
      render_ms: renderMs,
      creative_asset_id: registered.asset.id,
    });
    return {
      renderId: input.renderId,
      renderMs,
      creativeAssetId: registered.asset.id,
      aspect,
      width: size.width,
      height: size.height,
      storagePath,
      durationSeconds: Math.round((outS - inS) * 1000) / 1000,
    };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await patchRender(db, input.renderId, { status: "failed", error: message, render_ms: Date.now() - started }).catch(() => {});
    throw err instanceof Error ? err : new Error(message);
  }
}

/**
 * Feasibility timing only. Renders and drops the bytes: nothing is
 * uploaded and no creative_assets row is written.
 */
export async function renderTimingSample(
  input: {
    bucket: string;
    storagePath: string;
    lines: string[];
    aspect: CaptionAspect;
    cropFocusY?: number;
    serveUrl: string;
    browserExecutable: string | null;
    deps?: Partial<Pick<RenderDeps, "signUrl" | "probe" | "renderToFile">>;
  },
): Promise<{ renderMs: number; width: number; height: number; durationSeconds: number }> {
  const version = await styleVersion();
  const sign = input.deps?.signUrl ?? defaultSign;
  const probe = input.deps?.probe ?? probeClip;
  const signed = await sign(input.bucket, input.storagePath);
  const meta = await probe(signed);
  const size = outputSize(meta.width, meta.height, input.aspect);
  const props: CaptionOnClipProps = {
    clipUrl: signed,
    lines: input.lines,
    styleVersion: version,
    aspect: input.aspect,
    audio: "original",
    cropFocusY: input.cropFocusY ?? 0.5,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    fps: meta.fps,
    durationInSeconds: meta.durationInSeconds,
    plate: "video",
  };
  const renderToFile =
    input.deps?.renderToFile ??
    (async (req: CaptionRenderRequest) => {
      const temp = path.join(os.tmpdir(), `caption-timing-${randomUUID()}.mp4`);
      try {
        return await renderCaptionWithRemotion(req, {
          serveUrl: input.serveUrl,
          browserExecutable: input.browserExecutable,
          outputLocation: temp,
        });
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
    });
  const { renderMs } = await renderToFile({ props, muted: false });
  return { renderMs, width: size.width, height: size.height, durationSeconds: meta.durationInSeconds };
}
