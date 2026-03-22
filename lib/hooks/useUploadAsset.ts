"use client";

import { useState, useCallback } from "react";
import type { UploadAssetResult, AssetUploadType } from "@/lib/meta/upload";

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
        const formData = new FormData();
        formData.append("file", params.file);
        formData.append("type", params.type);
        formData.append("adAccountId", params.adAccountId);

        const res = await fetch("/api/meta/upload-asset", {
          method: "POST",
          body: formData,
          // Do NOT set Content-Type — browser must set it with the boundary
        });

        const json = (await res.json()) as UploadAssetResult | { error?: string };

        if (!res.ok) {
          const errBody = json as { error?: string };
          const message = errBody.error ?? `HTTP ${res.status}`;
          setError(message);
          throw new Error(message);
        }

        const result = json as UploadAssetResult;
        setData(result);
        return result;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { mutate, loading, error, data, resetError };
}
