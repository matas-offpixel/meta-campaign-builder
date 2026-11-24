/**
 * Dry run for the unlinked tickets leg (PR0 of ticket truth). Reads only.
 *
 *   npx tsx --env-file=.env.local scripts/rollup-tickets-unlinked-dry-run.mts
 *   npx tsx --env-file=.env.local scripts/rollup-tickets-unlinked-dry-run.mts --event NX26-SCHAK --days
 *
 * For every event that has ticket_sales_snapshots and no ticketing link, it
 * builds the rows the rollup-sync tickets leg would now write
 * (`planUnlinkedTicketRows`, the same builder and collapse the linked path
 * uses) and compares them with what `event_daily_rollups.tickets_sold` holds
 * today. It prints, per event: whether the cron would reach it (the cron's own
 * eligibility read), the days that gain or change a row, and the tickets
 * summed before and after. Archived clients are listed as skipped. `--days`
 * prints each changed day. Timings of the reads the leg adds are printed last.
 *
 * This script never writes: it has no insert, upsert, update, delete or rpc
 * call (a test greps for them). Every SELECT pages with .range().
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadRollupSyncCronEligibility } from "../lib/dashboard/cron-eligibility.ts";
import { planUnlinkedTicketRows } from "../lib/dashboard/unlinked-tickets-rollup-leg.ts";
import type { SnapshotForRollupTickets } from "../lib/ticketing/rollup-tickets-from-snapshots.ts";

const argv = process.argv.slice(2);
const onlyEvent = argv.includes("--event") ? argv[argv.indexOf("--event") + 1] : undefined;
const showDays = argv.includes("--days");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

const PAGE = 1000;

async function pageAll<T>(
  label: string,
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

type EventRow = { id: string; event_code: string | null; client_id: string | null; event_date: string | null };
type SnapRow = SnapshotForRollupTickets & { id: string; event_id: string };

async function main() {
  const t0 = Date.now();
  const [events, links, archived, snaps, eligibility] = await Promise.all([
    pageAll<EventRow>("events", (f, t) =>
      sb.from("events").select("id,event_code,client_id,event_date").order("id").range(f, t),
    ),
    pageAll<{ id: string; event_id: string }>("event_ticketing_links", (f, t) =>
      sb.from("event_ticketing_links").select("id,event_id").order("id").range(f, t),
    ),
    pageAll<{ id: string }>("clients", (f, t) =>
      sb.from("clients").select("id").eq("status", "archived").order("id").range(f, t),
    ),
    pageAll<SnapRow>("ticket_sales_snapshots", (f, t) =>
      sb
        .from("ticket_sales_snapshots")
        .select("id,event_id,snapshot_at,tickets_sold,source,gross_revenue_cents,external_event_id,connection_id")
        .order("id")
        .range(f, t),
    ),
    loadRollupSyncCronEligibility(sb),
  ]);
  const loadMs = Date.now() - t0;

  const linked = new Set(links.map((l) => l.event_id));
  const archivedIds = new Set(archived.map((c) => c.id));
  const cronIds = new Set(eligibility.eligibleIds);
  const byEvent = new Map<string, SnapRow[]>();
  const seen = new Set<string>();
  for (const s of snaps) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const list = byEvent.get(s.event_id) ?? [];
    list.push(s);
    byEvent.set(s.event_id, list);
  }

  const rows: Array<Record<string, string | number>> = [];
  const skipped: string[] = [];
  const perEventMs: number[] = [];
  let unlinkedWithSnapshots = 0;

  for (const ev of events) {
    const evSnaps = byEvent.get(ev.id);
    if (!evSnaps || linked.has(ev.id)) continue;
    if (onlyEvent && ev.event_code !== onlyEvent) continue;
    unlinkedWithSnapshots += 1;
    const code = ev.event_code ?? ev.id;
    if (ev.client_id && archivedIds.has(ev.client_id)) {
      skipped.push(`${code} (archived client)`);
      continue;
    }
    // The reads the leg adds per event: its snapshots, then the upsert's read of existing rows.
    const te = Date.now();
    const legSnaps = await pageAll<SnapRow>(`snapshots ${code}`, (f, t) =>
      sb
        .from("ticket_sales_snapshots")
        .select("id,event_id,snapshot_at,tickets_sold,source,gross_revenue_cents,external_event_id,connection_id")
        .eq("event_id", ev.id)
        .order("snapshot_at", { ascending: true })
        .order("id", { ascending: true })
        .range(f, t),
    );
    const plan = planUnlinkedTicketRows(legSnaps);
    const existing = await pageAll<{ date: string; tickets_sold: number | null }>(`rollups ${code}`, (f, t) =>
      sb
        .from("event_daily_rollups")
        .select("date,tickets_sold")
        .eq("event_id", ev.id)
        .order("date")
        .range(f, t),
    );
    perEventMs.push(Date.now() - te);

    const before = new Map(existing.map((r) => [r.date, Number(r.tickets_sold ?? 0)]));
    const beforeSum = [...before.values()].reduce((a, b) => a + b, 0);
    const after = new Map(before);
    for (const r of plan) after.set(r.date, r.tickets_sold);
    const afterSum = [...after.values()].reduce((a, b) => a + b, 0);
    const changed = plan.filter((r) => before.get(r.date) !== r.tickets_sold);
    const newDays = plan.filter((r) => !before.has(r.date)).length;
    const statuses = [...new Set(legSnaps.map((s) => s.source))].join("+");
    rows.push({
      event: code,
      show: ev.event_date ?? "",
      cron: cronIds.has(ev.id) ? "yes" : "no",
      sources: statuses,
      snapshots: legSnaps.length,
      days: plan.length,
      changed: changed.length,
      newRows: newDays,
      first: plan[0]?.date ?? "",
      last: plan[plan.length - 1]?.date ?? "",
      before: beforeSum,
      after: afterSum,
    });
    if (showDays) {
      for (const r of changed) {
        console.log(`  ${code} ${r.date} ${before.has(r.date) ? before.get(r.date) : "(no row)"} → ${r.tickets_sold}`);
      }
    }
  }

  rows.sort((a, b) => String(a.event).localeCompare(String(b.event)));
  const cols = ["event", "show", "cron", "sources", "snapshots", "days", "changed", "newRows", "first", "last", "before", "after"];
  console.log(`| ${cols.join(" | ")} |`);
  console.log(`|${cols.map(() => "---").join("|")}|`);
  for (const r of rows) console.log(`| ${cols.map((c) => r[c]).join(" | ")} |`);

  const gaining = rows.filter((r) => Number(r.changed) > 0);
  const sum = (list: typeof rows, k: string) => list.reduce((n, r) => n + Number(r[k]), 0);
  const cronGaining = gaining.filter((r) => r.cron === "yes");
  console.log("");
  console.log(`unlinked events with snapshots: ${unlinkedWithSnapshots}; archived skipped: ${skipped.length}${skipped.length ? ` (${skipped.join(", ")})` : ""}`);
  console.log(`events gaining rows: ${gaining.length} (cron-eligible today: ${cronGaining.length}); days changed: ${sum(gaining, "changed")}`);
  console.log(`tickets before: ${sum(rows, "before")}; after: ${sum(rows, "after")}; cron-eligible after: ${sum(cronGaining, "after")}`);
  const cronMs = rows
    .map((r, i) => ({ r, ms: perEventMs[i] ?? 0 }))
    .filter(({ r }) => r.cron === "yes")
    .reduce((n, { ms }) => n + ms, 0);
  const max = perEventMs.length ? Math.max(...perEventMs) : 0;
  const avg = perEventMs.length ? Math.round(perEventMs.reduce((a, b) => a + b, 0) / perEventMs.length) : 0;
  console.log(
    `timing: initial load ${loadMs} ms; per-event leg reads avg ${avg} ms, max ${max} ms; cron-eligible events total ${cronMs} ms (reads only; the real leg adds one upsert per event that changes)`,
  );
  console.log(`cron eligibility today: ${eligibility.eligibleIds.length} events`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
