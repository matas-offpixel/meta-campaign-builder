import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { readTikTokAccountCredentials } from "@/lib/tiktok/api-account";
import { TikTokApiError } from "@/lib/tiktok/client";
import {
  hashAndBufferStream,
  resolveTikTokVideoUploadMode,
  uploadTikTokAdVideo,
  type TikTokVideoUploadMode,
} from "@/lib/tiktok/upload";

/**
 * Large videos (10–150 MB) stream Storage → TikTok. The launch route
 * uses 800; match that so Mode A is not killed by the default 60s cap.
 */
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let body: {
    storagePath?: string;
    storageBucket?: string;
    advertiserId?: string;
    fileName?: string;
    mode?: TikTokVideoUploadMode;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const storagePath = body.storagePath?.trim();
  const storageBucket = body.storageBucket?.trim() || "campaign-assets";
  const advertiserId = body.advertiserId?.trim();
  const fileName = body.fileName?.trim() || storagePath?.split("/").pop() || "video.mp4";
  const mode = body.mode ?? resolveTikTokVideoUploadMode();

  if (!storagePath) {
    return NextResponse.json({ ok: false, error: "Missing storagePath" }, { status: 400 });
  }
  if (!advertiserId) {
    return NextResponse.json({ ok: false, error: "Missing advertiserId" }, { status: 400 });
  }
  if (mode !== "UPLOAD_BY_FILE" && mode !== "UPLOAD_BY_URL") {
    return NextResponse.json({ ok: false, error: "Invalid upload mode" }, { status: 400 });
  }

  const credentials = await readTikTokAccountCredentials(supabase, {
    userId: user.id,
    advertiserId,
  });
  if (!credentials) {
    return NextResponse.json(
      { ok: false, error: "TikTok credentials missing" },
      { status: 400 },
    );
  }

  const storage = createServiceRoleClient();
  const ttlSeconds = mode === "UPLOAD_BY_URL" ? 600 : 120;
  const { data: signedData, error: signedError } = await storage.storage
    .from(storageBucket)
    .createSignedUrl(storagePath, ttlSeconds);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to access stored file: ${signedError?.message ?? "unknown error"}`,
      },
      { status: 500 },
    );
  }

  const cleanup = () =>
    storage.storage.from(storageBucket).remove([storagePath]).catch(() => {});

  try {
    const uploaded =
      mode === "UPLOAD_BY_FILE"
        ? await uploadByFile({
            advertiserId,
            token: credentials.accessToken,
            fileName,
            signedUrl: signedData.signedUrl,
          })
        : await uploadTikTokAdVideo({
            advertiserId,
            token: credentials.accessToken,
            mode: "UPLOAD_BY_URL",
            source: { kind: "url", videoUrl: signedData.signedUrl },
            fileName,
            bytes: await peekStoredBytes(signedData.signedUrl),
          });

    await cleanup();
    return NextResponse.json(
      {
        ok: true,
        videoId: uploaded.videoId,
        previewUrl: uploaded.previewUrl,
        coverUrl: uploaded.coverUrl,
        width: uploaded.width,
        height: uploaded.height,
        durationSeconds: uploaded.durationSeconds,
        fileName: uploaded.fileName,
        backfilled: uploaded.backfilled,
        mode,
      },
      { status: 201 },
    );
  } catch (error) {
    await cleanup();
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof TikTokApiError ? error.code : undefined;
    console.error(
      `[tiktok/upload] route failed advertiser=${advertiserId} mode=${mode} code=${code ?? "n/a"}`,
    );
    return NextResponse.json({ ok: false, error: message, mode }, { status: 502 });
  }
}

async function uploadByFile(input: {
  advertiserId: string;
  token: string;
  fileName: string;
  signedUrl: string;
}) {
  const fileRes = await fetch(input.signedUrl, { cache: "no-store" });
  if (!fileRes.ok) {
    throw new Error(`Storage fetch failed: HTTP ${fileRes.status}`);
  }
  const { bytes } = fileRes.body
    ? await hashAndBufferStream(fileRes.body, new ArrayBuffer(0))
    : await hashAndBufferStream(null, await fileRes.arrayBuffer());
  return uploadTikTokAdVideo({
    advertiserId: input.advertiserId,
    token: input.token,
    mode: "UPLOAD_BY_FILE",
    source: { kind: "file", bytes, mimeType: "video/mp4" },
    fileName: input.fileName,
    bytes: bytes.byteLength,
  });
}

async function peekStoredBytes(signedUrl: string): Promise<number> {
  const head = await fetch(signedUrl, { method: "HEAD", cache: "no-store" });
  const length = Number(head.headers.get("content-length") ?? "0");
  return Number.isFinite(length) ? length : 0;
}
