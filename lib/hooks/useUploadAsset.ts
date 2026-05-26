"use client";

import { useState, useCallback } from "react";
import type { UploadAssetResult, AssetUploadType } from "@/lib/meta/upload";
import { createClient } from "@/lib/supabase/client";

export interface UploadAssetParams {
  file: File;
  type: AssetUploadType;
  adAccountId: string;
}

interface UseUploadAssetReturn {
  mutate: (params: UploadAssetParams) => Promise<UploadAssetResult>;
  loading: boolean;
  error: string | null;
  data: UploadAssetResult | null;
  resetError: () => void;
}

const STORAGE_BUCKET = "campaign-assets";

/**
 * Upload via Supabase Storage, bypassing Vercel's 4.5 MB serverless body limit.
 * Works for both images (≤30 MB) and videos (≤200 MB).
 *
 *   1. Client uploads file directly to Supabase Storage — no serverless body, no limit.
 *   2. Client sends only { storagePath, type, adAccountId } (tiny JSON) to the API route.
 *   3. API route downloads from storage and forwards to Meta's adimages / advideos endpoint.
 *   4. API route cleans up the storage object after Meta confirms receipt.
 *
 * Exported as a standalone function so it can be used outside the hook
 * (e.g. handleBulkVariationFiles in the Creatives step).
 */
export async function uploadAssetViaStorage(
  params: UploadAssetParams,
): Promise<UploadAssetResult> {
  const supabase = createClient();
  const ext = params.file.name.split(".").pop()?.toLowerCase()
    ?? (params.type === "video" ? "mp4" : "jpg");
  const folder = params.type === "video" ? "videos" : "images";
  const storagePath = `${folder}/${crypto.randomUUID()}.${ext}`;

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "(NEXT_PUBLIC_SUPABASE_URL not set)";
  console.log(
    `[uploadAssetViaStorage] ${params.type} upload → Supabase Storage`,
    `path=${storagePath}`,
    `bucket=${STORAGE_BUCKET}`,
    `project=${projectUrl}`,
    `size=${(params.file.size / 1024 / 1024).toFixed(2)} MB`,
  );

  const tryUpload = async () =>
    supabase.storage.from(STORAGE_BUCKET).upload(storagePath, params.file, {
      contentType: params.file.type,
      upsert: false,
    });

  let { error: storageError } = await tryUpload();

  // Auto-recovery: if the bucket doesn't exist, ask the server to create it then retry once.
  if (storageError && /bucket.*not.*found|not.*found|does.*not.*exist/i.test(storageError.message)) {
    console.warn(
      `[uploadAssetViaStorage] Bucket "${STORAGE_BUCKET}" not found (project: ${projectUrl}). ` +
      `Attempting auto-creation via /api/storage/ensure-bucket…`,
    );
    try {
      const ensureRes = await fetch("/api/storage/ensure-bucket", { method: "POST" });
      const ensureJson = (await ensureRes.json()) as { exists?: boolean; created?: boolean; error?: string };
      if (ensureRes.ok) {
        console.info(
          `[uploadAssetViaStorage] Bucket ${ensureJson.created ? "created" : "confirmed"} — retrying upload`,
        );
        const retryResult = await tryUpload();
        storageError = retryResult.error;
      } else {
        throw new Error(
          `Storage bucket "${STORAGE_BUCKET}" does not exist and could not be created automatically. ` +
          `Fix: run supabase/schema.sql in the Supabase SQL editor, or set SUPABASE_SERVICE_ROLE_KEY in your environment. ` +
          `Detail: ${ensureJson.error ?? "unknown"}`,
        );
      }
    } catch (ensureErr) {
      if (ensureErr instanceof Error && ensureErr.message.includes("Storage bucket")) throw ensureErr;
      console.error("[uploadAssetViaStorage] ensure-bucket network error:", ensureErr);
      // Fall through to the generic error below
    }
  }

  if (storageError) {
    console.error(
      `[uploadAssetViaStorage] Storage upload failed:`,
      `bucket=${STORAGE_BUCKET}`,
      `path=${storagePath}`,
      `project=${projectUrl}`,
      `error="${storageError.message}"`,
    );
    throw new Error(
      `Storage upload failed: ${storageError.message}` +
      (storageError.message.includes("Bucket") || storageError.message.includes("bucket")
        ? ` — check that the "${STORAGE_BUCKET}" bucket exists in Supabase Storage`
        : ""),
    );
  }

  console.log("[uploadAssetViaStorage] Storage upload complete, handing off to server");

  // Send only the path — no raw bytes — so the serverless function body stays tiny.
  let res: Response;
  try {
    res = await fetch("/api/meta/upload-asset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storagePath,
        storageBucket: STORAGE_BUCKET,
        type: params.type,
        adAccountId: params.adAccountId,
        fileName: params.file.name,
      }),
    });
  } catch (networkErr) {
    // Clean up storage if we can't reach the API
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => {});
    throw networkErr;
  }

  // Safe JSON parsing — handles non-JSON error bodies (e.g. "FUNCTION_PAYLOAD_TOO_LARGE")
  let json: unknown;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    json = await res.json();
  } else {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(text || `HTTP ${res.status}`);
    }
    json = {};
  }

  if (!res.ok) {
    const errBody = json as { error?: string };
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }

  return json as UploadAssetResult;
}

export function useUploadAsset(): UseUploadAssetReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UploadAssetResult | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const mutate = useCallback(
    async (params: UploadAssetParams): Promise<UploadAssetResult> => {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const result = await uploadAssetViaStorage(params);
        setData(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { mutate, loading, error, data, resetError };
}
