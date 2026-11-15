/**
 * Creative Lab weekly judge, by hand.
 *
 *   npx tsx --env-file=.env.local scripts/creative-lab-judge.mts --round <round id> [--on YYYY-MM-DD] [--apply]
 *   npx tsx --env-file=.env.local scripts/creative-lab-judge.mts --adset <meta adset id> [--adset <id> ...] [--on YYYY-MM-DD]
 *
 * --round judges a round's ads across every ad set they were launched
 * into (creative_lab_round_ad_launches). --adset judges ad sets that have
 * no round rows: every ad that delivered in the window is judged on its
 * own, keyed by meta_ad_id. --on sets the judging day (default today,
 * UTC); the window is lib/creative-lab/judge.ts `judgingWindow`.
 *
 * Dry run by default: reads prod with the service role and prints one
 * table. --apply (with --round only) writes the verdict columns on
 * creative_lab_round_ads and marks the round judged. Spend in GBP.
 * Prints ad names and counts only. Zero Meta calls.
 */

import { createClient } from "@supabase/supabase-js";

import { resolveAdContext } from "../lib/learning/ad-facts.ts";
import { judgeRound, judgingWindow, type AdVerdict, type JudgeAdSet, type JudgeRoundAd, type Verdict } from "../lib/creative-lab/judge.ts";
import {
  loadAdContextFor,
  loadAdSetLedger,
  loadAdSetRows,
  loadClientBaselines,
  loadCurrency,
  loadDataThrough,
  loadStageEvents,
  type JudgeAdDayRow,
} from "../lib/creative-lab/load.ts";

const argv = process.argv.slice(2);
const valuesOf = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const roundId = valuesOf("--round")[0] ?? null;
const adSetArgs = valuesOf("--adset");
const apply = argv.includes("--apply");
const judgedOn = valuesOf("--on")[0] ?? new Date().toISOString().slice(0, 10);

if (Boolean(roundId) === adSetArgs.length > 0 || (apply && !roundId) || !/^\d{4}-\d{2}-\d{2}$/.test(judgedOn)) {
  console.error("usage: scripts/creative-lab-judge.mts --round <id> [--on YYYY-MM-DD] [--apply] | --adset <id> [--adset <id> ...] [--on YYYY-MM-DD]");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function must<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.data == null) throw new Error(`${label}: not found`);
  return result.data;
}

const window = judgingWindow(judgedOn);

type RoundAdRow = { id: string; ad_name: string; clip_id: string; caption_id: string; retest_of: string | null };
type LaunchRow = { round_ad_id: string; meta_ad_id: string; meta_adset_id: string; created_at: string };

let round: { id: string; status: string; round_no: number; launched_at: string | null } | null = null;
let roundAds: JudgeRoundAd[] = [];
let adSetIds: string[];

if (roundId) {
  round = must(await db.from("creative_lab_rounds").select("id, status, round_no, launched_at").eq("id", roundId).maybeSingle(), "creative_lab_rounds");
  const ads = must(
    await db.from("creative_lab_round_ads").select("id, ad_name, clip_id, caption_id, retest_of").eq("round_id", roundId),
    "creative_lab_round_ads",
  ) as RoundAdRow[];
  const launches = ads.length
    ? (must(
        await db
          .from("creative_lab_round_ad_launches")
          .select("round_ad_id, meta_ad_id, meta_adset_id, created_at")
          .in(
            "round_ad_id",
            ads.map((a) => a.id),
          ),
        "creative_lab_round_ad_launches",
      ) as LaunchRow[])
    : [];
  const retestIds = ads.map((a) => a.retest_of).filter((id): id is string => Boolean(id));
  const earlier = retestIds.length
    ? (must(await db.from("creative_lab_round_ads").select("id, verdict").in("id", retestIds), "creative_lab_round_ads (re-tests)") as {
        id: string;
        verdict: Verdict | null;
      }[])
    : [];
  const earlierVerdict = new Map(earlier.map((r) => [r.id, r.verdict]));
  roundAds = ads.map((a) => {
    const mine = launches.filter((l) => l.round_ad_id === a.id);
    const firstLaunch = mine.map((l) => l.created_at.slice(0, 10)).sort()[0] ?? round?.launched_at?.slice(0, 10) ?? null;
    return {
      key: a.id,
      label: a.ad_name,
      launches: mine.map((l) => ({ metaAdId: l.meta_ad_id, adSetId: l.meta_adset_id })),
      liveFrom: firstLaunch,
      retestOfVerdict: a.retest_of ? (earlierVerdict.get(a.retest_of) ?? null) : null,
      clipId: a.clip_id,
      captionId: a.caption_id,
    };
  });
  adSetIds = [...new Set(launches.map((l) => l.meta_adset_id))];
} else {
  adSetIds = [...new Set(adSetArgs)];
}

const rows: JudgeAdDayRow[] = await loadAdSetRows(db, adSetIds, window.end);

if (!roundId) {
  const byAd = new Map<string, JudgeAdDayRow>();
  for (const r of rows) {
    if (r.date < window.start || r.date > window.end) continue;
    const seen = byAd.get(r.meta_ad_id);
    if (!seen || r.date > seen.date) byAd.set(r.meta_ad_id, r);
  }
  roundAds = [...byAd.values()].map((r) => ({
    key: r.meta_ad_id,
    label: r.ad_name ?? r.meta_ad_id,
    launches: [{ metaAdId: r.meta_ad_id, adSetId: r.meta_adset_id as string }],
    liveFrom: null,
  }));
}

