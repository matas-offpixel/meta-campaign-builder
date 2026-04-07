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
        if (params.type === "video") {
          return await uploadViaStorage(params);
        } else {
          return await uploadViaFormData(params);
        }
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

  /**
   * Video upload path:
   *   1. Upload raw file directly to Supabase Storage (bypasses Vercel 4.5MB payload limit)
   *   2. Send only {storagePath, type, adAccountId} (tiny JSON) to the API route
   *   3. API route fetches from storage and streams to Meta
   *   4. Clean up storage object after Meta confirms receipt
   */
  async function uploadViaStorage(params: UploadAssetParams): Promise<UploadAssetResult> {
    const supabase = createClient();
    const ext = params.file.name.split(".").pop()?.toLowerCase() ?? "mp4";
    const storagePath = `videos/${crypto.randomUUID()}.${ext}`;

    console.log(
      "[useUploadAsset] Video upload path: Supabase Storage →",
      storagePath,
      `| size: ${(params.file.size / 1024 / 1024).toFixed(2)} MB`,
    );

    // Step 1: upload directly to Supabase Storage (no serverless intermediary)
    const { error: storageError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, params.file, {
        contentType: params.file.type || "video/mp4",
        upsert: false,
      });

    if (storageError) {
      throw new Error(`Storage upload failed: ${storageError.message}`);
    }

    console.log("[useUploadAsset] Storage upload complete, handing off to server");

    // Step 2: tell the server where the file is — no raw bytes in this payload
    let res: Response;
    try {
      res = await fetch("/api/meta/upload-asset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath,
          storageBucket: STORAGE_BUCKET,
          type: "video",
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

    const result = json as UploadAssetResult;
    setData(result);
    return result;
  }

  /**
   * Image upload path (images are small enough for direct FormData):
   *   POST /api/meta/upload-asset with multipart form data
   */
  async function uploadViaFormData(params: UploadAssetParams): Promise<UploadAssetResult> {
    console.log(
      "[useUploadAsset] Image upload path: FormData →",
      `/api/meta/upload-asset | size: ${(params.file.size / 1024 / 1024).toFixed(2)} MB`,
    );

    const formData = new FormData();
    formData.append("file", params.file);
    formData.append("type", params.type);
    formData.append("adAccountId", params.adAccountId);

    let res: Response;
    try {
      res = await fetch("/api/meta/upload-asset", {
        method: "POST",
        body: formData,
        // Do NOT set Content-Type — browser must set it with the boundary
      });
    } catch (networkErr) {
      throw networkErr;
    }

    // Safe JSON parsing
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
      const message = errBody.error ?? `HTTP ${res.status}`;
      throw new Error(message);
    }

    const result = json as UploadAssetResult;
    setData(result);
    return result;
  }

  return { mutate, loading, error, data, resetError };
}
