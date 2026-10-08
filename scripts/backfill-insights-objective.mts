// scripts/backfill-insights-objective.mts
//
// Fills ad_daily_insights.campaign_objective / optimization_goal /
// promoted_event (migration 187) for rows written before the nightly
// cron requested them, per active-client ad account (archived excluded,
// `loadClientAdAccounts`; `--account` must be one of them). Logic: lib/ad-daily-insights/objective-backfill.ts.
// One batched GET per ≤50 ad sets, one attempt each, 2 s apart; a rate
// limit or auth error stops the run (re-run later; filled ad sets are
// skipped).
//
// Modes:
//   (default)  dry run: counts ad sets, prints the call count. No Meta
//              call, no write.
//   --fetch    reads Meta, saves scripts/out/insights-objective-adsets.json
//              for `learning-refresh.mts --dry-run --adset-meta <file>`. No write.
//   --apply    reads Meta and UPDATEs ad_daily_insights. Requires migration 187.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-insights-objective.mts [--account act_…] [--fetch | --apply]

import { mkdirSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { graphGetWithToken } from "../lib/meta/client.ts";
import { normalizeAdAccountId } from "../lib/meta/ad-account.ts";
import {
  backfillAccounts,
  runObjectiveBackfill,
  type ObjectiveBackfillMode,
} from "../lib/ad-daily-insights/objective-backfill.ts";

const PAUSE_MS = 2000;
const SNAPSHOT = "scripts/out/insights-objective-adsets.json";

const mode: ObjectiveBackfillMode = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--fetch")
    ? "fetch"
    : "plan";
const accountArg = process.argv.includes("--account")
  ? normalizeAdAccountId(process.argv[process.argv.indexOf("--account") + 1])
  : null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.META_ACCESS_TOKEN;
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  if (mode !== "plan" && !token) throw new Error("Missing META_ACCESS_TOKEN");
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const has187 = !(await db.from("ad_daily_insights").select("promoted_event").limit(1)).error;
  console.log(`mode: ${mode}  migration 187: ${has187 ? "applied" : "not applied (every ad set counts as missing)"}`);

  let first = true;
  const result = await runObjectiveBackfill({
    db,
    has187,
    mode,
    accounts: await backfillAccounts(db, accountArg),
    graphGet: async (path, params) => {
      if (!first) await sleep(PAUSE_MS);
      first = false;
      return graphGetWithToken(path, params, token!, { maxAttempts: 1 });
    },
  });

  for (const p of result.plan) {
    if (p.adSetIds.length) console.log(`${p.adAccountId}: ${p.adSetIds.length} ad sets → ${p.calls} call(s)`);
  }
  console.log(`Meta calls planned: ${result.plannedCalls}`);
  if (mode === "plan") {
    console.log("\nDry run: no Meta calls, no writes. --fetch reads Meta and saves a snapshot; --apply writes.");
    return;
  }

  const combos = new Map<string, number>();
  for (const m of result.found.values()) {
    const key = `${m.campaignObjective ?? "-"} | ${m.optimizationGoal ?? "-"} | ${m.promotedEvent ?? "-"}`;
    combos.set(key, (combos.get(key) ?? 0) + 1);
  }
  console.log("\nobjective | optimization_goal | promoted_event (ad sets):");
  for (const [key, n] of [...combos].sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${n}`);
  for (const e of result.errors) console.error(e);
  if (result.stopped) {
    console.error("Stopped on a rate limit or auth error.");
    process.exitCode = 1;
  }
  if (mode === "fetch") {
    mkdirSync("scripts/out", { recursive: true });
    writeFileSync(SNAPSHOT, JSON.stringify(Object.fromEntries(result.found), null, 1));
    console.log(`\nSnapshot: ${SNAPSHOT} (${result.found.size} ad sets). No writes.`);
  }
  console.log(
    `\nMeta calls: ${result.metaCalls}  failed batches: ${result.failedBatches}  ad sets read: ${result.found.size}  ad sets updated: ${result.updated}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
