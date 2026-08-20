import { createHash } from "node:crypto";

import { TikTokApiError } from "./client.ts";
import { fetchTikTokVideoInfo } from "./creative.ts";
import { parseTikTokPreviewExpiry } from "./video-preview.ts";

const TIKTOK_BASE = "https://business-api.tiktok.com/open_api/v1.3";
const UPLOAD_PATH = "/file/video/ad/upload/";
const INFO_PATH = "/file/video/ad/info/";

/** Generous ceiling above TikTok's documented 10s interface timeout. */
export const TIKTOK_UPLOAD_TIMEOUT_MS = 120_000;

export type TikTokVideoUploadMode = "UPLOAD_BY_FILE" | "UPLOAD_BY_URL";

export interface TikTokUploadedVideo {
  videoId: string;
  materialId: string | null;
  previewUrl: string | null;
  coverUrl: string | null;
  previewUrlExpireAt: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  fileName: string | null;
  backfilled: boolean;
}

export type TikTokFileUploadSource = {
  kind: "file";
  signature: string;
  mimeType: string;
  byteLength: number;
  open: () => Promise<ReadableStream<Uint8Array>>;
};

export type TikTokUrlUploadSource = {
  kind: "url";
  videoUrl: string;
};

export interface TikTokUploadTransportRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: BodyInit;
  signal: AbortSignal;
  duplex?: "half";
}

export interface TikTokUploadTransportResponse {
  status: number;
  json: unknown;
}

export type TikTokUploadTransport = (
  request: TikTokUploadTransportRequest,
) => Promise<TikTokUploadTransportResponse>;

export type TikTokUploadSleep = (ms: number) => Promise<void>;

const INFO_BACKOFF_MS = [2_000, 4_000, 8_000] as const;

/**
 * Smart Fix stays off. TikTok's flaw_detect / auto_fix_enabled /
 * auto_bind_enabled silently re-encode resolution and re-crop aspect
 * ratio, which would publish a different video than the operator
 * supplied.
 *
 * URL mode sends these as JSON booleans. FILE mode OMITS them —
 * multipart string "false" can be parsed as truthy, which would enable
 * Smart Fix. Documented defaults are already false.
 */
export const SMART_FIX_OFF = {
  flaw_detect: false,
  auto_fix_enabled: false,
  auto_bind_enabled: false,
} as const;

export function smartFixFieldsForMode(
  mode: TikTokVideoUploadMode,
): Record<keyof typeof SMART_FIX_OFF, boolean> | null {
  if (mode === "UPLOAD_BY_FILE") return null;
  return { ...SMART_FIX_OFF };
}

export function resolveTikTokVideoUploadMode(
  raw = process.env.TIKTOK_VIDEO_UPLOAD_MODE,
): TikTokVideoUploadMode {
  return raw === "UPLOAD_BY_URL" ? "UPLOAD_BY_URL" : "UPLOAD_BY_FILE";
}

export function uniqueTikTokFileName(
  original: string,
  now = Date.now(),
): string {
  const stamp = now.toString(36);
  const lastDot = original.lastIndexOf(".");
  const ext = lastDot >= 0 ? original.slice(lastDot) : "";
  const rawBase = lastDot >= 0 ? original.slice(0, lastDot) : original;
  const base =
    rawBase.replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "") || "video";
  const budget = 100 - ext.length - stamp.length - 1;
  return `${base.slice(0, Math.max(1, budget))}-${stamp}${ext}`;
}

export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

export async function hashStreamMd5(
  stream: ReadableStream<Uint8Array>,
): Promise<{ signature: string; bytes: number }> {
  const hash = createHash("md5");
  let bytes = 0;
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    hash.update(value);
    bytes += value.byteLength;
  }
  return { signature: hash.digest("hex"), bytes };
}

export function isTikTokDuplicateFileNameError(error: {
  message: string;
  code?: number;
}): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes("duplicate") ||
    message.includes("already exist") ||
    (message.includes("file_name") && message.includes("exist")) ||
    (message.includes("file name") && message.includes("exist")) ||
    (message.includes("filename") && message.includes("exist"))
  );
}

