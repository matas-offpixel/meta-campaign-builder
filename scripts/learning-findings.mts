/**
 * RP1 — observed tests, by hand.
 *
 *   npx tsx --env-file=.env.local scripts/learning-findings.mts --dry-run
 *   npx tsx --env-file=.env.local scripts/learning-findings.mts --dry-run --date 2026-11-23
 *   npx tsx --env-file=.env.local scripts/learning-findings.mts --dry-run --event P26-BDAY
 *   npx tsx --env-file=.env.local scripts/learning-findings.mts --apply
 *
 * --dry-run reads prod (service role, SELECTs only), reads every observed test
 * as the 04:15 UTC cron would on --date (a London day, default today) and
 * writes nothing. It prints each test's variants with spend, spend share,
 * results and cost, the show benchmark, the read day and the verdict. It runs
 * before migration 264 is applied (no stored state: every test reads as on its
 * first night). --apply runs the cron's code, writes included. Zero Meta calls
 * either way.
 */

import { createClient } from "@supabase/supabase-js";

import { runLearningFindings } from "../lib/learning/findings/load-observed-tests.ts";
import { RESULT_WORD, money, pct } from "../lib/creative-tests/words.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const date = value("--date");
const events = argv.flatMap((a, i) => (a === "--event" && argv[i + 1] ? [argv[i + 1]!] : []));
if (flag("--dry-run") === flag("--apply") || (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
  console.error("usage: scripts/learning-findings.mts --dry-run | --apply [--date YYYY-MM-DD] [--event CODE]");
  process.exit(2);
}
const dryRun = flag("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const result = await runLearningFindings({ env: { ...process.env, ENABLE_LEARNING_FINDINGS: "1" }, db, readOn: date, dryRun, eventCodes: events.length ? events : undefined });
if ("skippedReason" in result) {
  console.log(result);
  process.exit(0);
}

console.log(`# Learning findings · observed tests · ${dryRun ? "DRY RUN — nothing written" : "APPLY"}`);
console.log(`read on ${result.readOn} (08:00 London) · figures to the day before · insights restated that day: ${result.covered ? "yes" : "no"}`);
console.log(`learning_findings: ${result.findingsTable}${result.findingsTable === "missing" ? " (migration 264 not applied: every test reads with no stored state)" : ""}`);
console.log(`tests ${result.tests} · ${dryRun ? "would write" : "wrote"} ${dryRun ? result.records.filter((r) => r.row).length : result.written} · skipped: app's own test ${result.skipped.appTest}, archived client ${result.skipped.archivedClient}, finding stands ${result.skipped.findingStands}`);

for (const rec of result.records) {
  const { test, read } = rec;
  console.log(`\n## ${test.campaignName} / ${test.adsetName}`);
  console.log(`ad set ${test.adsetId} · event ${test.eventCode}${rec.eventId ? "" : " (no event row)"} · ${test.ads.length} ad${test.ads.length === 1 ? "" : "s"} · ${rec.currency}`);
  if (!read) {
    console.log(`skipped: ${rec.skipped}`);
    continue;
  }
  const word = read.result ? RESULT_WORD[read.result].one : "result";
  console.log(`first delivery ${read.firstDeliveryDay ?? "—"} · read day ${read.readDay ?? "—"}${read.hours != null ? ` (${Math.floor(read.hours)} h)` : ""} · end day ${read.endDay ?? "—"} · phase ${read.phase ?? "—"}${read.decides ? " · decides" : ""}`);
  console.log(`result: ${read.result ?? "none"} (promoted event ${read.promotedEvent ?? "—"}) · stage ${rec.row?.stage ?? "—"}`);
  console.log(`| Variant | Spend | Share | ${word[0]!.toUpperCase()}${word.slice(1)}s | Cost per ${word} | Judged |`);
  console.log("|---|---|---|---|---|---|");
  for (const v of [...read.variants].sort((a, b) => (b.share ?? 0) - (a.share ?? 0))) {
    const tag = v.adId === read.winnerId ? " (winner)" : v.adId === read.leaderId ? " (leader)" : "";
    console.log(`| ${v.label}${tag} | ${money(v.spend, rec.currency)} | ${v.share != null ? `${pct(v.share)} %` : "—"} | ${v.results} | ${v.cost != null ? money(v.cost, rec.currency) : "—"} | ${v.judged ? "yes" : "barely served"} |`);
  }
  const b = read.benchmark;
  console.log(`benchmark (main campaigns, ${read.firstDeliveryDay ?? "—"} → ${read.figuresTo}): ${b ? (b.cost != null ? `${money(b.cost, rec.currency)} per ${word} · ${money(b.spend, rec.currency)} / ${b.results}` : `none (${money(b.spend, rec.currency)}, 0 ${word}s)`) : "not read"}`);
  console.log(`verdict: ${read.state} · "${read.text}"${read.action !== "none" ? ` · TF6 ${read.action}${read.pending ? ` (pending: ${read.pending})` : ""}` : ""}${read.after.final ? " · final" : ""}`);
}

if (result.errors.length) {
  console.log(`\n## Errors`);
  for (const e of result.errors) console.log(`- ${e.adsetId}: ${e.error}`);
  process.exit(1);
}
