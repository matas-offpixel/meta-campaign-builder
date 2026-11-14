import type { SupabaseClient } from "@supabase/supabase-js";

import { loadCampaignOverrides } from "../attribution/campaign-owner.ts";
import { loadAllPaged } from "../db/paged-read.ts";
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
    eventId?: string;
    campaignOverrides?: ReadonlyMap<string, string>;
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
  /** campaign_event_overrides for TikTok (migration 240). Defaults to the table; empty until it is applied. */
  loadOverrides?: (supabase: SupabaseClient) => Promise<ReadonlyMap<string, string>>;
  /** Days in the window that already hold TikTok spend for this event. Defaults to event_daily_rollups. */
  readSpendDays?: (supabase: SupabaseClient, args: { eventId: string; since: string; until: string }) => Promise<string[]>;
}

/**
 * A day this event's rollup holds TikTok spend for, that this run found no
 * matching campaign on, is cleared to zero: the campaign was renamed or
 * re-pointed (an override) since. Without this the old row stays and the
 * spend counts on two events (#1225: £8.01 on AZYR and Locklead, 29 Oct).
 */
export function withClearedTikTokDays(rows: TikTokDailyInsightRow[], spendDays: readonly string[]): TikTokDailyInsightRow[] {
  const have = new Set(rows.map((r) => r.date));
  const cleared = spendDays
    .filter((day) => !have.has(day))
    .map((date) => ({
      date,
      tiktok_spend: 0,
      tiktok_impressions: 0,
      tiktok_reach: 0,
      tiktok_clicks: 0,
      tiktok_video_views: 0,
      tiktok_video_views_2s: 0,
      tiktok_video_views_6s: 0,
      tiktok_video_views_100p: 0,
      tiktok_avg_play_time_ms: null,
      tiktok_post_engagement: 0,
      tiktok_results: 0,
      tiktok_engagement_results: 0,
    }));
  return [...rows, ...cleared].sort((a, b) => a.date.localeCompare(b.date));
}

/** A failed side read never fails the leg: it falls back and says so. */
async function softly<T>(read: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await read();
  } catch (err) {
    console.warn(`[rollup-sync][tiktok] ${label}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback;
  }
}

async function readTikTokSpendDays(
  supabase: SupabaseClient,
  args: { eventId: string; since: string; until: string },
): Promise<string[]> {
  const rows = await loadAllPaged<{ id: string; date: string }>(supabase, "event_daily_rollups", "id,date", ["id"], (q) =>
    q.eq("event_id", args.eventId).gte("date", args.since).lte("date", args.until).gt("tiktok_spend", 0),
  );
  return rows.map((r) => r.date);
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
  console.log(
    `[rollup-sync][tiktok] enter event_id=${args.eventId} event_code=${args.eventCode ?? "<null>"} tiktok_account_id=${args.tiktokAccountId ?? "<null>"}`,
  );
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

    const campaignOverrides = await softly(
      () => (args.deps.loadOverrides ?? ((sb) => loadCampaignOverrides(sb, "tiktok")))(args.supabase),
      new Map<string, string>(),
      `overrides read failed event_id=${args.eventId}`,
    );
    const fetched = await fetchTikTokWithOneRunnerRateLimitRetry({
      advertiserId: account.advertiserId,
      token: credentials.accessToken,
      eventCode: args.eventCode,
      since: args.since,
      until: args.until,
      eventId: args.eventId,
      campaignOverrides,
      retryDelayMs: args.retryDelayMs,
      deps: args.deps,
    });
    const spendDays = await softly(
      () => (args.deps.readSpendDays ?? readTikTokSpendDays)(args.supabase, { eventId: args.eventId, since: args.since, until: args.until }),
      [] as string[],
      `spend-days read failed event_id=${args.eventId}; nothing cleared this run`,
    );
    const rows = withClearedTikTokDays(fetched, spendDays);
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
  eventId: string;
  campaignOverrides: ReadonlyMap<string, string>;
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