export function isTikTokUploadTimeoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("aborted")
  );
}

export function logTikTokUploadTiming(input: {
  mode: TikTokVideoUploadMode;
  advertiserId: string;
  bytes: number;
  elapsedMs: number;
  outcome: "ok" | "timeout" | "error";
  code: number | null;
}): void {
  console.error(
    `[tiktok/upload] mode=${input.mode} advertiser=${input.advertiserId} bytes=${input.bytes} elapsedMs=${input.elapsedMs} outcome=${input.outcome} code=${input.code ?? "n/a"}`,
  );
}

export function logTikTokUploadEnvelope(
  path: string,
  advertiserId: string,
  res: unknown,
  mapped = 0,
): void {
  const record =
    res && typeof res === "object" ? (res as Record<string, unknown>) : {};
  const objectKeys =
    res && typeof res === "object" ? Object.keys(res as object) : [];
  const data = record.data;
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object"
      ? [data]
      : [];
  const firstRow = rows[0];
  const rowKeys =
    firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)
      ? Object.keys(firstRow as object)
      : [];
  console.error(
    `[tiktok/upload] ${path} advertiser=${advertiserId} keys=[${objectKeys.join(",")}] counts={data:${Array.isArray(data) ? data.length : rows.length}} mapped=${mapped} rowKeys=[${rowKeys.join(",")}]`,
  );
}

function readUploadRow(res: unknown): Record<string, unknown> | null {
  if (!res || typeof res !== "object") return null;
  const record = res as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  if (data && typeof data === "object") {
    const nested = data as Record<string, unknown>;
    if (Array.isArray(nested.list) && nested.list[0] && typeof nested.list[0] === "object") {
      return nested.list[0] as Record<string, unknown>;
    }
    return nested;
  }
  if (typeof record.video_id === "string") return record;
  return null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapUploadedVideo(
  row: Record<string, unknown>,
  backfilled: boolean,
): TikTokUploadedVideo {
  return {
    videoId: String(row.video_id),
    materialId: asOptionalString(row.material_id),
    previewUrl:
      asOptionalString(row.preview_url) ??
      asOptionalString(row.video_cover_url) ??
      asOptionalString(row.thumbnail_url),
    coverUrl: asOptionalString(row.video_cover_url),
    previewUrlExpireAt: parseTikTokPreviewExpiry(row.preview_url_expire_time),
    width: asOptionalNumber(row.width),
    height: asOptionalNumber(row.height),
    durationSeconds:
      asOptionalNumber(row.duration) ?? asOptionalNumber(row.duration_seconds),
    fileName: asOptionalString(row.file_name),
    backfilled,
  };
}

function formatUploadFailure(input: {
  mode: TikTokVideoUploadMode;
  bytes: number;
  elapsedMs: number;
  outcome: "timeout" | "error";
  message: string;
}): string {
  const sizeMb = (input.bytes / 1024 / 1024).toFixed(1);
  return `TikTok ${input.mode} failed for a ${sizeMb} MB file after ${input.elapsedMs}ms (${input.outcome}): ${input.message}`;
}

function defaultTransport(): TikTokUploadTransport {
  return async (request) => {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      cache: "no-store",
      signal: request.signal,
    };
    if (request.duplex) init.duplex = request.duplex;
    const response = await fetch(request.url, init);
    const json = (await response.json().catch(() => ({}))) as unknown;
    return { status: response.status, json };
  };
}

