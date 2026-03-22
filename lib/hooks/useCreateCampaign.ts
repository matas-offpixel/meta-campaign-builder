"use client";

import { useState, useCallback } from "react";
import type { CampaignObjective } from "@/lib/types";
import type { CreateCampaignResult } from "@/lib/meta/campaign";

export interface CreateCampaignParams {
  metaAdAccountId: string;
  name: string;
  objective: CampaignObjective;
  status?: "ACTIVE" | "PAUSED";
}

export interface UseCreateCampaignReturn {
  mutate: (params: CreateCampaignParams) => Promise<CreateCampaignResult>;
  loading: boolean;
  error: string | null;
  data: CreateCampaignResult | null;
  resetError: () => void;
}

export function useCreateCampaign(): UseCreateCampaignReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CreateCampaignResult | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const mutate = useCallback(
    async (params: CreateCampaignParams): Promise<CreateCampaignResult> => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/meta/create-campaign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });

        const json = (await res.json()) as
          | CreateCampaignResult
          | { error: string; fields?: Record<string, string>; code?: number };

        if (!res.ok) {
          const errJson = json as { error: string; fields?: Record<string, string> };
          // Surface field-level validation errors as a readable message
          const fieldErrors = errJson.fields
            ? Object.values(errJson.fields).join(". ")
            : null;
          throw new Error(fieldErrors ?? errJson.error ?? `HTTP ${res.status}`);
        }

        const result = json as CreateCampaignResult;
        setData(result);
        return result;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to create campaign";
        setError(message);
        // Re-throw so the caller's try/catch can differentiate success from failure
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { mutate, loading, error, data, resetError };
}
