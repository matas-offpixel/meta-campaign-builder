import type { SupabaseClient } from "@supabase/supabase-js";

import type { GoogleAdsCredentials } from "@/lib/google-ads/credentials";
import type { GoogleAdsDailyInsightRow } from "@/lib/google-ads/rollup-insights";

export interface GoogleAdsRollupDeps {
  getCredentials: (
    supabase: SupabaseClient,
    accountId: string,
  ) => Promise<GoogleAdsCredentials | null>;
  fetchDailyInsights: (args: {
    customerId: string;
    refreshToken: string;
    loginCustomerId?: string | null;
    eventCode: string;
    since: string;
    until: string;
  }) => Promise<GoogleAdsDailyInsightRow[]>;
  upsertRollups: (
    supabase: SupabaseClient,
    args: {
      userId: string;
      eventId: string;
      rows: GoogleAdsDailyInsightRow[];
    },
  ) => Promise<void>;
}

export interface GoogleAdsRollupLegResult {
  ok: boolean;
  rowsWritten?: number;
  error?: string;
  reason?: string;
}

export interface RunGoogleAdsRollupLegInput {
  supabase: SupabaseClient;
  eventId: string;
  userId: string;
  eventCode: string | null;
  googleAdsAccountId: string | null;
  since: string;
  until: string;
  deps: GoogleAdsRollupDeps;
}

export async function runGoogleAdsRollupLeg(
  args: RunGoogleAdsRollupLegInput,
): Promise<GoogleAdsRollupLegResult> {
  const result: GoogleAdsRollupLegResult = { ok: false };
  if (!args.eventCode) {
    result.reason = "no_event_code";
    result.error = "Event has no event_code — set one to track Google Ads spend.";
    console.warn(
      `[rollup-sync][google-ads] skip reason=${result.reason} event_id=${args.eventId}`,
    );
    return result;
  }
  if (!args.googleAdsAccountId) {
    result.reason = "no_google_ads_account";
    console.log(
      `[rollup-sync][google-ads] skip reason=${result.reason} event_id=${args.eventId}`,
    );
    return result;
  }

  try {
    const account = await readGoogleAdsAccount(args.supabase, {
      userId: args.userId,
      accountId: args.googleAdsAccountId,
    });
    if (!account?.customerId) {
      result.reason = "no_customer_id";
      result.error = "Google Ads account has no customer id.";
      console.warn(
        `[rollup-sync][google-ads] skip reason=${result.reason} event_id=${args.eventId}`,
      );
      return result;
    }

    const credentials = await readGoogleAdsCredentials(
      args.supabase,
      args.googleAdsAccountId,
      args.deps,
    );
    if (!credentials?.refresh_token) {
      result.reason = "no_credentials";
      result.error = "Google Ads credentials are missing or could not be decrypted.";
      console.warn(`[rollup-sync][google-ads] no_credentials event_id=${args.eventId}`);
      return result;
    }

    const rows = await args.deps.fetchDailyInsights({
      customerId: account.customerId,
      refreshToken: credentials.refresh_token,
      loginCustomerId: account.loginCustomerId ?? credentials.login_customer_id,
      eventCode: args.eventCode,
      since: args.since,
      until: args.until,
    });
    if (rows.length === 0) {
      result.reason = "no_rows";
      result.error = "No Google Ads campaigns matched this event_code in the sync window.";
      console.log(`[rollup-sync][google-ads] no rows event_id=${args.eventId}`);
      return result;
    }

    await args.deps.upsertRollups(args.supabase, {
      userId: args.userId,
      eventId: args.eventId,
      rows,
    });
    result.ok = true;
    result.rowsWritten = rows.length;
    console.log(
      `[rollup-sync][google-ads] upsert ok event_id=${args.eventId} rows_written=${rows.length}`,
    );
    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : "Unknown error";
    result.reason = "google_ads_failed";
    console.warn(
      `[rollup-sync][google-ads] failed event_id=${args.eventId}: ${result.error}`,
    );
    return result;
  }
}

async function readGoogleAdsAccount(
  supabase: SupabaseClient,
  args: { userId: string; accountId: string },
): Promise<{ customerId: string | null; loginCustomerId: string | null } | null> {
  const client = supabase as unknown as {
    from(table: string): {
      select(columns: string): {
        eq(column: string, value: string): {
          eq(column: string, value: string): {
            maybeSingle(): Promise<{
              data: {
                google_customer_id?: string | null;
                login_customer_id?: string | null;
              } | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
  const { data, error } = await client
    .from("google_ads_accounts")
    .select("id, google_customer_id, login_customer_id")
    .eq("id", args.accountId)
    .eq("user_id", args.userId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to read Google Ads account: ${error.message}`);
  }
  if (!data) return null;
  return {
    customerId: data.google_customer_id ?? null,
    loginCustomerId: data.login_customer_id ?? null,
  };
}

async function readGoogleAdsCredentials(
  supabase: SupabaseClient,
  accountId: string,
  deps: GoogleAdsRollupDeps,
): Promise<GoogleAdsCredentials | null> {
  try {
    return await deps.getCredentials(supabase, accountId);
  } catch (err) {
    console.warn(
      `[rollup-sync][google-ads] credential decrypt/parse failed account_id=${accountId}: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
    );
    return null;
  }
}
