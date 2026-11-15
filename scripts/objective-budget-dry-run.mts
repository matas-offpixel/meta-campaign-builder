// scripts/objective-budget-dry-run.mts
//
// Dashboard v2 HE6 dry run: E6's objective × channel rows and the budget
// picture for one client (and each of its shows), read through
// lib/dashboard/objective-budget/read.ts. READ-ONLY: every call is a
// Supabase SELECT; nothing is written and no platform API is called.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/objective-budget-dry-run.mts \
//     --client <clients.id> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json FILE]
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { computeObjectiveBudget } from "../lib/dashboard/objective-budget/compute.ts";
import { loadObjectiveBudgetInput } from "../lib/dashboard/objective-budget/read.ts";
import type { Figure, ObjectiveBudgetResult } from "../lib/dashboard/objective-budget/types.ts";
import { addDays, londonDay } from "../lib/dashboard/sales-calc/days.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const clientId = arg("--client");
const from = arg("--from") ?? null;
const to = arg("--to") ?? addDays(londonDay(new Date()), -1);
const jsonOut = arg("--json");
if (!clientId || (from && !DAY.test(from)) || !DAY.test(to)) {
  throw new Error("Usage: --client <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--json FILE]");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const db = createClient(url, key, { auth: { persistSession: false } });

const money = (n: number | null) => (n == null ? "—" : `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const count = (n: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("en-GB"));
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
const f = (x: Figure, fmt: (n: number | null) => string) => fmt(x.value);

function print(r: ObjectiveBudgetResult) {
  console.log(`\n=== ${r.scope.label} · ${r.period.from ?? "launch"} → ${r.period.to}`);
  console.log(`D12 paid in period: ${money(r.paidInPeriod.all)} (Meta ${money(r.paidInPeriod.meta)} · TikTok ${money(r.paidInPeriod.tiktok)} · Google ${money(r.paidInPeriod.google)})`);
  console.log(["Objective", "Channel", "Spend", "Share", "Impr.", "Reach", "Clicks", "LPV", "Result", "Cost/result", "ROAS"].join("\t"));
  for (const row of r.rows) {
    console.log(
      [
        row.label,
        row.channel,
        f(row.spend, money),
        f(row.shareOfSpend, pct),
        f(row.impressions, count),
        f(row.reach, count),
        f(row.clicks, count),
        f(row.landingPageViews, count),
        row.resultMetric ? `${count(row.result.value)} ${row.resultMetric}` : "—",
        row.costLabel ? `${f(row.costPerResult, money)} ${row.costLabel.replace("£ ", "")}` : "—",
        row.roas ? (row.roas.value == null ? "—" : `${row.roas.value.toFixed(2)}x`) : "",
      ].join("\t"),
    );
  }
  const c = r.metaClassification;
  console.log(
    `Meta ad-days by goal ${c.byGoal.adDays} (${money(c.byGoal.spend)}) · goal NULL ${c.goalMissing.adDays} (${money(c.goalMissing.spend)}, by campaign objective ${JSON.stringify(c.goalMissing.byObjective)}) · goal maps to none ${c.unmapped.adDays} (${money(c.unmapped.spend)}${c.unmapped.what.length ? `: ${c.unmapped.what.join(", ")}` : ""})`,
  );
  if (r.brand.eventIds.length) console.log(`Brand campaigns in period: ${money(r.brand.paidInPeriod.all)}`);
  const b = r.budget;
  const line = (name: string, x: Figure) => console.log(`  ${name.padEnd(18)} ${money(x.value).padStart(14)}   ${x.source}`);
  console.log("Budget (since launch):");
  line("Plan", b.plan);
  line("  budget_marketing", b.planParts.budgetMarketing);
  line("  additional", b.planParts.additionalSpend);
  line("  season", b.planParts.seasonBudget);
  line("Paid", b.paid);
  line("  shows", b.paidShows);
  line("  brand", b.paidBrand);
  line("Credits", b.credits);
  line("Variance", b.variance);
  line("Sub-budgets", b.subBudgets);
  line("D2C", b.d2c);
  line("  WhatsApp", b.d2cParts.whatsapp);
  line("  SMS", b.d2cParts.sms);
  line("Total marketing", b.totalMarketing);
  line("  credits kept", b.totalMarketingCreditsNotSubtracted);
}

const input = await loadObjectiveBudgetInput(db, clientId);
if (!input) throw new Error("client not found or archived");
console.log(`${input.client.name}: ${input.events.length} scope events, ${input.metaAdDays.length} Meta ad-days read, ${input.googleDays.length} Google campaign-days, ${input.rollups.length} rollup rows, entries ${input.entries == null ? "table missing (250 not applied)" : input.entries.length}, D2C rows ${input.d2c.rows.length}, Bird rate ${input.d2c.rate.rate ?? "not set"}`);

const results: ObjectiveBudgetResult[] = [computeObjectiveBudget(input, { kind: "client" }, { from, to })];
for (const e of input.events) results.push(computeObjectiveBudget(input, { kind: "show", eventId: e.eventId }, { from, to }));
for (const r of results) print(r);

if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(results, null, 2));
  console.log(`\nwrote ${jsonOut}`);
}
