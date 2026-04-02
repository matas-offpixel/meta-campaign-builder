"use client";

import { useState, useCallback } from "react";
import type { CampaignDraft, LaunchSummary } from "@/lib/types";

/** The launch API returns a LaunchSummary only — no draft mutations. */
export type LaunchCampaignResult = LaunchSummary;

export interface UseLaunchCampaignReturn {
  mutate: (draft: CampaignDraft) => Promise<LaunchCampaignResult>;
  loading: boolean;
  error: string | null;
  data: LaunchCampaignResult | null;
  resetError: () => void;
}

export function useLaunchCampaign(): UseLaunchCampaignReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LaunchCampaignResult | null>(null);

  const resetError = useCallback(() => setError(null), []);

  const mutate = useCallback(async (draft: CampaignDraft): Promise<LaunchCampaignResult> => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/meta/launch-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft }),
      });

      const json = (await res.json()) as
        | LaunchCampaignResult
        | { error?: string; fields?: Record<string, string>; metaError?: unknown };

      if (!res.ok) {
        const errBody = json as { error?: string; fields?: Record<string, string> };
        const fieldErrors = errBody.fields ? Object.values(errBody.fields).join(". ") : null;
        throw new Error(fieldErrors ?? errBody.error ?? `HTTP ${res.status}`);
      }

      const result = json as LaunchCampaignResult;
      setData(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Launch failed";
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  return { mutate, loading, error, data, resetError };
}
