/**
 * The real dependencies for the snippet's intake, preview and render: the
 * service-role client's Storage, the export Drive account, Remotion Lambda
 * and the ffmpeg-static binary. Only the route and the render tick load
 * this; everything it wires is tested with fakes in lib/creative-tests.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { uploadFileToStorageBucket } from "../clients/asset-queue/storage-upload.ts";
import type { DriveApi } from "../drive/client.ts";
import { cutSnippet, probeAudio, readEnvelopes, withTempDir } from "./audio-ffmpeg.ts";
import { decodeForAnalysis } from "./top-tracks/ffmpeg.ts";
import { AUDIO_BUCKET, type IntakeDeps } from "./audio-intake.ts";
import type { CutDeps } from "./snippet-render.ts";
import { staticStoragePath } from "./statics.ts";

export const SIGNED_URL_SECONDS = 60 * 60;

type Service = SupabaseClient;

export function storageDeps(db: Service): Pick<CutDeps, "download" | "exists" | "upload"> {
  return {
    async download(bucket, storagePath) {
      const { data, error } = await db.storage.from(bucket).download(storagePath);
      if (error || !data) throw new Error(`storage download: ${error?.message ?? "no file"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    async exists(bucket, storagePath) {
      const dir = path.posix.dirname(storagePath);
      const name = path.posix.basename(storagePath);
      const { data, error } = await db.storage.from(bucket).list(dir, { search: name, limit: 5 });
      if (error) return false;
      return (data ?? []).some((f) => f.name === name);
    },
    async upload(bucket, storagePath, filePath, contentType) {
      const res = await uploadFileToStorageBucket(db, bucket, storagePath, filePath, contentType);
      if (res.error) throw new Error(`storage upload: ${res.error.message}`);
    },
  };
}

export async function signedUrl(db: Service, bucket: string, storagePath: string): Promise<string> {
  const { data, error } = await db.storage.from(bucket).createSignedUrl(storagePath, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw new Error(`storage sign: ${error?.message ?? "no url"}`);
  return data.signedUrl;
}

export function cutDeps(db: Service): CutDeps {
  return { ...storageDeps(db), cut: cutSnippet, tempDir: (fn) => withTempDir("snippet-", fn) };
}

export function intakeDeps(db: Service, drive: DriveApi): IntakeDeps {
  const storage = storageDeps(db);
  return {
    drive,
    async downloadTo(fileId, filePath) {
      if (drive.downloadTo) await drive.downloadTo(fileId, filePath);
      else await writeFile(filePath, await drive.download(fileId));
    },
    upload: (storagePath, filePath, contentType) => storage.upload(AUDIO_BUCKET, storagePath, filePath, contentType),
    probe: probeAudio,
    envelopes: readEnvelopes,
    analyse: decodeForAnalysis,
    tempDir: (fn) => withTempDir("snippet-in-", fn),
  };
}

/** The static's Storage copy (made once from the Drive file, which is only read), signed. */
export async function staticCopyUrl(db: Service, drive: DriveApi, input: { eventId: string; driveFileId: string; fileName?: string }): Promise<string> {
  const meta = await drive.getFile(input.driveFileId);
  if (!meta) throw new Error("the static is gone from Drive");
  const target = staticStoragePath(input.eventId, input.driveFileId, meta.mimeType, input.fileName ?? meta.name);
  const storage = storageDeps(db);
  if (!(await storage.exists(AUDIO_BUCKET, target))) {
    await withTempDir("snippet-static-", async (dir) => {
      const local = path.join(dir, path.posix.basename(target));
      await writeFile(local, await drive.download(input.driveFileId));
      await storage.upload(AUDIO_BUCKET, target, local, meta.mimeType);
    });
  }
  return signedUrl(db, AUDIO_BUCKET, target);
}
