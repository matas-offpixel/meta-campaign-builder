/**
 * Fourteen-day backfill for campaign_daily_insights (migration 178).
 *
 * Idempotent upsert. Dry-run by default — prints every row it would
 * write and writes nothing. Pass --apply after the migration is on
 * prod and the dry-run has been read.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-campaign-daily-insights.ts
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-campaign-daily-insights.ts --apply
 *
 * Does not import lib/meta/client.ts (parameter properties break
 * node --experimental-strip-types). Graph GET is a thin fetch here;
 * the cron adapter still uses graphGetWithToken.
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and a
 * Meta token for each armed campaign's owner.
 */

import { createClient } from "@supabase/supabase-js";

import {
  loadArmedCampaignsForDailyInsights,
  upsertCampaignDailyInsights,
} from "../lib/db/campaign-daily-insights.ts";
import { fetchCampaignDailyInsights } from "../lib/insights/campaign-daily-fetch.ts";
import {
  formatCampaignDailyDryRunRow,
  runCampaignDailyInsightsSync,
} from "../lib/insights/campaign-daily.ts";
import { resolveServerMetaToken } from "../lib/meta/server-token.ts";

const APPLY = process.argv.includes("--apply");
const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function graphGetWithToken<T>(
  path: string,
  params: Record<string, string>,
  token: string,
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || json.error) {
    throw new Error(json.error?.message ?? `Graph HTTP ${res.status} ${path}`);
  }
  return json;
}

const result = await runCampaignDailyInsightsSync({
  now: new Date(),
  dryRun: !APPLY,
  loadCampaigns: () => loadArmedCampaignsForDailyInsights(supabase),
  resolveToken: async (userId) => {
    try {
      const resolved = await resolveServerMetaToken(supabase, userId);
      return resolved.token;
    } catch (err) {
      console.warn(
        `[campaign-daily-insights] token missing user=${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  },
  fetchInsights: (args) => fetchCampaignDailyInsights(graphGetWithToken, args),
  upsert: (rows) => upsertCampaignDailyInsights(supabase, rows),
});

console.log(
  APPLY
    ? `wrote ${result.written} rows across ${result.campaigns} armed campaigns (skipped_no_token=${result.skippedNoToken})`
    : `dry-run: would write ${result.rows.length} rows across ${result.campaigns} armed campaigns (skipped_no_token=${result.skippedNoToken})`,
);

for (const row of result.rows) {
  console.log(formatCampaignDailyDryRunRow(row));
}

if (!APPLY) {
  console.log("\nPass --apply to write. Migration 178 must be applied first.");
}