const ledger = await loadAdSetLedger(db, adSetIds);
const index = await loadAdContextFor(db, { metaAdIds: [], metaAdsetIds: adSetIds });
const context = new Map<string, { clientId: string | null; eventId: string | null; source: string }>();
for (const id of adSetIds) {
  const sample = rows.filter((r) => r.meta_adset_id === id).sort((a, b) => b.date.localeCompare(a.date))[0];
  const resolved = sample ? resolveAdContext(sample, index) : null;
  context.set(id, {
    clientId: ledger.get(id)?.clientId ?? resolved?.clientId ?? null,
    eventId: ledger.get(id)?.eventId ?? resolved?.eventId ?? null,
    source: ledger.has(id) ? "launched_ad_sets" : (resolved?.source ?? "none"),
  });
}
const events = await loadStageEvents(db, [...new Set([...context.values()].map((c) => c.eventId).filter((id): id is string => Boolean(id)))]);
const adSets = new Map<string, JudgeAdSet>(
  adSetIds.map((id) => {
    const c = context.get(id);
    const event = c?.eventId ? (events.get(c.eventId) ?? null) : null;
    return [id, { phaseAtLaunch: ledger.get(id)?.phaseAtLaunch ?? null, event, clientId: c?.clientId ?? event?.clientId ?? null }];
  }),
);
const clientIds = [...new Set([...adSets.values()].map((s) => s.clientId).filter((id): id is string => Boolean(id)))];
const accounts = [...new Set(rows.map((r) => r.ad_account_id))];
const [currency, baselines, dataThrough] = await Promise.all([loadCurrency(db), loadClientBaselines(db, clientIds), loadDataThrough(db, accounts)]);

const result = judgeRound({ judgedOn, rows, roundAds, adSets, baselines, currency, dataThrough });

const money = (x: number | null) => (x == null ? "—" : `£${x.toFixed(2)}`);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`\n# Creative Lab judge ${apply ? "APPLY" : "DRY RUN — nothing written"}\n`);
console.log(roundId ? `round ${round?.round_no} (${roundId}), status ${round?.status}` : `ad sets: ${adSetIds.join(", ")} (no round rows; ads keyed by meta_ad_id)`);
console.log(`judged on ${judgedOn}; window ${result.windowStart} → ${result.windowEnd}; insights through ${dataThrough ?? "—"}`);
if (currency.assumed.size) console.log(`accounts with no known currency (treated as GBP): ${[...currency.assumed].join(", ")}`);
if (!roundAds.length) {
  const last = (id: string) => rows.filter((r) => r.meta_adset_id === id).reduce<string | null>((max, r) => (max && max > r.date ? max : r.date), null);
  console.log(`\nno ad delivered in the window. Last delivery: ${adSetIds.map((id) => `${id} ${last(id) ?? "never"}`).join(", ")}`);
  process.exit(0);
}

console.log(`\n## Ad sets\n`);
console.log("| Ad set | Event via | Stage | result_metric | Ads | Spend | Results |");
console.log("|---|---|---|---|---|---|---|");
for (const s of result.adSets) {
  console.log(`| ${s.adSetId} | ${context.get(s.adSetId)?.source ?? "—"} | ${s.stage} | ${s.resultMetric} | ${s.ads} | ${money(s.spendGbp)} | ${s.results} |`);
}

console.log(`\n## Verdicts\n`);
console.log("| Ad | Share | Fair | Impressions | Spend | result_metric | Results | CPR | Anchor | Verdict | Reason |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
const ordered = [...result.verdicts].sort((a, b) => b.spendShare - a.spendShare || b.impressions - a.impressions);
for (const v of ordered) console.log(verdictLine(v));

function verdictLine(v: AdVerdict): string {
  const anchor = v.anchorCpr == null ? "—" : `${money(v.anchorCpr)} ${v.anchorSource}`;
  const verdict = `${v.verdict ?? "—"}${v.confirmed ? " (confirmed)" : ""}`;
  return `| ${v.label} | ${pct(v.spendShare)} | ${pct(v.fairShare)} | ${v.impressions} | ${money(v.spendGbp)} | ${v.resultMetric ?? "—"} | ${v.results} | ${money(v.costPerResult)} | ${anchor} | ${verdict} | ${v.reason} |`;
}

if (apply && roundId) {
  if (round?.status !== "launched" && round?.status !== "judged") {
    console.error(`\nround status is ${round?.status}; only a launched round is judged`);
    process.exit(1);
  }
  for (const v of result.verdicts) {
    const { error } = await db
      .from("creative_lab_round_ads")
      .update({
        verdict: v.verdict,
        verdict_reason: v.reason,
        confirmed: v.confirmed,
        result_metric: v.resultMetric,
        verdict_spend_share: v.spendShare,
        verdict_fair_share: v.fairShare,
        verdict_cost_per_result: v.costPerResult,
        verdict_results: v.results,
        window_start: result.windowStart,
        window_end: result.windowEnd,
      })
      .eq("id", v.key);
    if (error) throw new Error(`creative_lab_round_ads ${v.key}: ${error.message}`);
  }
  const { error } = await db.from("creative_lab_rounds").update({ status: "judged", judged_at: new Date().toISOString() }).eq("id", roundId);
  if (error) throw new Error(`creative_lab_rounds: ${error.message}`);
  console.log(`\nwrote ${result.verdicts.length} verdicts; round marked judged`);
}
