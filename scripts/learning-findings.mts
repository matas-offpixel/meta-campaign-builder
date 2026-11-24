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
 * first night). Then RP2's variant pairs (each compared pair with its arms,
 * overlap days, phase and ratio, and every sibling pair "not compared: <reason>")
 * and RP3's phase curves per show (cost per stage result per phase, ratio to the
 * teaser phase, or "no phase data"), PR1c's show weeks, cross-show rollup and
 * copy rules, the Monday digest as it would be sent (built from the stored
 * findings with this run's rows over them; notify() is never called), and the
 * run's timings. --apply runs the cron's code, writes included (never the
 * digest). Zero Meta calls and no Slack post either way.
 */

import { createClient } from "@supabase/supabase-js";

import { runLearningFindings } from "../lib/learning/findings/load-observed-tests.ts";
import { loadDigestRows, runLearningDigest, type DigestRow } from "../lib/learning/findings/digest.ts";
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
  console.log(`verdict: ${read.state} · "${read.text}"${read.action !== "none" ? ` · TF6's call on an app test would be ${read.action}; nothing is written${read.pending ? ` (pending: ${read.pending})` : ""}` : ""}${read.after.final ? " · final" : ""}`);
}

const pc = result.pairsCurves;
const m = (n: number | null) => (n == null ? "—" : `£${n.toFixed(2)}`);
console.log(`\n# Variant pairs (RP2) · ${pc.pairs.length} compared · ${pc.notCompared.length} not compared`);
for (const p of pc.pairs) {
  const word = p.result === "complete_registration" ? "signup" : p.result === "initiate_checkout" ? "checkout" : "purchase";
  console.log(`\n## ${p.eventCode} · ${p.campaignName} / ${p.adsetName} · axis ${p.axis} · phase ${p.phase} · ${p.stage}`);
  console.log(`overlap ${p.overlapDays.length} days: ${p.overlapDays[0]} → ${p.overlapDays[p.overlapDays.length - 1]}`);
  for (const arm of [p.a, p.b]) console.log(`- ${arm.label} [${arm.side}] · ${m(arm.spend)} · ${arm.results} ${word}s · ${arm.cost != null ? `${m(arm.cost)} per ${word}` : `no ${word}s: cost so far ≥ ${m(arm.spend)}`}`);
  console.log(`ratio a÷b ${p.ratio ?? "—"} (${p.ratioBound ?? "none"}) · ${p.verdict} · ${p.confidence}`);
}
console.log(`\n## Not compared`);
for (const n of pc.notCompared) console.log(`- ${n.eventCode || "—"} · ${n.adsetName || n.adsetId} · ${n.axis}: "${n.a}" vs "${n.b}" · not compared: ${n.reason}`);

console.log(`\n# Phase curves (RP3) · ${pc.curves.filter((c) => c.state === "curve").length} shows with phase data · ${pc.curves.filter((c) => c.state === "no_phase_data").length} with none`);
for (const c of pc.curves.filter((x) => x.state === "curve")) {
  const b = c.boundaries;
  console.log(`\n## ${c.eventCode} · announced ${b.announcement_at ?? "—"} · presale ${b.presale_at ?? "—"} · general sale ${b.general_sale_at ?? "—"}`);
  console.log("| Phase | Stage | Result | Days | Spend | Results | Cost | × teaser | Confidence |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  if (c.state === "curve") console.log(`excluded (boundary days): ${c.excludedDays.map((x) => `${x.day} ${x.stage} ${m(x.spend)} / ${x.results}`).join(", ") || "none"} · unknown days (before the first known boundary): ${c.unknownDays.count ? `${c.unknownDays.count} (${c.unknownDays.firstDay} → ${c.unknownDays.lastDay}, ${m(c.unknownDays.spend)})` : "none"}`);
  for (const pt of c.points) console.log(`| ${pt.phase} | ${pt.stage} | ${pt.result} | ${pt.firstDay} → ${pt.lastDay} (${pt.days}) | ${m(pt.spend)} | ${pt.results} | ${m(pt.cost)} | ${pt.ratioToTeaser ?? "—"} | ${pt.confidence} |`);
}
console.log(`\nno phase data: ${pc.curves.filter((c) => c.state === "no_phase_data").map((c) => c.eventCode).join(", ") || "none"}`);
console.log(`\n# Timings\ntests ${result.timings.testsMs} ms · pairs + curves ${result.timings.pairsCurvesMs} ms (discover ${pc.timings.discoverMs}, pairs ${pc.timings.pairsMs}, curves ${pc.timings.curvesMs}) · rollup + show week + copy ${result.timings.rollupMs} ms (show week ${result.rollup.timings.showWeekMs}, rollup ${result.rollup.timings.rollupMs}, copy rules ${result.rollup.timings.copyRulesMs}) · write ${result.timings.writeMs} ms · total ${result.timings.totalMs} ms (route maxDuration 120 s)`);
console.log(`rows: test_verdict ${result.records.filter((r) => r.row).length} · variant_pair ${pc.pairRows.length} · phase_curve ${pc.curveRows.length} · show_week ${result.rollup.showWeekRows.length} · axis_rollup ${result.rollup.rollupRows.length} · copy_rule ${result.rollup.copyRuleRows.length} · ${dryRun ? "would write" : "wrote"} ${dryRun ? result.records.filter((r) => r.row).length + pc.pairRows.length + pc.curveRows.length + result.rollup.showWeekRows.length + result.rollup.rollupRows.length + result.rollup.copyRuleRows.length : result.written}`);

const ro = result.rollup;
console.log(`\n# Show week (E4) · week of ${ro.showWeekRows[0]?.week_start ?? "—"} · ${ro.showWeeks.length} shows (costs are showBenchmark's)`);
console.log("| Show | Result | This week | Last week | × | Best (≥ £12) | Worst (≥ £12) | Mover |");
console.log("|---|---|---|---|---|---|---|---|");
for (const w of ro.showWeeks) {
  const word = w.result === "complete_registration" ? "signup" : "checkout";
  const fig = (b: { spend: number; results: number; cost: number | null }) => `${m(b.spend)} · ${b.results} · ${b.cost != null ? m(b.cost) : "—"}`;
  const ad = (a: { name: string; cost: number | null; spend: number }) => `${a.name} ${a.cost != null ? m(a.cost) : `no ${word}s on ${m(a.spend)}`}`;
  console.log(`| ${w.eventCode} | ${word} | ${fig(w.thisWeek)} | ${fig(w.lastWeek)} | ${w.ratio ?? "—"} | ${w.best.map(ad).join("; ") || "—"} | ${w.worst.map(ad).join("; ") || "—"} | ${w.mover ? `${w.mover.name} ${m(w.mover.lastCost)} → ${m(w.mover.cost)} (× ${w.mover.ratio})` : "—"} |`);
}

console.log(`\n# Cross-show rollup (E3) · ${ro.rollupRows.length} rows · ${ro.rollupRows.filter((r) => r.confidence !== "thin").length} at ok or above · pooled ${ro.pooled.pooled} findings (${ro.pooled.stored} stored, ${ro.pooled.thisRun} this run) · voices ${JSON.stringify(ro.pooled.voices)}`);
console.log("| Scope | Scope id | Subject | Stage | Value | n shows | n pairs | Confidence | Verdict |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const r of ro.rollupRows) console.log(`| ${r.scope} | ${r.scope_id ?? "—"} | ${r.subject} | ${r.stage ?? "—"} | ${r.metric === "winners" ? `${r.value_a} of ${r.value_b}` : (r.value_a ?? "—")} | ${r.n_shows} | ${r.n_pairs ?? "—"} | ${r.confidence} | ${r.verdict} |`);

console.log(`\n# Copy rules (E5) · ${ro.copyRuleRows.length} rows from copy_features`);
console.log("| Scope | Subject | Stage | Value a | Value b | Shows | Confidence | Verdict |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of ro.copyRuleRows) console.log(`| ${r.scope}${r.scope_id && r.scope !== "client" ? ` ${r.scope_id}` : r.scope === "client" ? ` ${String(r.scope_id).slice(0, 8)}` : ""} | ${r.subject} | ${r.stage} | ${r.value_a ?? "—"} | ${r.value_b ?? "—"} | ${r.n_shows} | ${r.confidence} | ${r.verdict} |`);

// The digest as it would go to ads_ops: stored findings with this run's rows over them. notify() is never called.
const digestNow = new Date(`${result.readOn}T10:00:00Z`);
const stored = await loadDigestRows(db, result.readOn);
const runRows = [...result.records.map((r) => r.row).filter(Boolean), ...ro.showWeekRows, ...ro.rollupRows] as unknown as DigestRow[];
const keyOfDigest = (r: DigestRow) => [r.kind, r.scope, r.scope_id ?? "", r.stage ?? "", r.week_start ?? "", r.subject ?? ""].join("|");
const byKey = new Map(stored.map((r) => [keyOfDigest(r), r]));
for (const r of runRows) byKey.set(keyOfDigest(r), r);
const digest = await runLearningDigest({
  env: { ...process.env, ENABLE_LEARNING_DIGEST: "1" },
  db,
  now: digestNow,
  dryRun: true,
  rows: [...byKey.values()],
  notify: async () => {
    throw new Error("the dry run never posts");
  },
});
if (!("skippedReason" in digest)) {
  console.log(`\n# Digest (E8) · DRY RUN — not posted · ${digest.digestDay} · dedupe ${digest.dedupeKey} · ${JSON.stringify(digest.counts)}\n`);
  console.log("```");
  console.log(digest.text);
  console.log("```");
}

if (result.errors.length) {
  console.log(`\n## Errors`);
  for (const e of result.errors) console.log(`- ${e.adsetId}: ${e.error}`);
  process.exit(1);
}
