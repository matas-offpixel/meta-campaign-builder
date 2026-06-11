/**
 * storage-upload.ts
 *
 * Wraps Supabase Storage writes for the asset queue.
 *
 * Files ≤ RESUMABLE_THRESHOLD (40 MB) use the standard storage-js `.upload()`
 * call which works fine up to ~50 MB.
 *
 * Files > 40 MB use the Supabase TUS resumable-upload endpoint
 * (`/storage/v1/upload/resumable`) so that the hidden ~50 MB body limit on
 * the simple endpoint never triggers. The bucket's `file_size_limit` (200 MB
 * via migration 118) is the effective ceiling.
 *
 * TUS docs: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
 * TUS spec: https://tus.io/protocols/resumable-upload.html
 *
 * No new npm dependencies — the TUS create + PATCH flow is implemented
 * directly via fetch, which is available in Next.js server contexts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Below this size use simple upload; at or above use TUS. */
export const RESUMABLE_UPLOAD_THRESHOLD = 40 * 1024 * 1024; // 40 MB

function toBase64(s: string): string {
  return Buffer.from(s).toString("base64");
}

/**
 * Uploads `buffer` to Supabase Storage via TUS resumable protocol.
 *
 * Always upserts (overwrites if path already exists).
 * Reads credentials from process.env — must be called from a trusted
 * server context where SUPABASE_SERVICE_ROLE_KEY is set.
 *
 * Returns `{ error: null }` on success; `{ error: Error }` on failure.
 * Never throws.
 */
export async function uploadResumableTus(
  bucket: string,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ error: Error | null }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return {
      error: new Error(
        "NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — cannot run TUS upload",
      ),
    };
  }

  const endpoint = `${supabaseUrl}/storage/v1/upload/resumable`;

  const uploadMetadata = [
    `bucketName ${toBase64(bucket)}`,
    `objectName ${toBase64(storagePath)}`,
    `contentType ${toBase64(contentType)}`,
    `cacheControl ${toBase64("3600")}`,
  ].join(",");

  // ── Step 1: Create upload session ─────────────────────────────────────────
  let createRes: Response;
  try {
    createRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/offset+octet-stream",
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(buffer.byteLength),
        "Upload-Metadata": uploadMetadata,
        "x-upsert": "true",
      },
    });
  } catch (err) {
    return { error: new Error(`TUS create network error: ${(err as Error).message}`) };
  }

  if (createRes.status !== 201) {
    const body = await createRes.text().catch(() => "");
    return {
      error: new Error(`TUS create failed: HTTP ${createRes.status} — ${body.slice(0, 200)}`),
    };
  }

  const location = createRes.headers.get("Location");
  if (!location) {
    return { error: new Error("TUS create: no Location header in response") };
  }

  const patchUrl = location.startsWith("http")
    ? location
    : `${supabaseUrl}${location}`;

  // ── Step 2: Upload the full buffer in one PATCH ────────────────────────────
  // Sending the whole buffer in one PATCH is valid TUS (offset=0 to EOF) and
  // avoids complexity of chunked streaming. Memory is already allocated from
  // the Dropbox download step.
  let patchRes: Response;
  try {
    patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/offset+octet-stream",
        "Tus-Resumable": "1.0.0",
        "Upload-Offset": "0",
        "Content-Length": String(buffer.byteLength),
      },
      body: buffer as unknown as BodyInit,
    });
  } catch (err) {
    return { error: new Error(`TUS PATCH network error: ${(err as Error).message}`) };
  }

  if (patchRes.status !== 204) {
    const body = await patchRes.text().catch(() => "");
    return {
      error: new Error(`TUS PATCH failed: HTTP ${patchRes.status} — ${body.slice(0, 200)}`),
    };
  }

  return { error: null };
}

/**
 * Upload `buffer` to Supabase Storage, choosing the upload strategy based on
 * file size.  Always upserts.
 *
 * @param serviceClient  Service-role client (used for the simple path).
 * @returns `{ error: null }` on success; `{ error: Error | StorageError }` on failure.
 */
export async function uploadToStorageBucket(
  serviceClient: SupabaseClient,
  bucket: string,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
): Promise<{ error: Error | { message: string } | null }> {
  if (buffer.byteLength > RESUMABLE_UPLOAD_THRESHOLD) {
    return uploadResumableTus(bucket, storagePath, buffer, contentType);
  }

  const { error } = await serviceClient.storage
    .from(bucket)
    .upload(storagePath, buffer, { contentType, upsert: true });

  return { error: error ?? null };
}
