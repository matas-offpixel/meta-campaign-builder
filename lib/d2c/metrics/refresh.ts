import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getD2CConnectionCredentials,
  getScheduledSendById,
  updateScheduledSendStatus,
} from "@/lib/db/d2c";
import type { D2CScheduledSend } from "@/lib/d2c/types";
import { fetchMailchimpMetrics } from "./mailchimp";
import { fetchBirdMetrics } from "./bird";
import {
  readMailchimpCampaignId,
  readMailchimpServerPrefix,
  type D2CSendMetrics,
} from "./types";

/**
 * lib/d2c/metrics/refresh.ts
 *
 * Fetch per-send delivery metrics from the provider and persist them onto
 * `d2c_scheduled_sends.result_jsonb.metrics` (Goal 4). Service-role only.
 * A 60s per-send in-memory rate limit protects the provider APIs from the
 * cron + manual "Refresh" button both firing.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

const RATE_LIMIT_MS = 60_000;
const lastFetchBySend = new Map<string, number>();

export interface RefreshResult {
  ok: boolean;
  metrics?: D2CSendMetrics;
  error?: string;
  /** true when the 60s cooldown blocked the fetch (existing metrics kept). */
  rateLimited?: boolean;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function mergeMetrics(resultJsonb: unknown, metrics: D2CSendMetrics): unknown {
  const base =
    resultJsonb && typeof resultJsonb === "object" && !Array.isArray(resultJsonb)
      ? (resultJsonb as Record<string, unknown>)
      : {};
  return { ...base, metrics };
}

async function fetchForSend(
  admin: AnySupabaseClient,
  send: D2CScheduledSend,
  nowIso: string,
): Promise<D2CSendMetrics | { error: string }> {
  let creds: Record<string, unknown> | null;
  try {
    creds = await getD2CConnectionCredentials(admin, send.connection_id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "credential read failed" };
  }
  if (!creds) return { error: "connection credentials unavailable" };

  if (send.channel === "email") {
    const apiKey = readString(creds, "api_key");
    const serverPrefix =
      readString(creds, "server_prefix") ??
      readMailchimpServerPrefix(send.result_jsonb) ??
      "";
    const campaignId = readMailchimpCampaignId(send.result_jsonb);
    if (!apiKey || !serverPrefix) return { error: "Mailchimp credentials unavailable" };
    if (!campaignId) return { error: "No Mailchimp campaign id on this send yet" };
    try {
      return await fetchMailchimpMetrics(serverPrefix, apiKey, campaignId, { nowIso });
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Mailchimp report fetch failed" };
    }
  }

  // WhatsApp / SMS → Bird
  const apiKey = readString(creds, "api_key");
  const workspaceId = readString(creds, "workspace_id");
  const campaignId = send.bird_campaign_id;
  const broadcastId = send.bird_broadcast_id;
  if (!apiKey || !workspaceId) return { error: "Bird credentials unavailable" };
  if (!campaignId || !broadcastId) {
    return { error: "No Bird broadcast id on this send yet" };
  }
  try {
    return await fetchBirdMetrics(apiKey, workspaceId, campaignId, broadcastId, { nowIso });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Bird metrics fetch failed" };
  }
}

/**
 * Refresh metrics for a single send. Idempotent + rate-limited (60s/send).
 * Writes to result_jsonb.metrics on success; leaves existing metrics untouched
 * on error or rate-limit.
 */
export async function refreshSendMetrics(
  admin: AnySupabaseClient,
  sendId: string,
  opts?: { force?: boolean; nowMs?: number },
): Promise<RefreshResult> {
  const now = opts?.nowMs ?? Date.now();
  const last = lastFetchBySend.get(sendId);
  if (!opts?.force && last !== undefined && now - last < RATE_LIMIT_MS) {
    return { ok: false, rateLimited: true, error: "Rate limited — try again shortly" };
  }

  const send = await getScheduledSendById(admin, sendId);
  if (!send) return { ok: false, error: "Send not found" };

  const nowIso = new Date(now).toISOString();
  const result = await fetchForSend(admin, send, nowIso);
  if ("error" in result) return { ok: false, error: result.error };

  lastFetchBySend.set(sendId, now);
  const updated = await updateScheduledSendStatus(admin, sendId, {
    resultJsonb: mergeMetrics(send.result_jsonb, result),
  });
  if (!updated) return { ok: false, error: "Could not persist metrics" };
  return { ok: true, metrics: result };
}

/** Test-only: reset the per-send rate-limit map. */
export function __clearMetricsRateLimitForTests(): void {
  lastFetchBySend.clear();
}
