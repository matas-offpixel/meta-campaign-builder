/**
 * Burn one caption onto one clip and register the mp4.
 *
 * The render runs on Remotion Lambda in eu-west-2. The Vercel function
 * image lacks glibc 2.35, so the compositor never starts (verified 5 Nov
 * 2026 on Node 22.x and 26.x). One creative_lab_renders row per call.
 * No Meta or TikTok calls. The clip is a 60-minute signed URL. Dimensions
 * come from the mp4 header, not ffprobe. A 720-wide source stays 720 wide.
 * Video is 9:16 only. Never upscaled.
 *
 * The Lambda cost is returned to the caller. It is not stored: migration
 * 198 is still unapplied, and a cost column would need another one.
 */

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { fingerprintBytes, upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import type { CaptionOnClipProps } from "../../src/remotion/compositions/CaptionOnClip.tsx";
import { captionLimits, outputSize, profile, styleVersion, type CaptionAspect, type CaptionSize } from "../../src/remotion/caption-style/profile.ts";
import { quoteStyleVersion } from "../../src/remotion/caption-style/quote-profile.ts";
import { deleteLambdaRender, renderCaptionViaLambda, requireLambdaServeUrl, type LambdaRenderOutput } from "./lambda.ts";
import type { ServiceRoleDb } from "./load.ts";
import { TOO_SMALL_FOR_916, TRIPLE_FIT_NOT_PAIRED, tooSmallFor916 } from "./import-quality.ts";
import { probeMp4Url, type Probe } from "./mp4-probe.ts";
import { clipWindow } from "./surface.ts";
import { renderAssetId } from "./render-proxy.ts";

export type { Probe };

const BUCKET = "campaign-assets";
const SIGNED_URL_SECONDS = 60 * 60;

export type CaptionRenderRequest = { props: CaptionOnClipProps; muted: boolean };

export type LambdaHandle = { bucketName: string; lambdaRenderId: string };

export type RenderedClip = {
  bytes: Uint8Array;
  renderMs: number;
  estimatedCostUsd: number | null;
  estimatedCostDisplay: string | null;
  lambda: LambdaHandle | null;
};

export type RenderDeps = {
  signUrl: (bucket: string, objectPath: string) => Promise<string>;
  probe: (url: string) => Promise<Probe>;
  /** Test double for the local path. Production uses `lambda`. */
  renderToFile?: (req: CaptionRenderRequest) => Promise<{ bytes: Uint8Array; renderMs: number }>;
  lambda?: {
    render: (req: CaptionRenderRequest, serveUrl: string) => Promise<LambdaRenderOutput>;
    deleteRender: (target: LambdaHandle) => Promise<void>;
  };
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

export async function one(db: ServiceRoleDb, table: string, id: string): Promise<Record<string, unknown> | null> {
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

export async function defaultSign(bucket: string, objectPath: string): Promise<string> {
  const { data, error } = await storageAdmin().storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`signed url for ${objectPath}: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

async function defaultUpload(objectPath: string, bytes: Uint8Array): Promise<void> {
  const { error } = await storageAdmin().storage.from(BUCKET).upload(objectPath, bytes, { contentType: "video/mp4", upsert: false });
  if (error) throw new Error(`storage upload: ${error.message}`);
}

/** Moov-atom probe. No compositor, so it runs on the Vercel function image. */
export function probeClip(url: string): Promise<Probe> {
  return probeMp4Url(url);
}

const defaultLambda: NonNullable<RenderDeps["lambda"]> = {
  render: renderCaptionViaLambda,
  deleteRender: deleteLambdaRender,
};

/** 'cleared' plays the clip's own audio, the same as 'original'. */
export function audioMode(status: string): CaptionOnClipProps["audio"] {
  if (status === "muted") return "muted";
  if (status === "replaced") return "replaced";
  return "original";
}

export type LabRenderKind = "video" | "static";

const STATIC_ASPECTS = ["1:1", "4:5", "9:16"] as const;

/**
 * A video row is 9:16 only. A static row (M6, nothing writes one yet) may
 * be 1:1, 4:5 or 9:16. A missing kind is a video row from before migration 199.
 */
export function loadLabRender(row: { aspect: unknown; kind?: unknown }): { kind: "video"; aspect: "9:16" } | { kind: "static"; aspect: "1:1" | "4:5" | "9:16" } {
  const kind = row.kind == null ? "video" : row.kind;
  if (kind !== "video" && kind !== "static") throw new Error(`kind ${String(kind)} is not video or static`);
  const aspect = String(row.aspect);
  if (kind === "video") {
    if (aspect !== "9:16") throw new Error(`aspect '${aspect}' with kind 'video' is not rendered`);
    return { kind, aspect: "9:16" };
  }
  if (!STATIC_ASPECTS.includes(aspect as (typeof STATIC_ASPECTS)[number])) {
    throw new Error(`aspect '${aspect}' is not a static size`);
  }
  return { kind: "static", aspect: aspect as "1:1" | "4:5" | "9:16" };
}

function asLines(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((line) => typeof line !== "string")) throw new Error("caption lines are missing");
  return value as string[];
}

/**
 * Attempt 1 keeps the original path. A retry uses a new object so the
 * upload's upsert:false does not collide with the failed attempt.
 */
export function renderStoragePath(renderId: string, attempt = 1): string {
  if (attempt > 1) return `videos/creative-lab/${renderId}-a${attempt}-9x16.mp4`;
  return `videos/creative-lab/${renderId}-9x16.mp4`;
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
  estimatedCostUsd: number | null;
  estimatedCostDisplay: string | null;
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
    deps?: Partial<RenderDeps>;
  },
): Promise<RenderOutcome> {
  const render = await one(db, "creative_lab_renders", input.renderId);
  if (!render) throw new Error(`render ${input.renderId} not found`);
  if (render.user_id !== input.userId) throw new Error("render belongs to another user");

  const started = Date.now();
  await patchRender(db, input.renderId, { status: "rendering", error: null });
  let pendingDelete: { lambda: NonNullable<RenderDeps["lambda"]>; handle: LambdaHandle } | null = null;
  try {
    const [clip, caption, captionVersion, quoteVersion] = await Promise.all([
      one(db, "creative_lab_clips", String(render.clip_id)),
      one(db, "creative_lab_captions", String(render.caption_id)),
      styleVersion(),
      quoteStyleVersion(),
    ]);
    if (!clip) throw new Error("clip not found");
    if (!caption) throw new Error("caption not found");
    const loaded = loadLabRender({ aspect: render.aspect, kind: render.kind });
    if (loaded.kind !== "video") throw new Error("static renders are not written yet");
    const aspect = loaded.aspect;
    if (String(clip.triple_fit_source_id ?? "").trim()) throw new Error(TRIPLE_FIT_NOT_PAIRED);
    const quote = caption.mode === "quote" || caption.style === "quote";
    const version = quote ? quoteVersion : captionVersion;
    const size: CaptionSize = caption.size_variant === "long" ? "long" : "default";
    const lines = asLines(caption.lines);
    if (quote) {
      if (lines.some((line) => line.trim() === "")) throw new Error("empty line; a quote is at most 4");
      if (lines.length > 4) throw new Error(`${lines.length} lines; a quote is at most 4`);
    } else {
      if (size === "long" && !profile.longApproved) throw new Error("long caption size is not approved");
      const limits = captionLimits(size);
      if (lines.some((line) => line.trim() === "")) throw new Error(`empty line; an overlay is at most ${limits.maxLines} lines`);
      if (lines.some((line) => /^(?:more|&|w\/)$/i.test(line.trim()))) throw new Error(`a short word is its own line; an overlay is at most ${limits.maxLines} lines`);
      if (lines.some((line) => line.includes("|") || /(^|\s)\/(\s|$)/.test(line))) throw new Error(`a line break is the only separator; an overlay is at most ${limits.maxLines} lines`);
      if (lines.length > limits.maxLines) throw new Error(`${lines.length} lines; at most ${limits.maxLines}`);
      const over = lines.find((line) => line.length > limits.charsPerLine);
      if (over) throw new Error(`"${over}" exceeds ${limits.charsPerLine} characters`);
    }
    if (caption.style_version !== version || render.style_version !== version) {
      throw new Error(`style_version does not match the bundled profile ${version}`);
    }
    const quoteWeight = caption.quote_weight === 400 ? 400 : 700;
    const audio = audioMode(String(clip.audio_status ?? "original"));
    if (audio === "replaced") throw new Error("replaced audio has no track on the clip yet");

    // The 1080 render proxy when the original is 4K (migration 220), else the original.
    const source = await one(db, "creative_assets", renderAssetId(clip));
    if (!source?.storage_path) throw new Error("clip has no source asset");
    const bucket = String(source.storage_bucket ?? BUCKET);
    const sign = input.deps?.signUrl ?? defaultSign;
    const probe = input.deps?.probe ?? probeClip;
    const lambda = input.deps?.renderToFile ? null : (input.deps?.lambda ?? defaultLambda);
    const serveUrl = lambda ? requireLambdaServeUrl(input.serveUrl) : "";
    const signed = await sign(bucket, String(source.storage_path));
    const meta = await probe(signed);
    if (tooSmallFor916({ width: meta.width, height: meta.height })) throw new Error(TOO_SMALL_FOR_916);

    const window = clipWindow({
      fileSeconds: meta.durationInSeconds,
      inS: clip.in_s == null ? null : Number(clip.in_s),
      outS: clip.out_s == null ? null : Number(clip.out_s),
    });
    const inS = window.inS;
    const outS = window.outS ?? meta.durationInSeconds;
    const props: CaptionOnClipProps = {
      clipUrl: signed,
      lines,
      styleVersion: version,
      aspect,
      inS,
      outS,
      audio,
      cropFocusY: clip.crop_focus_y == null ? 0.5 : Number(clip.crop_focus_y),
      cropFocusX: clip.crop_focus_x == null ? 0.5 : Number(clip.crop_focus_x),
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      fps: meta.fps,
      durationInSeconds: meta.durationInSeconds,
      plate: "video",
      size,
      ...(quote ? { mode: "quote" as const, weight: quoteWeight as 400 | 700 } : {}),
    };
    const request: CaptionRenderRequest = { props, muted: audio === "muted" };
    const frame = outputSize(meta.width, meta.height, aspect);
    const rendered: RenderedClip = input.deps?.renderToFile
      ? { ...(await input.deps.renderToFile(request)), estimatedCostUsd: null, estimatedCostDisplay: null, lambda: null }
      : await lambdaRender(lambda!, request, serveUrl);
    const { bytes, renderMs } = rendered;

    const identity = fingerprintBytes(bytes);
    const attempt = Number(render.attempt ?? 1);
    const storagePath = renderStoragePath(input.renderId, Number.isFinite(attempt) && attempt > 0 ? attempt : 1);
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
    if (rendered.lambda && lambda) {
      pendingDelete = { lambda, handle: rendered.lambda };
      await lambda.deleteRender(rendered.lambda);
      pendingDelete = null;
    }
    return {
      renderId: input.renderId,
      renderMs,
      creativeAssetId: registered.asset.id,
      aspect,
      width: frame.width,
      height: frame.height,
      storagePath,
      durationSeconds: Math.round((outS - inS) * 1000) / 1000,
      estimatedCostUsd: rendered.estimatedCostUsd,
      estimatedCostDisplay: rendered.estimatedCostDisplay,
    };
  } catch (err) {
    if (pendingDelete) await pendingDelete.lambda.deleteRender(pendingDelete.handle).catch(() => {});
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await patchRender(db, input.renderId, { status: "failed", error: message, render_ms: Date.now() - started }).catch(() => {});
    throw err instanceof Error ? err : new Error(message);
  }
}

async function lambdaRender(
  lambda: NonNullable<RenderDeps["lambda"]>,
  request: CaptionRenderRequest,
  serveUrl: string,
): Promise<RenderedClip> {
  const output = await lambda.render(request, serveUrl);
  return {
    bytes: output.bytes,
    renderMs: output.renderMs,
    estimatedCostUsd: output.estimatedCostUsd,
    estimatedCostDisplay: output.estimatedCostDisplay,
    lambda: { bucketName: output.bucketName, lambdaRenderId: output.lambdaRenderId },
  };
}

/**
 * Feasibility timing only. Renders on Lambda, deletes the S3 object, and
 * drops the bytes. Nothing is uploaded and no creative_assets row is written.
 */
export async function renderTimingSample(
  input: {
    bucket: string;
    storagePath: string;
    lines: string[];
    aspect: CaptionAspect;
    cropFocusY?: number;
    serveUrl?: string;
    deps?: Partial<Pick<RenderDeps, "signUrl" | "probe" | "renderToFile" | "lambda">>;
  },
): Promise<{ renderMs: number; width: number; height: number; durationSeconds: number; estimatedCostUsd: number | null; estimatedCostDisplay: string | null }> {
  const version = await styleVersion();
  const lambda = input.deps?.renderToFile ? null : (input.deps?.lambda ?? defaultLambda);
  const serveUrl = lambda ? requireLambdaServeUrl(input.serveUrl) : "";
  const sign = input.deps?.signUrl ?? defaultSign;
  const probe = input.deps?.probe ?? probeClip;
  const signed = await sign(input.bucket, input.storagePath);
  const meta = await probe(signed);
  if (tooSmallFor916({ width: meta.width, height: meta.height })) throw new Error(TOO_SMALL_FOR_916);
  const loaded = loadLabRender({ aspect: input.aspect, kind: "video" });
  if (loaded.kind !== "video") throw new Error("video renders are 9:16 only");
  const size = outputSize(meta.width, meta.height, loaded.aspect);
  const props: CaptionOnClipProps = {
    clipUrl: signed,
    lines: input.lines,
    styleVersion: version,
    aspect: loaded.aspect,
    audio: "original",
    cropFocusY: input.cropFocusY ?? 0.5,
    sourceWidth: meta.width,
    sourceHeight: meta.height,
    fps: meta.fps,
    durationInSeconds: meta.durationInSeconds,
    plate: "video",
  };
  const request: CaptionRenderRequest = { props, muted: false };
  const rendered: RenderedClip = input.deps?.renderToFile
    ? { ...(await input.deps.renderToFile(request)), estimatedCostUsd: null, estimatedCostDisplay: null, lambda: null }
    : await lambdaRender(lambda!, request, serveUrl);
  if (rendered.lambda) await lambda!.deleteRender(rendered.lambda);
  return {
    renderMs: rendered.renderMs,
    width: size.width,
    height: size.height,
    durationSeconds: meta.durationInSeconds,
    estimatedCostUsd: rendered.estimatedCostUsd,
    estimatedCostDisplay: rendered.estimatedCostDisplay,
  };
}
