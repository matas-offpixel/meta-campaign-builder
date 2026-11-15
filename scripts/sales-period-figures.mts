/**
 * scripts/sales-period-figures.mts
 *
 * Every period figure for one dashboard v2 view, for checking the period
 * calc (Sales, its "a day", Pace, Cost per ticket). Reads only.
 *
 *   npx tsx scripts/sales-period-figures.mts --input input.json --view "venue:nx newcastle"
 *   npx tsx --env-file=.env.local scripts/sales-period-figures.mts --client <client_id> --today 2026-11-14 --view "venue:nx newcastle"
 *
 * --input is a SalesCalcInput dumped by scripts/sales-dashboard.mts --dump.
 */

import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { loadSalesCalcInput } from "../lib/dashboard/sales-calc/load.ts";
import { buildSalesDashboard } from "../lib/dashboard/sales-calc/model.ts";
import type { SalesCalcInput } from "../lib/dashboard/sales-calc/types.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const view = arg("view") ?? "all";
let input: SalesCalcInput | null;
const file = arg("input");
if (file) {
  input = JSON.parse(readFileSync(file, "utf8")) as SalesCalcInput;
} else {
  const clientId = arg("client");
  if (!clientId) throw new Error("--input <file> or --client <client_id>");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  input = await loadSalesCalcInput(sb, clientId, { today: arg("today") ?? undefined });
}
if (!input) throw new Error("no such client");

const build = buildSalesDashboard(input);
const v = build.model.views[view];
if (!v) throw new Error(`no view ${view}`);
const t = v.trajectory;
const pace = t.kind === "all" || t.kind === "single" ? t.summary?.pace : undefined;
console.log(`${view} · spend to ${v.endDay} · counts to ${v.countDay ?? "—"}`);
if (pace) console.log(`Pace: ${pace.value} · ${pace.detail}`);
for (const period of ["30", "14", "7", "3", "yesterday"] as const) {
  const tiles = v.periods?.[period]?.tiles ?? [];
  const tile = (id: string) => tiles.find((x) => x.id === id);
  const line = (id: string) => `${tile(id)?.value ?? "—"} (${tile(id)?.detail ?? ""})`;
  console.log(`\n${period}`);
  console.log(`  Spend          ${line("spend")}`);
  console.log(`  Sales          ${line("tickets")}`);
  console.log(`  Cost / ticket  ${line("costPerTicket")}`);
  console.log(`  hover          ${tile("costPerTicket")?.title ?? ""}`);
}
