// scripts/backfill-google-ads-insights.mts
//
// History backfill for the migration 192 Google Ads tables, one account at
// a time. Same fetch/map path as /api/cron/google-ads-daily-insights, in
// 7-day windows. Read-only against Google Ads in both modes (GAQL search
// only, never a mutate).
//
// Dry-run by default: fetches and maps, writes nothing, and prints row
// counts, campaigns by channel type, Google calls and any failed window
// (including event-rollup spend on a day with no campaign rows). --apply
// writes the rows. --show-locations CODE prints spend by country per day
// for the campaigns whose name carries [CODE] (exact case).
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-google-ads-insights.mts \
//     --account 839-818-3094 --since 2026-09-01 --until 2026-10-08 \
//     [--show-locations IRW0004] [--apply]
//
// --account takes a google_ads_accounts id or a Google customer id.
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// GOOGLE_ADS_TOKEN_KEY, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET,
// GOOGLE_ADS_DEVELOPER_TOKEN. --apply requires migration 192.

import { createClient } from "@supabase/supabase-js";

import { GoogleAdsClient } from "../lib/google-ads/client.ts";
import { getGoogleAdsCredentials } from "../lib/google-ads/credentials.ts";
import type { DailySnapshotRow, LocationSnapshotRow } from "../lib/google-ads/campaign-insights/map.ts";
import { customerDigits, runGoogleAdsDailyInsights } from "../lib/google-ads/campaign-insights/runner.ts";

