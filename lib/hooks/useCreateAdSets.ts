"use client";

import { useState, useCallback } from "react";
import type { CreateAdSetsRequest, CreateAdSetsResult } from "@/lib/meta/adset";

export interface UseCreateAdSetsReturn {
  mutate: (params: CreateAdSetsRequest) => Promise<CreateAdSetsResult>;
  loading: boolean;
  error: string | null;
  data: CreateAdSetsResult | null;
  resetError: () => void;
}

export function useCreateAdSets(): UseCreateAdSetsReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CreateAdSetsResult | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const mutate = useCallback(
    async (params: CreateAdSetsRequest): Promise<CreateAdSetsResult> => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/meta/create-adsets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const json = (await res.json()) as
          | CreateAdSetsResult
          | { error: string; details?: string[] };

        if (!res.ok) {
          const errJson = json as { error: string; details?: string[] };
          const details = errJson.details?.join(". ") ?? null;
          throw new Error(details ?? errJson.error ?? `HTTP ${res.status}`);
        }

        const result = json as CreateAdSetsResult;
        setData(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create ad sets";
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
