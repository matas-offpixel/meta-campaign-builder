"use client";

import { useState, useCallback } from "react";
import type { CampaignDraft, LaunchSummary } from "@/lib/types";
import { setFbTokenExpiredGlobal } from "@/lib/hooks/useMeta";
import {
  writeBucCooldown,
  type RateLimitUiState,
} from "@/lib/meta/rate-limit-ui";

/** The launch API returns a LaunchSummary only — no draft mutations. */
export type LaunchCampaignResult = LaunchSummary;

export interface LaunchOptions {
  /**
   * Page ID → Instagram account ID mapping derived from the enriched pages
   * cache (fetched with the user's OAuth token).
   *
   * The server-side token used by fetchInstagramAccounts() is a system/app
   * token that may not see the user's page-level IG connections. Passing this
   * map lets the launch route use the already-correct IG IDs without re-querying.
   */
  igAccountMap?: Record<string, string>;
}

export interface UseLaunchCampaignReturn {
  mutate: (draft: CampaignDraft, options?: LaunchOptions) => Promise<LaunchCampaignResult>;
  loading: boolean;
  error: string | null;
  rateLimit: RateLimitUiState | null;
  data: LaunchCampaignResult | null;
  resetError: () => void;
}

export function useLaunchCampaign(): UseLaunchCampaignReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitUiState | null>(null);
  const [data, setData] = useState<LaunchCampaignResult | null>(null);

  const resetError = useCallback(() => {
    setError(null);
    setRateLimit(null);
  }, []);

  const mutate = useCallback(async (
    draft: CampaignDraft,
    options?: LaunchOptions,
  ): Promise<LaunchCampaignResult> => {
    setLoading(true);
    setError(null);
    setRateLimit(null);
    setData(null);

    try {
      const res = await fetch("/api/meta/launch-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          ...(options?.igAccountMap && Object.keys(options.igAccountMap).length > 0
            ? { igAccountMap: options.igAccountMap }
            : {}),
        }),
      });

      const json = (await res.json()) as
        | LaunchCampaignResult
        | {
            error?: string;
            fields?: Record<string, string>;
            metaError?: unknown;
            tokenExpired?: boolean;
            rateLimited?: boolean;
            rateLimit?: RateLimitUiState;
          };

      if (!res.ok) {
        const errBody = json as {
          error?: string;
          fields?: Record<string, string>;
          tokenExpired?: boolean;
          rateLimited?: boolean;
          rateLimit?: RateLimitUiState;
        };
        if (errBody.rateLimited && errBody.rateLimit) {
          setRateLimit(errBody.rateLimit);
          const id = errBody.rateLimit.adAccountId;
          if (id && errBody.rateLimit.resumeAt && typeof window !== "undefined") {
            writeBucCooldown(window.localStorage, id, errBody.rateLimit.resumeAt);
          }
        }
        // Never treat 429 / rateLimited as session expiry — that was the
        // project_auth_error_masks_rate_limit masking bug.
        if (!errBody.rateLimited && (errBody.tokenExpired || res.status === 401)) {
          setFbTokenExpiredGlobal(true);
        }
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

  return { mutate, loading, error, rateLimit, data, resetError };
}
