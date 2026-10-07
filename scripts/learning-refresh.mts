/**
 * Learning loop B — run the nightly learning refresh by hand.
 *
 *   npx tsx --env-file=.env.local scripts/learning-refresh.mts --dry-run
 *   npx tsx --env-file=.env.local scripts/learning-refresh.mts --apply
 *
 * --dry-run reads prod (service role, SELECTs only), computes every job
 * and writes nothing. It prints rows per job, the tag join rate per
 * client, ad-days per stage and per stage source, spend left in
 * 'unknown', and each active client's top 5 tags by
 * shrunk index with n. --apply runs the same code as the cron, writes
 * included. Zero Meta calls either way.
 */

import { createClient } from "@supabase/supabase-js";

import { runLearningRefresh } from "../lib/learning/runner.ts";
import type { TagPerformanceRow } from "../lib/learning/tag-performance.ts";

const args = new Set(process.argv.slice(2));
if (args.has("--dry-run") === args.has("--apply")) {
  console.error("usage: scripts/learning-refresh.mts --dry-run | --apply");
  process.exit(2);
}
const dryRun = args.has("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const result = await runLearningRefresh({ env: { ...process.env, ENABLE_LEARNING_REFRESH: "1" }, db, dryRun });
if ("skippedReason" in result) {
  console.log(result);
  process.exit(0);
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const names = new Map((result.preview?.clients ?? []).map((c) => [c.id, c.name]));
const nameOf = (id: string) => (id ? (names.get(id) ?? id) : "(no client)");

console.log(`\n# Learning refresh ${dryRun ? "DRY RUN — nothing written" : "APPLY"}\n`);
console.log(`ad-days joined to an active client: ${result.adDays}`);
console.log(`dropped: no client ${result.dropped.noClient}, archived client ${result.dropped.archived}`);
console.log(`accounts with no known currency (treated as GBP): ${result.currencyAssumed.join(", ") || "none"}`);

console.log(`\n## Jobs\n`);
for (const [name, j] of Object.entries(result.jobs)) {
  console.log(`- ${name}: ${j.ok ? "ok" : "FAILED"} · ${dryRun ? "would write" : "wrote"} ${j.rows}${j.detail ? ` · ${JSON.stringify(j.detail)}` : ""}${j.error ? ` · ${j.error}` : ""}`);
}

console.log(`\n## Tag join rate per client (tagged ad-days ÷ ad-days) and ad-days per stage\n`);
console.log("| Client | Ad-days | Tagged | Rate | by meta_ad_id | by name | registration | ticket_sale | unknown |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [id, r] of Object.entries(result.joinRates).sort((a, b) => b[1].adDays - a[1].adDays)) {
  const s = result.stages[id] ?? { registration: 0, ticket_sale: 0, unknown: 0 };
  console.log(`| ${nameOf(id)} | ${r.adDays} | ${r.tagged} | ${pct(r.rate)} | ${r.byAdId} | ${r.byName} | ${s.registration} | ${s.ticket_sale} | ${s.unknown} |`);
}

console.log(`\n## Where each ad-day's stage came from, and spend left in 'unknown'\n`);
console.log("| Client | event_dates | phase_at_launch | objective | adset_objective | unknown | Unknown spend £ | of total £ | Share |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const [id] of Object.entries(result.joinRates).sort((a, b) => b[1].adDays - a[1].adDays)) {
  const s = result.stageSources[id] ?? { event_dates: 0, phase_at_launch: 0, objective: 0, adset_objective: 0, unknown: 0 };
  const sp = result.spend[id] ?? { total: 0, unknown: 0 };
  console.log(
    `| ${nameOf(id)} | ${s.event_dates} | ${s.phase_at_launch} | ${s.objective} | ${s.adset_objective} | ${s.unknown} | ${sp.unknown} | ${sp.total} | ${sp.total > 0 ? pct(sp.unknown / sp.total) : "—"} |`,
  );
}

if (result.preview) {
  const tags = result.preview.tagPerformance;
  console.log(`\n## Top 5 tags per active client by shrunk index (lower = better), per stage\n`);
  for (const client of result.preview.clients) {
    const rows = tags.filter((t) => t.scope === "client" && t.scope_id === client.id && t.shrunk_index != null);
    if (!rows.length) continue;
    console.log(`### ${client.name} (${client.vertical})\n`);
    for (const stage of ["registration", "ticket_sale"] as const) {
      const top = rows
        .filter((t) => t.stage === stage)
        .sort((a, b) => (a.shrunk_index as number) - (b.shrunk_index as number) || b.funded_ads - a.funded_ads)
        .slice(0, 5);
      if (!top.length) continue;
      console.log(`${stage}:\n`);
      console.log("| Tag | n (funded ads) | Ads | Spend £ | Results | CPR £ | Index | Pool | Shrunk | Confidence |");
      console.log("|---|---|---|---|---|---|---|---|---|---|");
      for (const t of top) console.log(tagLine(t));
      console.log("");
    }
  }
  const scoped = (scope: string) => tags.filter((t) => t.scope === scope);
  console.log(`tag_performance rows: client ${scoped("client").length}, vertical ${scoped("vertical").length}, all ${scoped("all").length}; thin ${tags.filter((t) => t.confidence === "thin").length}, ok ${tags.filter((t) => t.confidence === "ok").length}, strong ${tags.filter((t) => t.confidence === "strong").length}`);

  console.log(`\n## Funnel benchmarks (180 days, learned)\n`);
  console.log("| Client | Stage | Rate | n (impressions) | Confidence |");
  console.log("|---|---|---|---|---|");
  for (const r of result.preview.funnel.rows) console.log(`| ${nameOf(r.client_id)} | ${r.stage} | ${r.rate} | ${r.n} | ${r.confidence} |`);
  for (const s of result.preview.funnel.skipped) console.log(`skipped: ${nameOf(s.clientId)} ${s.stage} ${s.reason}${s.value != null ? ` (${s.value})` : ""}`);

  console.log(`\n## Interest clusters, live evidence (registration stage)\n`);
  console.log("| Cluster | Ad sets | Funded | Spend £ | Regs | CPR £ | cprIndex | Clients | Confidence |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  const live = Object.values(result.preview.liveEvidence).sort((a, b) => (a.cprIndex ?? 99) - (b.cprIndex ?? 99) || b.spend - a.spend);
  for (const e of live) {
    console.log(`| ${e.name} | ${e.adSets} | ${e.fundedAdSets} | ${e.spend} | ${e.registrations} | ${e.cpr ?? "—"} | ${e.cprIndex ?? "—"} | ${e.clients.join(", ")} | ${e.confidence} |`);
  }
}

function tagLine(t: TagPerformanceRow): string {
  return `| ${t.dimension}:${t.value_key} | ${t.funded_ads} | ${t.ads} | ${t.spend} | ${t.results} | ${t.cpr ?? "—"} | ${t.index ?? "—"} | ${t.pool_index} | ${t.shrunk_index} | ${t.confidence} |`;
}