const CHUNK_DAYS = 7;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const accountArg = arg("--account");
const since = arg("--since");
const until = arg("--until");
const showLocations = arg("--show-locations");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
if (!accountArg || !since || !until || !DAY.test(since) || !DAY.test(until) || since > until) {
  throw new Error("Usage: --account <id|customer id> --since YYYY-MM-DD --until YYYY-MM-DD [--show-locations CODE] [--apply]");
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function windows(from: string, to: string): { since: string; until: string }[] {
  const out: { since: string; until: string }[] = [];
  for (let start = from; start <= to; start = addDays(start, CHUNK_DAYS)) {
    const end = addDays(start, CHUNK_DAYS - 1);
    out.push({ since: start, until: end < to ? end : to });
  }
  return out;
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const client = new GoogleAdsClient();

  const { data: accounts, error } = await db.from("google_ads_accounts").select("id, account_name, google_customer_id");
  if (error) throw new Error(`google_ads_accounts: ${error.message}`);
  const account = (accounts ?? []).find(
    (a) => a.id === accountArg || customerDigits(a.google_customer_id ?? "") === customerDigits(accountArg!),
  );
  if (!account) throw new Error(`No google_ads_accounts row for ${accountArg}`);

  const plan = windows(since!, until!);
  console.log(`account: ${account.account_name} (${account.google_customer_id}, ${account.id})`);
  console.log(`range:   ${since}..${until} → ${plan.length} window(s) of ≤${CHUNK_DAYS} days`);
  console.log(`mode:    ${APPLY ? "APPLY (writes migration 192 tables)" : "dry run (Google read-only, no writes)"}\n`);

  let credentialsLoaded: Awaited<ReturnType<typeof getGoogleAdsCredentials>> | undefined;
  const loadCredentials = async (id: string) => {
    if (credentialsLoaded === undefined) credentialsLoaded = await getGoogleAdsCredentials(db as never, id);
    return credentialsLoaded;
  };
  const query = (c: { customer_id: string; refresh_token: string; login_customer_id?: string | null }, gaql: string) =>
    client.query<unknown[]>({ customerId: c.customer_id, refreshToken: c.refresh_token, loginCustomerId: c.login_customer_id }, gaql);

  let calls = 0;
  const totals = { campaigns: 0, searchTerms: 0, locations: 0, written: 0 };
  const channelOf = new Map<string, string>();
  const codeOf = new Map<string, string | null>();
  const locations: LocationSnapshotRow[] = [];
  const campaigns: DailySnapshotRow[] = [];
  const failures: string[] = [];
  for (const window of plan) {
    const result = await runGoogleAdsDailyInsights({
      env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: "1" },
      db,
      query,
      loadCredentials,
      accountIds: [account.id],
      window,
      write: APPLY,
      recordRun: false,
      onRows: (rows) => {
        for (const r of rows.campaigns) {
          channelOf.set(r.campaign_resource_name, r.advertising_channel_type ?? "UNKNOWN");
          codeOf.set(r.campaign_resource_name, r.event_code);
        }
        campaigns.push(...rows.campaigns);
        locations.push(...rows.locations);
      },
    });
    const outcome = result.outcomes?.[0];
    calls += result.calls ?? 0;
    totals.written += result.rowsWritten ?? 0;
    if (outcome) {
      totals.campaigns += outcome.campaignRows;
      totals.searchTerms += outcome.searchTermRows;
      totals.locations += outcome.locationRows;
      if (outcome.status !== "ok") failures.push(`${window.since}..${window.until} ${outcome.status}: ${outcome.error ?? ""}`);
    } else {
      failures.push(`${window.since}..${window.until} account not loaded (archived client, or no client/event links it)`);
    }
    console.log(
      `${window.since}..${window.until}  calls=${result.calls ?? 0}  campaign_rows=${outcome?.campaignRows ?? 0}  search_terms=${outcome?.searchTermRows ?? 0}  locations=${outcome?.locationRows ?? 0}  status=${outcome?.status ?? "not_loaded"}`,
    );
  }

  const byChannel: Record<string, number> = {};
  for (const channel of channelOf.values()) byChannel[channel] = (byChannel[channel] ?? 0) + 1;
  const spend = campaigns.reduce((s, r) => s + r.cost_micros, 0) / 1e6;
  console.log(`\ncampaign-day rows:  ${totals.campaigns} (spend £${spend.toFixed(2)})`);
  console.log(`search-term rows:   ${totals.searchTerms}`);
  console.log(`location rows:      ${totals.locations}`);
  console.log(`campaigns:          ${channelOf.size} ${JSON.stringify(byChannel)}`);
  console.log(`Google calls:       ${calls} (all GAQL search, zero mutates)`);
  console.log(`rows written:       ${totals.written}${APPLY ? "" : " (dry run)"}`);
  console.log(`failed windows:     ${failures.length === 0 ? "none" : `\n  ${failures.join("\n  ")}`}`);

  if (showLocations) {
    const mine = locations.filter((l) => codeOf.get(l.campaign_resource_name) === showLocations);
    const ids = [...new Set(mine.map((l) => l.country_criterion_id))];
    const names = new Map<number, string>();
    if (ids.length > 0) {
      const creds = await loadCredentials(account.id);
      if (creds) {
        const rows = (await query(
          creds,
          `SELECT geo_target_constant.id, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.id IN (${ids.join(",")})`,
        )) as { geo_target_constant?: { id?: string; name?: string } }[];
        calls += 1;
        for (const r of rows) names.set(Number(r.geo_target_constant?.id), r.geo_target_constant?.name ?? "?");
      }
    }
    const table = new Map<string, { cost: number; clicks: number; impressions: number }>();
    for (const l of mine) {
      const key = `${l.date}\t${names.get(l.country_criterion_id) ?? l.country_criterion_id} (${l.country_criterion_id})\t${l.location_type}`;
      const t = table.get(key) ?? { cost: 0, clicks: 0, impressions: 0 };
      t.cost += l.cost_micros / 1e6;
      t.clicks += l.clicks;
      t.impressions += l.impressions;
      table.set(key, t);
    }
    console.log(`\n[${showLocations}] spend by country (geographic_view), +1 Google call for names:`);
    console.log("date\tcountry\tlocation_type\tcost\tclicks\timpressions");
    for (const [key, t] of [...table.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`${key}\t£${t.cost.toFixed(2)}\t${t.clicks}\t${t.impressions}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
