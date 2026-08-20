import {
  hashStreamMd5,
  resolveTikTokVideoUploadMode,
  uploadTikTokAdVideo,
  type TikTokUploadedVideo,
  type TikTokVideoUploadMode,
} from "./upload.ts";
import {
  resolveStoredVideoMimeType,
  validateTikTokUploadStorageTarget,
} from "./upload-storage.ts";

export interface TikTokUploadServiceStorage {
  createSignedUrl: (
    bucket: string,
    path: string,
    expiresIn: number,
  ) => Promise<{ signedUrl: string | null; error: string | null }>;
  remove: (bucket: string, path: string) => Promise<void>;
}

export function prepareTikTokCreativeUpload(body: {
  storagePath?: string;
  storageBucket?: string;
  advertiserId?: string;
  fileName?: string;
  mode?: TikTokVideoUploadMode;
}):
  | {
      ok: true;
      bucket: string;
      path: string;
      advertiserId: string;
      fileName: string;
      mode: TikTokVideoUploadMode;
    }
  | { ok: false; status: 400; error: string } {
  const target = validateTikTokUploadStorageTarget({
    storageBucket: body.storageBucket,
    storagePath: body.storagePath,
  });
  if (!target.ok) {
    return { ok: false, status: 400, error: target.error };
  }
  const advertiserId = body.advertiserId?.trim() ?? "";
  if (!advertiserId) {
    return { ok: false, status: 400, error: "Missing advertiserId" };
  }
  const mode = body.mode ?? resolveTikTokVideoUploadMode();
  if (mode !== "UPLOAD_BY_FILE" && mode !== "UPLOAD_BY_URL") {
    return { ok: false, status: 400, error: "Invalid upload mode" };
  }
  const fileName =
    body.fileName?.trim() || target.path.split("/").pop() || "video.mp4";
  return {
    ok: true,
    bucket: target.bucket,
    path: target.path,
    advertiserId,
    fileName,
    mode,
  };
}

export async function executeTikTokCreativeUpload(input: {
  prepared: Extract<ReturnType<typeof prepareTikTokCreativeUpload>, { ok: true }>;
  token: string;
  openServiceStorage: () => TikTokUploadServiceStorage;
  fetchImpl?: typeof fetch;
  upload?: typeof uploadTikTokAdVideo;
}): Promise<
  | { status: 201; json: Record<string, unknown> }
  | { status: 500 | 502; json: Record<string, unknown> }
> {
  const storage = input.openServiceStorage();
  const { bucket, path, advertiserId, fileName, mode } = input.prepared;
  const ttlSeconds = mode === "UPLOAD_BY_URL" ? 600 : 120;
  const signed = await storage.createSignedUrl(bucket, path, ttlSeconds);
  if (!signed.signedUrl) {
    return {
      status: 500,
      json: {
        ok: false,
        error: `Failed to access stored file: ${signed.error ?? "unknown error"}`,
      },
    };
  }

  const signedUrl = signed.signedUrl;
  const fetchImpl = input.fetchImpl ?? fetch;
  const upload = input.upload ?? uploadTikTokAdVideo;
  let uploaded: TikTokUploadedVideo;
  try {
    if (mode === "UPLOAD_BY_FILE") {
      const pass1 = await fetchImpl(signedUrl, { cache: "no-store" });
      if (!pass1.ok || !pass1.body) {
        throw new Error(`Storage fetch failed: HTTP ${pass1.status}`);
      }
      const mimeType = resolveStoredVideoMimeType(
        pass1.headers.get("content-type"),
        fileName,
      );
      const hashed = await hashStreamMd5(pass1.body);
      uploaded = await upload({
        advertiserId,
        token: input.token,
        mode: "UPLOAD_BY_FILE",
        fileName,
        bytes: hashed.bytes,
        source: {
          kind: "file",
          signature: hashed.signature,
          mimeType,
          byteLength: hashed.bytes,
          open: async () => {
            const pass2 = await fetchImpl(signedUrl, { cache: "no-store" });
            if (!pass2.ok || !pass2.body) {
              throw new Error(`Storage re-fetch failed: HTTP ${pass2.status}`);
            }
            return pass2.body;
          },
        },
      });
    } else {
      const head = await fetchImpl(signedUrl, { method: "HEAD", cache: "no-store" });
      const length = Number(head.headers.get("content-length") ?? "0");
      uploaded = await upload({
        advertiserId,
        token: input.token,
        mode: "UPLOAD_BY_URL",
        fileName,
        bytes: Number.isFinite(length) ? length : 0,
        source: { kind: "url", videoUrl: signedUrl },
      });
    }
  } catch (error) {
    await storage.remove(bucket, path);
    const message = error instanceof Error ? error.message : String(error);
    return { status: 502, json: { ok: false, error: message, mode } };
  }

  await storage.remove(bucket, path);
  return {
    status: 201,
    json: {
      ok: true,
      videoId: uploaded.videoId,
      previewUrl: uploaded.previewUrl,
      coverUrl: uploaded.coverUrl,
      previewUrlExpireAt: uploaded.previewUrlExpireAt,
      width: uploaded.width,
      height: uploaded.height,
      durationSeconds: uploaded.durationSeconds,
      fileName: uploaded.fileName,
      backfilled: uploaded.backfilled,
      mode,
    },
  };
}
