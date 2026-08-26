/**
 * Upload a registry Storage object to TikTok using the existing transport.
 *
 * Unlike executeTikTokCreativeUpload (TikTok-wizard temp files under
 * tiktok-videos/), this does NOT delete the source. Registry assets live
 * in campaign-assets/videos|images and must survive fan-out.
 */

import {
  hashStreamMd5,
  resolveTikTokVideoUploadMode,
  uploadTikTokAdVideo,
  type TikTokUploadedVideo,
  type TikTokVideoUploadMode,
} from "./upload.ts";
import { resolveStoredVideoMimeType } from "./upload-storage.ts";
import type { TikTokUploadServiceStorage } from "./upload-route.ts";

export async function uploadRegistryVideoToTikTok(input: {
  bucket: string;
  path: string;
  advertiserId: string;
  fileName: string;
  token: string;
  mode?: TikTokVideoUploadMode;
  storage: TikTokUploadServiceStorage;
  fetchImpl?: typeof fetch;
  upload?: typeof uploadTikTokAdVideo;
}): Promise<
  | { ok: true; uploaded: TikTokUploadedVideo; mode: TikTokVideoUploadMode }
  | { ok: false; error: string }
> {
  const mode = input.mode ?? resolveTikTokVideoUploadMode();
  const ttlSeconds = mode === "UPLOAD_BY_URL" ? 600 : 120;
  const signed = await input.storage.createSignedUrl(input.bucket, input.path, ttlSeconds);
  if (!signed.signedUrl) {
    return {
      ok: false,
      error: `Failed to access stored file: ${signed.error ?? "unknown error"}`,
    };
  }

  const signedUrl = signed.signedUrl;
  const fetchImpl = input.fetchImpl ?? fetch;
  const upload = input.upload ?? uploadTikTokAdVideo;
  try {
    if (mode === "UPLOAD_BY_FILE") {
      const pass1 = await fetchImpl(signedUrl, { cache: "no-store" });
      if (!pass1.ok || !pass1.body) {
        throw new Error(`Storage fetch failed: HTTP ${pass1.status}`);
      }
      const mimeType = resolveStoredVideoMimeType(
        pass1.headers.get("content-type"),
        input.fileName,
      );
      const hashed = await hashStreamMd5(pass1.body);
      const uploaded = await upload({
        advertiserId: input.advertiserId,
        token: input.token,
        mode: "UPLOAD_BY_FILE",
        fileName: input.fileName,
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
      return { ok: true, uploaded, mode };
    }

    const head = await fetchImpl(signedUrl, { method: "HEAD", cache: "no-store" });
    const length = Number(head.headers.get("content-length") ?? "0");
    const uploaded = await upload({
      advertiserId: input.advertiserId,
      token: input.token,
      mode: "UPLOAD_BY_URL",
      fileName: input.fileName,
      bytes: Number.isFinite(length) ? length : 0,
      source: { kind: "url", videoUrl: signedUrl },
    });
    return { ok: true, uploaded, mode };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
