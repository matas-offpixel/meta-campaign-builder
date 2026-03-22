"use client";

import { useState, useCallback } from "react";
import type {
  CreateCreativesAndAdsRequest,
  CreateCreativesAndAdsResult,
} from "@/lib/meta/creative";

interface UseCreateCreativesAndAdsReturn {
  mutate: (params: CreateCreativesAndAdsRequest) => Promise<CreateCreativesAndAdsResult>;
  loading: boolean;
  error: string | null;
  data: CreateCreativesAndAdsResult | null;
  resetError: () => void;
}

export function useCreateCreativesAndAds(): UseCreateCreativesAndAdsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CreateCreativesAndAdsResult | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const mutate = useCallback(
    async (params: CreateCreativesAndAdsRequest): Promise<CreateCreativesAndAdsResult> => {
      setLoading(true);
      setError(null);
      setData(null);

      try {
        const res = await fetch("/api/meta/create-creatives-and-ads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const json = (await res.json()) as
          | CreateCreativesAndAdsResult
          | { error?: string; errors?: string[] };

        if (!res.ok) {
          const errBody = json as { error?: string; errors?: string[] };
          const message =
            errBody.errors?.join("; ") ??
            errBody.error ??
            `HTTP ${res.status}`;
          setError(message);
          throw new Error(message);
        }

        const result = json as CreateCreativesAndAdsResult;
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
