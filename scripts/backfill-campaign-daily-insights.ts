/**
 * Fourteen-day backfill for campaign_daily_insights (migration 178).
 *
 * Idempotent upsert. Dry-run by default — prints every row it would
 * write and writes nothing. Pass --apply after Matas has applied the
 * migration and read the dry-run.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-campaign-daily-insights.ts
 *   node --env-file=.env.local --experimental-strip-types scripts/backfill-campaign-daily-insights.ts --apply
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and a
 * Meta token for each armed campaign's owner.
 */

import { createClient } from "@supabase/supabase-js";

import {
  formatCampaignDailyDryRunRow,
} from "../lib/insights/campaign-daily.ts";
import { runCampaignDailyInsightsPass } from "../lib/insights/campaign-daily-cron.ts";

const APPLY = process.argv.includes("--apply");

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

const result = await runCampaignDailyInsightsPass(supabase, {
  dryRun: !APPLY,
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
