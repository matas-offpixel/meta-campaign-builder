/**
 * Signups into Meta (SU1, SU2), per event. The only way a show is turned on.
 *
 *   npx tsx --env-file=.env.local scripts/customer-list-sync.mts --event NX27-GLITTERBOX               # dry run (default)
 *   npx tsx --env-file=.env.local scripts/customer-list-sync.mts --event NX27-GLITTERBOX --enable      # write its customer_list_syncs rows
 *   npx tsx --env-file=.env.local scripts/customer-list-sync.mts --event NX27-GLITTERBOX --run         # one sync now
 *
 * --dry-run  (default) Reads only: the event, its venue, its audience
 *            template, CIRQLIN's hashed endpoint, and Meta GETs (the account's
 *            listing, each list). Prints, per list, what it would create or
 *            add/remove, with counts. Writes nothing anywhere. If the show
 *            isn't active yet, it is judged as of its trigger (presale day
 *            08:00 London), and the table says so.
 * --enable   Writes (or re-enables) the event's rows: the show list, and each
 *            genre list held in the event's account. Cursors and totals on
 *            rows already there are kept. No Meta write.
 * --run      One sync now for the event's enabled rows, as the cron would,
 *            whatever the hour. Needs OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED
 *            exactly "true", else it runs as a dry run and says so.
 *
 * Options: --template NAME (the client's template to use, when the event
 * code isn't in a template's shows), --high-value NAME (the venue's
 * high-value list by name; "" for none), --audience ID (adopt a hand-made
 * show list, checked with a GET), --at ISO (judge as of this time),
 * --json FILE (the dry run's rows as JSON, counts only).
 *
 * Never prints a hash, an email or a phone: counts, list ids and reasons.
 */

import { writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { cirqlinHashedReader } from "../lib/customer-lists/cirqlin-hashed.ts";
import { enableRowPayload, planEnable, type EnablePlan } from "../lib/customer-lists/enable.ts";
import { liveCustomerListGraph, readOnlyGraph } from "../lib/customer-lists/graph-live.ts";
import { customerListWritesEnabled, normaliseAccount, syncState } from "../lib/customer-lists/rules.ts";
import { EVENT_COLS, runCustomerListSync, workForRows, type Db, type EventRow, type SyncResult, type SyncRow } from "../lib/customer-lists/sync.ts";
import { venueAccountOf } from "../lib/customer-lists/venue.ts";
import type { ReplicateDb } from "../lib/replicate/load.ts";

type Args = { events: string[]; mode: "dry" | "enable" | "run"; template: string | null; highValue: string | null | undefined; audience: string | null; at: string | null; json: string | null };

function parseArgs(argv: string[]): Args {
  const a: Args = { events: [], mode: "dry", template: null, highValue: undefined, audience: null, at: null, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    const v = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${k} needs a value`);
      i += 1;
      return next;
    };
    if (k === "--event") a.events.push(v().trim());
    else if (k === "--enable") a.mode = "enable";
    else if (k === "--run") a.mode = "run";
    else if (k === "--dry-run") a.mode = "dry";
    else if (k === "--template") a.template = v();
    else if (k === "--high-value") a.highValue = v();
    else if (k === "--audience") a.audience = v().trim();
    else if (k === "--at") a.at = v();
    else if (k === "--json") a.json = v();
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.events.length) throw new Error("--event CODE is required");
  if (a.mode !== "dry" && a.events.length !== 1) throw new Error("--enable and --run take one --event");
  return a;
}

const args = parseArgs(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const token = process.env.META_ACCESS_TOKEN;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (!token) throw new Error("META_ACCESS_TOKEN is required (Meta GETs)");
const supabase = createClient(url, key, { auth: { persistSession: false } });
// Cast once: checking the client structurally against Db / ReplicateDb at each call is too deep for tsc.
const db = supabase as unknown as Db;
const venueDb = supabase as unknown as ReplicateDb;
const live = liveCustomerListGraph(token);
const base = args.mode === "run" ? live : readOnlyGraph(live);
// One listing per account per run: the show list and the high-value list are both found by name in it.
const listings = new Map<string, ReturnType<typeof base.listAudiences>>();
const graph: typeof base = {
  ...base,
  listAudiences: (account) => {
    let hit = listings.get(account);
    if (!hit) {
      hit = base.listAudiences(account);
      listings.set(account, hit);
    }
    return hit;
  },
};
const readHashed = cirqlinHashedReader();

async function loadEvent(code: string): Promise<EventRow & { client_status: string | null }> {
  const res = await db.from("events").select(EVENT_COLS).eq("event_code", code).maybeSingle();
  if (res.error) throw new Error(`events: ${res.error.message}`);
  if (!res.data) throw new Error(`no event ${code}`);
  const e = res.data as unknown as EventRow;
  let client_status: string | null = null;
  if (e.client_id) {
    const c = await db.from("clients").select("status").eq("id", e.client_id).maybeSingle();
    client_status = (c.data as { status?: string } | null)?.status ?? null;
  }
  return { ...e, client_status };
}

/** The event's rows; none when 267 isn't applied yet (dry run on prod before ops applies it). */
async function existingRows(eventId: string): Promise<{ rows: SyncRow[]; tableMissing: boolean }> {
  const res = await db.from("customer_list_syncs").select("*").eq("event_id", eventId).range(0, 999);
  if (res.error) {
    if (res.error.code === "PGRST205" || res.error.code === "42P01") return { rows: [], tableMissing: true };
    throw new Error(`customer_list_syncs: ${res.error.message}`);
  }
  return { rows: (res.data ?? []) as SyncRow[], tableMissing: false };
}

function fmt(n: number): string {
  return n.toLocaleString("en-GB");
}

const out: { plan: EnablePlan; result: SyncResult | null; asOf: string; stateNow: string; tableMissing: boolean }[] = [];

for (const code of args.events) {
  const event = await loadEvent(code);
  const venueAccount = await venueAccountOf(venueDb, event);
  const { rows: existing, tableMissing } = await existingRows(event.id);
  const plan = await planEnable({
    db,
    graph,
    event: { id: event.id, event_code: code, client_id: event.client_id, meta_ad_account_id: event.meta_ad_account_id },
    venueAccount,
    templateName: args.template,
    highValueName: args.highValue,
    showAudienceId: args.audience,
    existing,
  });

  if (args.mode === "enable") {
    if (tableMissing) throw new Error("customer_list_syncs is missing: apply migration 267 first");
    if (!plan.account.chosen) throw new Error(`${code}: no ad account (event or venue)`);
    for (const row of plan.rows) {
      const payload = enableRowPayload(row);
      const prior = existing.find((r) => r.kind === row.kind && (r.meta_audience_id ?? null) === (row.meta_audience_id ?? null))
        ?? (row.kind === "show" ? existing.find((r) => r.kind === "show" && !r.meta_audience_id) : undefined);
      const res = prior
        ? await db.from("customer_list_syncs").update(payload).eq("id", prior.id!)
        : await db.from("customer_list_syncs").insert(payload);
      if (res.error) throw new Error(`customer_list_syncs ${row.kind}: ${res.error.message}`);
      console.log(`${prior ? "enabled" : "added"}  ${code}  ${row.kind}  ${row.list_name ?? "-"}  ${row.meta_audience_id ?? "(made on the trigger)"}  ${row.ad_account_id}`);
    }
    continue;
  }

  const stateNow = syncState(event, new Date());
  const asOf = args.at ? new Date(args.at) : stateNow.state === "waiting" ? stateNow.triggerAt : new Date();
  let rows = plan.rows;
  if (args.mode === "run") {
    const enabled = existing.filter((r) => r.enabled);
    if (!enabled.length) throw new Error(`${code}: no enabled rows (run --enable first)`);
    rows = enabled;
  }
  const work = await workForRows(db, rows, (e) => venueAccountOf(venueDb, e), [code]);
  const result = await runCustomerListSync(
    { db, graph, readHashed, env: process.env, now: args.mode === "run" ? new Date() : asOf, mode: args.mode === "run" ? "write" : "dry", log: () => {} },
    work,
  );
  out.push({ plan, result, asOf: asOf.toISOString(), stateNow: stateNow.state, tableMissing });
}

if (args.mode !== "enable") {
  const lines: string[] = [];
  lines.push(`Signups into Meta, ${args.mode === "run" ? (out[0]?.result?.writesOff ? "RUN asked, kill switch off: ran as a dry run" : "run") : "dry run (reads only)"} · ${new Date().toISOString()}`);
  lines.push(`Kill switch OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: ${customerListWritesEnabled(process.env) ? "on" : "off"}`);
  lines.push("");
  lines.push("| Event | events.meta_ad_account_id | Venue fallback | Account used | Template | List | Kind | Meta id | Held in | Action | Adds | Removes | Note |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { plan, result, asOf, stateNow } of out) {
    const acct = plan.account;
    const head = `${plan.eventCode} | ${acct.eventAccount ?? "null"} | ${acct.venueAccount ?? "none (no venue row)"} | ${acct.chosen ?? "none"} (${acct.source}) | ${plan.template?.name ?? plan.templateNote ?? "-"}`;
    for (const r of result?.rows ?? []) {
      const counts = r.counts ? `CIRQLIN: ${fmt(r.counts.consented_show)} show / ${fmt(r.counts.consented_promoter)} promoter / ${fmt(r.counts.not_consented)} not consented` : "";
      const note = [stateNow !== "active" ? `now ${stateNow}; judged as of ${asOf}` : "", counts, r.removedNotSent ? `${fmt(r.removedNotSent)} removes not sent (genre lists are adds only)` : "", r.error ?? ""].filter(Boolean).join("; ");
      const heldIn = r.kind === "genre" ? (plan.genre.find((g) => g.metaAudienceId === r.listId)?.heldIn ?? "-") : r.listId ? r.account : "-";
      lines.push(`| ${head} | ${r.listName ?? "-"} | ${r.kind} | ${r.listId ?? "(to be made)"} | ${heldIn} | ${r.outcome} | ${fmt(r.added)} | ${fmt(r.removed)} | ${note} |`);
    }
    for (const g of plan.genre.filter((x) => x.skipped)) {
      lines.push(`| ${head} | ${g.name} | genre | ${g.metaAudienceId ?? "-"} | ${g.heldIn ?? "-"} | skipped: ${g.skipped} | 0 | 0 | ${g.source} |`);
    }
    if (!plan.template) lines.push(`| ${head} | (template lists) | genre | - | - | no template: 0 lists | 0 | 0 | ${plan.templateNote ?? ""} |`);
  }
  lines.push("");
  const reads = out.reduce((s, o) => s + (o.result?.cirqlinReads ?? 0), 0);
  lines.push(`Meta: ${live.reads()} GETs, ${live.writes()} writes. CIRQLIN: ${reads} reads asked for (a read without CIRQLIN_PARTNER_READ_SECRET makes no request).`);
  if (out.some((o) => o.tableMissing)) lines.push("customer_list_syncs isn't on this database yet (migration 267 unapplied): planned rows only.");
  console.log(lines.join("\n"));
  if (args.json) {
    writeFileSync(args.json, JSON.stringify(out.map((o) => ({ ...o, plan: { ...o.plan, rows: o.plan.rows.map((r) => ({ kind: r.kind, list: r.meta_audience_id, account: normaliseAccount(r.ad_account_id), name: r.list_name })) } })), null, 2));
  }
}
