// scripts/backfill-ad-daily-insights.mts
//
// History backfill for ad_daily_insights (migration 185), one ad account
// at a time. Same fetch/derive/upsert path as the nightly cron, in 7-day
// windows with a 2 s pause before every Graph call after the first. A
// window Meta fails with code 1/2 is split 7 → 3 → 1 days by the runner
// (`fetchAdAccountInsightsAdaptive`); every split call is counted, and
// so is every batched ad set promoted_object read (≤50 ids a call, only
// sales conversion ad sets not already known).
//
// Dry-run by default: prints the window plan and the minimum call count
// (one call per window; +1 per extra page of 500 ad-days) and calls
// nothing. --apply fetches and writes. Matas picks accounts and range.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-ad-daily-insights.mts \
//     --account act_123 --since 2026-07-01 --until 2026-10-06 [--apply]
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// META_ACCESS_TOKEN. --apply requires migrations 185 and 187.

import { createClient } from "@supabase/supabase-js";

import { graphGetWithToken } from "../lib/meta/client.ts";
import { normalizeAdAccountId } from "../lib/meta/ad-account.ts";
import { AD_INSIGHTS_WINDOW_DAYS, insightsSpans } from "../lib/ad-daily-insights/fetch.ts";
import { runAdDailyInsights } from "../lib/ad-daily-insights/runner.ts";

const CHUNK_DAYS = AD_INSIGHTS_WINDOW_DAYS[0];
const PAUSE_MS = 2000;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const account = normalizeAdAccountId(arg("--account"));
const since = arg("--since");
const until = arg("--until");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
if (!account || !since || !until || !DAY.test(since) || !DAY.test(until) || since > until) {
  throw new Error("Usage: --account act_… --since YYYY-MM-DD --until YYYY-MM-DD [--apply]");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const plan = insightsSpans(since!, until!, CHUNK_DAYS);
  console.log(`account: ${account}`);
  console.log(`range:   ${since}..${until} → ${plan.length} window(s) of ≤${CHUNK_DAYS} days`);
  console.log(
    `minimum Meta calls: ${plan.length} (one per window; +1 per extra page of 500 ad-days; a split 7-day window costs up to 10 more; +1 per 50 new sales conversion ad sets)`,
  );
  console.log(`minimum wall time:  ~${Math.ceil(((plan.length - 1) * PAUSE_MS) / 1000)}s of pauses`);
  if (!APPLY) {
    console.log("\nDry run — no Meta calls made. Re-run with --apply to fetch and write.");
    return;
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.META_ACCESS_TOKEN;
  if (!SUPABASE_URL || !SERVICE_KEY || !token) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or META_ACCESS_TOKEN");
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let first = true;
  const graphGet = async (path: string, params: Record<string, string>) => {
    if (!first) await sleep(PAUSE_MS);
    first = false;
    return graphGetWithToken(path, params, token, { maxAttempts: 1 });
  };

  let calls = 0;
  let rows = 0;
  for (const window of plan) {
    const result = await runAdDailyInsights({
      env: { ENABLE_AD_DAILY_INSIGHTS: "1" },
      db,
      graphGet,
      accounts: [account!],
      window,
    });
    const outcome = result.outcomes?.[0];
    calls += result.metaCalls ?? 0;
    rows += result.rowsWritten ?? 0;
    console.log(
      `${window.since}..${window.until} status=${outcome?.status} calls=${outcome?.calls} adset_calls=${outcome?.adsetCalls} rows=${outcome?.rows}` +
        (outcome?.windowSplit ? ` window_split=${outcome.windowSplit.from}d→${outcome.windowSplit.to}d` : "") +
        (outcome?.error ? ` error=${outcome.error}` : "") +
        (outcome?.adsetError ? ` adset_error=${outcome.adsetError}` : ""),
    );
    if (outcome?.status === "rate_limited" || outcome?.status === "auth_error") {
      console.log("Stopping: account-level Meta error. Re-run from this window later.");
      process.exitCode = 1;
      break;
    }
  }
  console.log(`\nMeta calls: ${calls}  rows written: ${rows}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
