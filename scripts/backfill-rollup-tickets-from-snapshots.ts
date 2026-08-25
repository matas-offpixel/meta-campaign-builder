/**
 * One-shot / operator backfill: write event_daily_rollups.tickets_sold
 * from ticket_sales_snapshots through buildRollupTicketDeltasFromSnapshots.
 * Same collapse as the cron. Default window: 2026-07-01 → today.
 *
 *   npx tsx scripts/backfill-rollup-tickets-from-snapshots.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

import type { Database } from "../lib/db/database.types";
import {
  buildRollupTicketDeltasFromSnapshots,
  filterRollupTicketDeltasFrom,
} from "../lib/ticketing/rollup-tickets-from-snapshots.ts";

const FROM_DATE = process.env.ROLLUP_TICKETS_BACKFILL_FROM ?? "2026-07-01";
const NAMED = [
  { event_code: "WC26-BRIGHTON", name: "England - Last 32" },
  { event_code: "WC26-LONDON-KENTISH", name: "England - Last 32" },
  { event_code: "4TF26-PALACE-FINAL", name: "Crystal Palace Conference League Final FanPark — Steel Yard London" },
];

function loadEnvLocal(): void {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq);
    let val = trimmed.slice(eq + 1);
    if (
      (val.startsWith("\"") && val.endsWith("\"")) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

async function sumRollupTickets(
  sb: ReturnType<typeof createClient<Database>>,
  eventId: string,
  fromDate: string,
): Promise<number> {
  const { data, error } = await sb
    .from("event_daily_rollups")
    .select("tickets_sold")
    .eq("event_id", eventId)
    .gte("date", fromDate);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ tickets_sold: number | null }>;
  return rows.reduce((sum, row) => sum + Number(row.tickets_sold ?? 0), 0);
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  }
  const sb = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  const { data: events, error: evErr } = await sb
    .from("events")
    .select("id, user_id, name, event_code");
  if (evErr) throw new Error(evErr.message);

  const beforeNamed: Record<string, number> = {};
  for (const want of NAMED) {
    const ev = (events ?? []).find(
      (e) => e.event_code === want.event_code && e.name === want.name,
    );
    if (!ev) continue;
    beforeNamed[`${want.event_code} | ${want.name}`] = await sumRollupTickets(
      sb,
      ev.id,
      FROM_DATE,
    );
  }

  let eventsWritten = 0;
  let rowsWritten = 0;

  for (const ev of events ?? []) {
    const snaps: Array<{
      snapshot_at: string;
      tickets_sold: number;
      source: string;
      gross_revenue_cents: number | null;
      external_event_id: string | null;
      connection_id: string | null;
    }> = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb
        .from("ticket_sales_snapshots")
        .select(
          "snapshot_at, tickets_sold, source, gross_revenue_cents, external_event_id, connection_id",
        )
        .eq("event_id", ev.id)
        .order("snapshot_at", { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      const page = data ?? [];
      snaps.push(...page);
      if (page.length < 1000) break;
    }
    if (snaps.length === 0) continue;

    const rows = filterRollupTicketDeltasFrom(
      buildRollupTicketDeltasFromSnapshots(snaps),
      FROM_DATE,
    );
    if (rows.length === 0) continue;

    const now = new Date().toISOString();
    const payload = rows.map((r) => ({
      user_id: ev.user_id,
      event_id: ev.id,
      date: r.date,
      tickets_sold: r.tickets_sold,
      revenue: r.revenue,
      source_eventbrite_at: now,
    }));

    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error } = await sb
        .from("event_daily_rollups")
        .upsert(chunk, { onConflict: "event_id,date" });
      if (error) throw new Error(`${ev.id} upsert: ${error.message}`);
    }
    eventsWritten += 1;
    rowsWritten += payload.length;
    console.log(
      `[backfill] event=${ev.event_code ?? ev.id} name=${JSON.stringify(ev.name)} rows=${payload.length} july_plus_tickets=${payload.reduce((s, r) => s + r.tickets_sold, 0)}`,
    );
  }

  console.log(`[backfill] done events=${eventsWritten} rows=${rowsWritten} from=${FROM_DATE}`);
  console.log("[backfill] named before/after:");
  for (const want of NAMED) {
    const ev = (events ?? []).find(
      (e) => e.event_code === want.event_code && e.name === want.name,
    );
    if (!ev) {
      console.log(`  MISSING ${want.event_code} | ${want.name}`);
      continue;
    }
    const key = `${want.event_code} | ${want.name}`;
    const after = await sumRollupTickets(sb, ev.id, FROM_DATE);
    console.log(`  ${key}: before=${beforeNamed[key] ?? "?"} after=${after}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
