/**
 * scripts/sales-dashboard.mts
 *
 * Dashboard v2 (HD3) read on prod, for checking the server calc before
 * DASHBOARD_V2_ENABLED goes on. Reads only: no write of any kind, the
 * library included.
 *
 *   npx tsx --env-file=.env.local scripts/sales-dashboard.mts --client <client_id>
 *   npx tsx --env-file=.env.local scripts/sales-dashboard.mts --client <client_id> --today 2026-11-13 --dump input.json
 *
 * --today pins London "today" (spend runs to the day before).
 * --dump writes the SalesCalcInput the calc read, for a fixture.
 * --show CODE prints that show's tiles for every period.
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { loadSalesCalcInput } from "../lib/dashboard/sales-calc/load.ts";
import { buildSalesDashboard } from "../lib/dashboard/sales-calc/model.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const clientId = arg("client");
if (!clientId) {
  console.error("--client <client_id> is required");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });
const input = await loadSalesCalcInput(sb, clientId, { today: arg("today") ?? undefined });
if (!input) {
  console.error("no such client");
  process.exit(1);
}
const dump = arg("dump");
if (dump) {
  writeFileSync(dump, JSON.stringify(input, null, 1));
  console.log(`wrote ${dump}`);
}

const build = buildSalesDashboard(input);
console.log(`${input.client.name} · today ${input.today}`);
console.log(`shows ${input.shows.length} · meta campaign-days ${input.metaCampaignDays.length} · rollup days ${input.rollups.length} · google days ${input.googleCampaignDays.length} · signup days ${input.signups.length}`);
console.log(build.model.freshness.map((s) => `${s.wide}${s.stale ? " (amber)" : ""}`).join(" · "));
for (const chip of [...build.model.shows, ...build.model.finishedShows]) {
  const view = build.model.views[chip.id];
  if (!view) continue;
  const tile = (id: string) => view.tiles.find((t) => t.id === id);
  console.log(`\n${chip.wide}${chip.finished ? " (finished)" : ""}`);
  console.log(`  ${view.subtitle}`);
  console.log(`  14 days: spend ${tile("spend")?.value} (${tile("spend")?.detail}) · sold ${tile("sold")?.value} (${tile("sold")?.detail}) · tickets ${tile("tickets")?.value} · CPT ${tile("costPerTicket")?.value}`);
  console.log(`  ${view.trajectory.wideRange}`);
}
console.log("\nLibrary:");
for (const e of build.library) console.log(`  ${e.code} ${e.showDate}: D−21 ${e.d21Sold.toFixed(1)}, D−7 ${e.d7Sold.toFixed(1)}, final ${e.finalPaid} (+${e.compsExcluded} comps) on ${e.finalDay} → ×${e.lift.toFixed(2)}`);
for (const e of build.excludedFromLibrary) console.log(`  out: ${e.name} (${e.reason})`);
const show = arg("show");
if (show) {
  const periods = build.periods[show.toLowerCase()];
  for (const [period, view] of Object.entries(periods ?? {})) {
    console.log(`\n${show} · ${period}`);
    for (const t of view.tiles) console.log(`  ${t.id}: ${t.value} · ${t.detail}`);
  }
}