export function createMultipartFileBody(input: {
  fields: Record<string, string>;
  fileField: string;
  fileName: string;
  mimeType: string;
  fileStream: ReadableStream<Uint8Array>;
  boundary: string;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(input.fields)) {
    parts.push(
      encoder.encode(
        `--${input.boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }
  parts.push(
    encoder.encode(
      `--${input.boundary}\r\nContent-Disposition: form-data; name="${input.fileField}"; filename="${input.fileName}"\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
    ),
  );
  const preamble = concatSmall(parts);
  const epilogue = encoder.encode(`\r\n--${input.boundary}--\r\n`);
  const reader = input.fileStream.getReader();
  let phase: "preamble" | "file" | "epilogue" | "done" = "preamble";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "preamble") {
        controller.enqueue(preamble);
        phase = "file";
        return;
      }
      if (phase === "file") {
        const { done, value } = await reader.read();
        if (!done && value) {
          controller.enqueue(value);
          return;
        }
        phase = "epilogue";
      }
      if (phase === "epilogue") {
        controller.enqueue(epilogue);
        phase = "done";
        controller.close();
      }
    },
  });
}

function concatSmall(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function uploadTikTokAdVideo(input: {
  advertiserId: string;
  token: string;
  mode: TikTokVideoUploadMode;
  source: TikTokFileUploadSource | TikTokUrlUploadSource;
  fileName: string;
  bytes?: number;
  transport?: TikTokUploadTransport;
  infoRequest?: typeof fetchTikTokVideoInfo;
  sleep?: TikTokUploadSleep;
  now?: () => number;
  timeoutMs?: number;
}): Promise<TikTokUploadedVideo> {
  const transport = input.transport ?? defaultTransport();
  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const started = (input.now ?? Date.now)();
  const bytes =
    input.bytes ??
    (input.source.kind === "file" ? input.source.byteLength : 0);

  let fileName = uniqueTikTokFileName(input.fileName);
  let retriedName = false;

  while (true) {
    const signal = AbortSignal.timeout(input.timeoutMs ?? TIKTOK_UPLOAD_TIMEOUT_MS);
    try {
      const uploaded = await postTikTokAdVideo({
        advertiserId: input.advertiserId,
        token: input.token,
        mode: input.mode,
        source: input.source,
        fileName,
        transport,
        signal,
      });
      const elapsedMs = (input.now ?? Date.now)() - started;
      logTikTokUploadTiming({
        mode: input.mode,
        advertiserId: input.advertiserId,
        bytes,
        elapsedMs,
        outcome: "ok",
        code: 0,
      });
      return backfillUploadMetadata(uploaded, {
        advertiserId: input.advertiserId,
        token: input.token,
        infoRequest: input.infoRequest,
        sleep,
      });
    } catch (error) {
      const apiError =
        error instanceof TikTokApiError
          ? error
          : new TikTokApiError(
              error instanceof Error ? error.message : String(error),
            );
      if (!retriedName && isTikTokDuplicateFileNameError(apiError)) {
        retriedName = true;
        const nextName = uniqueTikTokFileName(input.fileName, Date.now() + 1);
        console.error(
          `[tiktok/upload] duplicate file_name retry advertiser=${input.advertiserId} next_name=${nextName}`,
        );
        fileName = nextName;
        continue;
      }
      const timeout = isTikTokUploadTimeoutError(error) || signal.aborted;
      logTikTokUploadTiming({
        mode: input.mode,
        advertiserId: input.advertiserId,
        bytes,
        elapsedMs: (input.now ?? Date.now)() - started,
        outcome: timeout ? "timeout" : "error",
        code: apiError.code ?? null,
      });
      throw new TikTokApiError(
        formatUploadFailure({
          mode: input.mode,
          bytes,
          elapsedMs: (input.now ?? Date.now)() - started,
          outcome: timeout ? "timeout" : "error",
          message: apiError.message,
        }),
        apiError.code,
        apiError.requestId,
        apiError.httpStatus,
      );
    }
  }
}

async function postTikTokAdVideo(input: {
  advertiserId: string;
  token: string;
  mode: TikTokVideoUploadMode;
  source: TikTokFileUploadSource | TikTokUrlUploadSource;
  fileName: string;
  transport: TikTokUploadTransport;
  signal: AbortSignal;
}): Promise<TikTokUploadedVideo> {
  const url = `${TIKTOK_BASE}${UPLOAD_PATH}`;
  const headers: Record<string, string> = {
    "Access-Token": input.token,
  };
  let body: BodyInit;
  let duplex: "half" | undefined;

  const smartFix = smartFixFieldsForMode(input.mode);

  if (input.mode === "UPLOAD_BY_FILE") {
    if (input.source.kind !== "file") {
      throw new TikTokApiError("UPLOAD_BY_FILE requires a file stream");
    }
    const fields: Record<string, string> = {
      advertiser_id: input.advertiserId,
      upload_type: "UPLOAD_BY_FILE",
      video_signature: input.source.signature,
      file_name: input.fileName,
    };
    void SMART_FIX_OFF;
    if (smartFix) {
      for (const [key, value] of Object.entries(smartFix)) {
        fields[key] = String(value);
      }
    }
    const boundary = `----tiktok${crypto.randomUUID().replace(/-/g, "")}`;
    const fileStream = await input.source.open();
    body = createMultipartFileBody({
      fields,
      fileField: "video_file",
      fileName: input.fileName,
      mimeType: input.source.mimeType,
      fileStream,
      boundary,
    });
    headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
    duplex = "half";
  } else {
    if (input.source.kind !== "url") {
      throw new TikTokApiError("UPLOAD_BY_URL requires a video URL");
    }
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      advertiser_id: input.advertiserId,
      upload_type: "UPLOAD_BY_URL",
      video_url: input.source.videoUrl,
      file_name: input.fileName,
      ...(smartFix ?? {}),
    });
  }

  const response = await input.transport({
    url,
    method: "POST",
    headers,
    body,
    signal: input.signal,
    duplex,
  });
  const json = response.json;
  const envelope =
    json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const code = typeof envelope.code === "number" ? envelope.code : undefined;
  const requestId =
    typeof envelope.request_id === "string" ? envelope.request_id : undefined;
  const message =
    typeof envelope.message === "string"
      ? envelope.message
      : typeof envelope.msg === "string"
        ? envelope.msg
        : `HTTP ${response.status}`;

  const row = readUploadRow(json);
  const videoId = asOptionalString(row?.video_id);
  logTikTokUploadEnvelope(UPLOAD_PATH, input.advertiserId, json, videoId ? 1 : 0);

  if (!(response.status >= 200 && response.status < 300) || (code != null && code !== 0)) {
    throw new TikTokApiError(message, code, requestId, response.status);
  }
  if (!row || !videoId) {
    const objectKeys =
      json && typeof json === "object" ? Object.keys(json as object) : [];
    const rowKeys = row ? Object.keys(row) : [];
    throw new TikTokApiError(
      `TikTok video upload returned no video_id. keys=[${objectKeys.join(",")}] rowKeys=[${rowKeys.join(",")}]`,
      code,
      requestId,
      response.status,
    );
  }

  return mapUploadedVideo({ ...row, video_id: videoId }, false);
}

async function backfillUploadMetadata(
  uploaded: TikTokUploadedVideo,
  input: {
    advertiserId: string;
    token: string;
    infoRequest?: typeof fetchTikTokVideoInfo;
    sleep: TikTokUploadSleep;
  },
): Promise<TikTokUploadedVideo> {
  if (uploaded.previewUrl || uploaded.width != null || uploaded.durationSeconds != null) {
    return uploaded;
  }
  const request = input.infoRequest ?? fetchTikTokVideoInfo;
  for (const delayMs of INFO_BACKOFF_MS) {
    await input.sleep(delayMs);
    try {
      const videos = await request({
        advertiserId: input.advertiserId,
        token: input.token,
        videoIds: [uploaded.videoId],
      });
      const info = videos[0];
      if (!info) continue;
      return {
        ...uploaded,
        previewUrl: info.thumbnail_url ?? uploaded.previewUrl,
        durationSeconds: info.duration_seconds ?? uploaded.durationSeconds,
        backfilled: true,
      };
    } catch (error) {
      console.error(
        `[tiktok/upload] ${INFO_PATH} backfill advertiser=${input.advertiserId} mapped=0 error=1`,
      );
      void error;
    }
  }
  return uploaded;
}

export function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
