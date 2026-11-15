/**
 * Learning loop B — run the nightly learning refresh by hand.
 *
 *   npx tsx --env-file=.env.local scripts/learning-refresh.mts --dry-run
 *   npx tsx --env-file=.env.local scripts/learning-refresh.mts --apply
 *   npx tsx --env-file=.env.local scripts/learning-refresh.mts --dry-run \
 *     --adset-meta scripts/out/insights-objective-adsets.json
 *
 * --adset-meta (dry run only) stages from a
 * `backfill-insights-objective.mts --fetch` snapshot instead of the
 * migration 187 columns, so the meta_objective rung can be previewed
 * before 187 is applied and backfilled.
 *
 * --dry-run reads prod (service role, SELECTs only), computes every job
 * and writes nothing. It prints rows per job, the copy templates per
 * stage and scope, the tag join rate per
 * client, ad-days per stage and per stage source, spend left in
 * 'unknown', and each active client's top 5 tags by
 * shrunk index with n. --apply runs the same code as the cron, writes
 * included. Zero Meta calls either way.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { COPY_SHRINK_K, passesCopyMinimum, type CopyPerformanceRow } from "../lib/learning/copy/score.ts";
import { STAGE_SOURCES, type LoadLearningOptions, type StageSource } from "../lib/learning/joins.ts";
import { runLearningRefresh } from "../lib/learning/runner.ts";
import type { TagPerformanceRow } from "../lib/learning/tag-performance.ts";

const args = new Set(process.argv.slice(2));
const adSetMetaPath = process.argv.includes("--adset-meta") ? process.argv[process.argv.indexOf("--adset-meta") + 1] : null;
if (args.has("--dry-run") === args.has("--apply") || (adSetMetaPath !== null && !args.has("--dry-run"))) {
  console.error("usage: scripts/learning-refresh.mts --dry-run [--adset-meta <file>] | --apply");
  process.exit(2);
}
const dryRun = args.has("--dry-run");
const load: LoadLearningOptions = adSetMetaPath
  ? { adSetMeta: new Map(Object.entries(JSON.parse(readFileSync(adSetMetaPath, "utf8")))) }
  : {};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const result = await runLearningRefresh({ env: { ...process.env, ENABLE_LEARNING_REFRESH: "1" }, db, dryRun, load });
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

console.log(`\n## Where each ad-day's stage came from, and spend left in 'unknown'${adSetMetaPath ? ` (meta_objective from ${adSetMetaPath})` : ""}\n`);
console.log(`| Client | ${STAGE_SOURCES.join(" | ")} | Unknown spend £ | of total £ | Share |`);
console.log(`|---|${STAGE_SOURCES.map(() => "---|").join("")}---|---|---|`);
for (const [id] of Object.entries(result.joinRates).sort((a, b) => b[1].adDays - a[1].adDays)) {
  const s: Partial<Record<StageSource, number>> = result.stageSources[id] ?? {};
  const sp = result.spend[id] ?? { total: 0, unknown: 0 };
  console.log(
    `| ${nameOf(id)} | ${STAGE_SOURCES.map((k) => s[k] ?? 0).join(" | ")} | ${sp.unknown} | ${sp.total} | ${sp.total > 0 ? pct(sp.unknown / sp.total) : "—"} |`,
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
  console.log(`\n## Resolved verticals\n`);
  for (const client of [...result.preview.clients].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`- ${client.name}: ${client.vertical ?? "(none)"}`);
  }
  console.log(`\n## Vertical rows\n`);
  const verticalRows = new Map<string, number>();
  for (const row of scoped("vertical")) verticalRows.set(row.scope_id, (verticalRows.get(row.scope_id) ?? 0) + 1);
  if (!verticalRows.size) console.log("(none)");
  for (const [vertical, count] of [...verticalRows.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`- ${vertical}: ${count}`);
  }
  const keyOf = (row: { scope_id: string; dimension: string; value_key: string; stage: string }) =>
    `${row.dimension}|${row.value_key}|${row.stage}`;
  const music = scoped("vertical").filter((row) => row.scope_id === "music");
  const allRows = scoped("all");
  const same =
    music.length === allRows.length &&
    music.every((row) => {
      const other = allRows.find((candidate) => keyOf(candidate) === keyOf(row));
      return other != null && other.funded_ads === row.funded_ads && other.results === row.results && other.spend === row.spend;
    });
  console.log(`music rows equal all rows: ${same ? "yes" : "no"}`);
  console.log(`\n## Ticket-sale results (90 days)\n`);
  for (const client of [...result.preview.clients].sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`- ${client.name}: before ${result.ticketSalePurchases[client.id] ?? 0} → after ${result.ticketSaleResults[client.id] ?? 0} (initiate checkout ${result.ticketSaleCheckouts[client.id] ?? 0})`);
  }

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

  const copy = result.preview.copyPerformance;
  console.log(`\n## Copy templates (k=${COPY_SHRINK_K}, shrink toward 1, n = events)\n`);
  console.log("k = 2 because proven starts at 2 events, so the smallest proof weighs the same as the prior of 1. A 2-event line must be at 0.8 raw to shrink to 0.9. k = 10 was sized for ads; at 2 events it lifts a raw 0.5 to 0.92, so a two-event line could never be proven.");
  for (const stage of ["ticket_sale", "registration"] as const) {
    for (const scope of ["client", "vertical", "all"] as const) {
      const found = copy.filter((row) => row.stage === stage && row.scope === scope);
      const shown = found.filter((row) => passesCopyMinimum(row));
      const proven = found.filter((row) => row.proven);
      console.log(`${stage} ${scope}: templates ${found.length}, minimum ${shown.length}, proven ${proven.length}`);
    }
    const top = copy
      .filter((row) => row.stage === stage && row.scope === "all" && passesCopyMinimum(row) && row.index_vs_event != null)
      .sort((a, b) => a.index_vs_event! - b.index_vs_event! || b.events_n - a.events_n)
      .slice(0, 5);
    console.log(`${stage} top ${top.length}:`);
    for (const row of top) console.log(copyLine(row));
    const slotted = copy.filter((row) => row.stage === stage && row.scope === "all" && row.template_key.includes("{")).length;
    console.log(`${stage} all-scope templates with a placeholder: ${slotted}`);
  }
  const features = result.preview.copyFeatures;
  console.log(`\n## Copy features (migration 213; scope all; same maths as the templates)\n`);
  const featureAll = features.filter((row) => row.scope === "all");
  console.log(`rows: client ${features.filter((r) => r.scope === "client").length}, vertical ${features.filter((r) => r.scope === "vertical").length}, all ${featureAll.length}`);
  console.log("| feature | rows (all) | events_n ≥ 2 | minimum | proven |");
  console.log("|---|---|---|---|---|");
  for (const feature of [...new Set(featureAll.map((row) => row.feature))]) {
    const rows = featureAll.filter((row) => row.feature === feature);
    console.log(`| ${feature} | ${rows.length} | ${rows.filter((r) => r.events_n >= 2).length} | ${rows.filter((r) => passesCopyMinimum(r)).length} | ${rows.filter((r) => r.proven).length} |`);
  }
  console.log(`total: rows ${featureAll.length}, events_n ≥ 2 ${featureAll.filter((r) => r.events_n >= 2).length}, minimum ${featureAll.filter((r) => passesCopyMinimum(r)).length}, proven ${featureAll.filter((r) => r.proven).length}`);
  for (const stage of ["ticket_sale", "registration"] as const) {
    const top = featureAll
      .filter((row) => row.stage === stage && row.index_vs_event != null && passesCopyMinimum(row))
      .sort((a, b) => a.index_vs_event! - b.index_vs_event! || b.events_n - a.events_n)
      .slice(0, 5);
    console.log(`\n${stage} top ${top.length} (minimum-passing, lowest shrunk index first):`);
    for (const row of top) {
      console.log(`  ${row.feature}=${row.value} · ${row.field} · voice=${row.voice} · index=${row.index_vs_event} · shows=${row.events_n} · ads=${row.ads_n} · spend £${row.spend} · results ${row.results} · ${row.confidence}${row.proven ? " · PROVEN" : ""}`);
    }
  }

  const copyJob = result.jobs.copy_performance;
  console.log(`name-only templates dropped: ${String(copyJob.detail?.droppedNameOnly ?? "—")}`);
  const listed = copy.filter((item) => item.scope === "all" && (item.proven || passesCopyMinimum(item)));
  console.log(`\n## Proven templates and the shows behind them\n`);
  for (const row of listed.filter((item) => item.proven)) printCopyShows(row);
  console.log(`\n## Minimum-passing templates and the shows behind them\n`);
  for (const row of listed.filter((item) => !item.proven)) printCopyShows(row);
}

function printCopyShows(row: CopyPerformanceRow): void {
  console.log(`${row.stage} index=${row.index_vs_event} events=${row.events_n} voice=${row.voice} page=${row.page_id ?? "—"} proven=${row.proven}`);
  console.log(`  ${JSON.stringify(row.example_text)}`);
  for (const show of row.shows ?? []) console.log(`  ${show.code ?? "—"}  ${show.date ?? "—"}  ${show.venue ?? "—"}  ads=${show.ads}  ${show.name ?? ""}`);
}

function copyLine(row: CopyPerformanceRow): string {
  return `  index=${row.index_vs_event} events=${row.events_n} voice=${row.voice} proven=${row.proven}\n    key=${JSON.stringify(row.template_key)}\n    example=${JSON.stringify(row.example_text)}`;
}

function tagLine(t: TagPerformanceRow): string {
  return `| ${t.dimension}:${t.value_key} | ${t.funded_ads} | ${t.ads} | ${t.spend} | ${t.results} | ${t.cpr ?? "—"} | ${t.index ?? "—"} | ${t.pool_index} | ${t.shrunk_index} | ${t.confidence} |`;
}
