"use client";

import { createClient } from "@/lib/supabase/client";
import { RESUMABLE_UPLOAD_THRESHOLD } from "@/lib/tiktok-wizard/resumable-threshold";

const STORAGE_BUCKET = "campaign-assets";

export interface TikTokVideoUploadResult {
  videoId: string;
  previewUrl: string | null;
  coverUrl: string | null;
  previewUrlExpireAt: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  fileName: string | null;
  backfilled: boolean;
  mode: "UPLOAD_BY_FILE" | "UPLOAD_BY_URL";
}

/**
 * Browser → Supabase Storage (simple upload ≤40 MB, TUS above that —
 * same threshold as PR #594), then a tiny JSON handoff to
 * /api/tiktok/creative/upload. Mirrors lib/hooks/useUploadAsset.ts.
 */
export async function uploadTikTokVideoViaStorage(input: {
  file: File;
  advertiserId: string;
  onStage?: (stage: "storage" | "tiktok") => void;
}): Promise<TikTokVideoUploadResult> {
  const supabase = createClient();
  const ext = input.file.name.split(".").pop()?.toLowerCase() ?? "mp4";
  const storagePath = `tiktok-videos/${crypto.randomUUID()}.${ext}`;

  input.onStage?.("storage");
  await uploadCampaignAsset(input.file, storagePath);

  input.onStage?.("tiktok");
  let res: Response;
  try {
    res = await fetch("/api/tiktok/creative/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath,
        storageBucket: STORAGE_BUCKET,
        advertiserId: input.advertiserId,
        fileName: input.file.name,
      }),
    });
  } catch (error) {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    throw error;
  }

  const json = (await res.json().catch(() => null)) as
    | (TikTokVideoUploadResult & { ok?: boolean; error?: string })
    | null;
  if (!res.ok || !json?.ok || !json.videoId) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json;
}

async function uploadCampaignAsset(file: File, storagePath: string): Promise<void> {
  const supabase = createClient();
  if (file.size >= RESUMABLE_UPLOAD_THRESHOLD) {
    await uploadResumableTusFromBrowser(STORAGE_BUCKET, storagePath, file);
    return;
  }

  const tryUpload = () =>
    supabase.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
      contentType: file.type || "video/mp4",
      upsert: false,
    });

  let { error } = await tryUpload();
  if (error && /bucket.*not.*found|not.*found|does.*not.*exist/i.test(error.message)) {
    const ensureRes = await fetch("/api/storage/ensure-bucket", { method: "POST" });
    if (ensureRes.ok) {
      const retry = await tryUpload();
      error = retry.error;
    }
  }
  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }
}

async function uploadResumableTusFromBrowser(
  bucket: string,
  storagePath: string,
  file: File,
): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Not signed in — cannot upload to storage");
  }

  const toBase64 = (value: string) => btoa(value);
  const endpoint = `${supabaseUrl}/storage/v1/upload/resumable`;
  const uploadMetadata = [
    `bucketName ${toBase64(bucket)}`,
    `objectName ${toBase64(storagePath)}`,
    `contentType ${toBase64(file.type || "video/mp4")}`,
    `cacheControl ${toBase64("3600")}`,
  ].join(",");

  const createRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "Content-Type": "application/offset+octet-stream",
      "Tus-Resumable": "1.0.0",
      "Upload-Length": String(file.size),
      "Upload-Metadata": uploadMetadata,
      "x-upsert": "true",
    },
  });
  if (createRes.status !== 201) {
    const body = await createRes.text().catch(() => "");
    throw new Error(`TUS create failed: HTTP ${createRes.status} — ${body.slice(0, 200)}`);
  }
  const location = createRes.headers.get("Location");
  if (!location) {
    throw new Error("TUS create: no Location header in response");
  }
  const patchUrl = location.startsWith("http") ? location : `${supabaseUrl}${location}`;
  const patchRes = await fetch(patchUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      "Content-Type": "application/offset+octet-stream",
      "Tus-Resumable": "1.0.0",
      "Upload-Offset": "0",
    },
    body: file,
  });
  if (patchRes.status !== 204) {
    const body = await patchRes.text().catch(() => "");
    throw new Error(`TUS PATCH failed: HTTP ${patchRes.status} — ${body.slice(0, 200)}`);
  }
}
