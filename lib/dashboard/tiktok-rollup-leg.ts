import type { SupabaseClient } from "@supabase/supabase-js";

import { TikTokApiError } from "../tiktok/client.ts";
import type { TikTokDailyInsightRow } from "../tiktok/rollup-insights.ts";

export interface TikTokRollupDeps {
  getCredentials: (
    supabase: SupabaseClient,
    accountId: string,
  ) => Promise<{ access_token: string } | null>;
  fetchDailyInsights: (args: {
    advertiserId: string;
    token: string;
    eventCode: string;
    since: string;
    until: string;
  }) => Promise<TikTokDailyInsightRow[]>;
  upsertRollups: (
    supabase: SupabaseClient,
    args: {
      userId: string;
      eventId: string;
      rows: TikTokDailyInsightRow[];
    },
  ) => Promise<{ upserted: number; skipped_noop: number }>;
  sleep: (ms: number) => Promise<void>;
}

export interface TikTokRollupLegResult {
  ok: boolean;
  rowsWritten?: number;
  skipped_noop?: number;
  error?: string;
  reason?: string;
}

export interface RunTikTokRollupLegInput {
  supabase: SupabaseClient;
  eventId: string;
  userId: string;
  eventCode: string | null;
  tiktokAccountId: string | null;
  since: string;
  until: string;
  retryDelayMs: number;
  deps: TikTokRollupDeps;
}

export async function runTikTokRollupLeg(
  args: RunTikTokRollupLegInput,
): Promise<TikTokRollupLegResult> {
  const result: TikTokRollupLegResult = { ok: false };
  if (!args.eventCode) {
    result.reason = "no_event_code";
    result.error = "Event has no event_code — set one to track TikTok spend.";
    console.warn(
      `[rollup-sync][tiktok] skip reason=${result.reason} event_id=${args.eventId}`,
    );
    return result;
  }
  if (!args.tiktokAccountId) {
    result.reason = "no_tiktok_account";
    console.log(
      `[rollup-sync][tiktok] skip reason=${result.reason} event_id=${args.eventId}`,
    );
    return result;
  }

  try {
    const account = await readTikTokAccount(args.supabase, {
      userId: args.userId,
      accountId: args.tiktokAccountId,
    });
    if (!account?.advertiserId) {
      result.reason = "no_advertiser_id";
      result.error = "TikTok account has no advertiser id.";
      console.warn(
        `[rollup-sync][tiktok] skip reason=${result.reason} event_id=${args.eventId}`,
      );
      return result;
    }

    const credentials = await readTikTokCredentials(
      args.supabase,
      args.tiktokAccountId,
      args.deps,
    );
    if (!credentials?.accessToken) {
      result.reason = "no_credentials";
      result.error = "TikTok credentials are missing or could not be decrypted.";
      console.warn(`[rollup-sync][tiktok] no_credentials event_id=${args.eventId}`);
      return result;
    }

    const rows = await fetchTikTokWithOneRunnerRateLimitRetry({
      advertiserId: account.advertiserId,
      token: credentials.accessToken,
      eventCode: args.eventCode,
      since: args.since,
      until: args.until,
      retryDelayMs: args.retryDelayMs,
      deps: args.deps,
    });
    if (rows.length === 0) {
      result.reason = "no_rows";
      result.error = "No TikTok campaigns matched this event_code in the sync window.";
      console.log(`[rollup-sync][tiktok] no rows event_id=${args.eventId}`);
      return result;
    }

    const { upserted, skipped_noop } = await args.deps.upsertRollups(
      args.supabase,
      {
        userId: args.userId,
        eventId: args.eventId,
        rows,
      },
    );
    result.ok = true;
    result.rowsWritten = upserted;
    result.skipped_noop = skipped_noop;
    console.log(
      `[rollup-sync][tiktok] upsert ok event_id=${args.eventId} rows_written=${upserted} skipped_noop=${skipped_noop}`,
    );
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown error";
    result.reason = "tiktok_failed";
    console.warn(
      `[rollup-sync][tiktok] failed event_id=${args.eventId}: ${result.error}`,
    );
    return result;
  }
}

async function readTikTokAccount(
  supabase: SupabaseClient,
  args: { userId: string; accountId: string },
): Promise<{ advertiserId: string | null } | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = supabase as any;
  const { data, error } = await client
    .from("tiktok_accounts")
    .select("id, tiktok_advertiser_id")
    .eq("id", args.accountId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read TikTok account: ${error.message}`);
  }
  if (!data) return null;
  return { advertiserId: data.tiktok_advertiser_id ?? null };
}

async function readTikTokCredentials(
  supabase: SupabaseClient,
  accountId: string,
  deps: TikTokRollupDeps,
): Promise<{ accessToken: string } | null> {
  try {
    const credentials = await deps.getCredentials(supabase, accountId);
    return credentials?.access_token
      ? { accessToken: credentials.access_token }
      : null;
  } catch (err) {
    console.warn(
      `[rollup-sync][tiktok] credential decrypt/parse failed account_id=${accountId}: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
    return null;
  }
}

async function fetchTikTokWithOneRunnerRateLimitRetry(args: {
  advertiserId: string;
  token: string;
  eventCode: string;
  since: string;
  until: string;
  retryDelayMs: number;
  deps: TikTokRollupDeps;
}): Promise<TikTokDailyInsightRow[]> {
  try {
    return await args.deps.fetchDailyInsights(args);
  } catch (err) {
    if (isTikTokRateLimit(err)) {
      console.warn(
        `[rollup-sync][tiktok] rate_limit retry after ${args.retryDelayMs}ms advertiser_id=${args.advertiserId}`,
      );
      await args.deps.sleep(args.retryDelayMs);
      return args.deps.fetchDailyInsights(args);
    }
    throw err;
  }
}

function isTikTokRateLimit(err: unknown): boolean {
  return err instanceof TikTokApiError && err.code === 50001;
}
