/**
 * Signups into Meta (SU1), per event. The only way a show is turned on.
 *
 *   npx tsx --env-file=.env.local scripts/customer-list-sync.mts --event NX27-GLITTERBOX               # dry run (default)
 *   npx tsx --env-file=.env.local scripts/customer-list-sync.mts --event NX27-GLITTERBOX --enable      # write its customer_list_syncs row
 *   npx tsx --env-file=.env.local scripts/customer-list-sync.mts --event NX27-GLITTERBOX --run         # one sync now
 *
 * --dry-run  (default) Reads only: the event, its venue, CIRQLIN's hashed
 *            endpoint (scope=show, CIRQLIN_PARTNER_HASHES_SECRET), Meta GETs
 *            (the account's listing, the list) and the client's audience
 *            templates. Prints the list it would make or send to, the pages
 *            read, CIRQLIN's counts, the adds / removes / replace, and the
 *            template items it would add. Writes nothing anywhere. If the
 *            show isn't active yet, it is judged as of its trigger (presale
 *            day 08:00 London), and the table says so.
 * --enable   Writes (or re-enables) the event's show row. Cursor and totals on
 *            a row already there are kept. No Meta write.
 * --run      One sync now for the event's enabled row, as the cron would,
 *            whatever the hour. Needs OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED
 *            exactly "true", else it runs as a dry run and says so.
 *
 * Options: --audience ID (adopt a hand-made show list, checked with a GET),
 * --at ISO (judge as of this time), --proposed FILE (templates #1363 proposes,
 * a JSON array of { name, notes, client_id }, matched as well as the table's
 * and labelled "proposed"; dry run only), --json FILE (the rows, counts only).
 *
 * Only the show's own list is ever written. Never prints a hash, an email, a
 * phone or the bearer: counts, list ids and reasons.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { cirqlinHashedReader } from "../lib/customer-lists/cirqlin-hashed.ts";
import { enableRowPayload, planEnable, type EnablePlan } from "../lib/customer-lists/enable.ts";
import { addShowListToTemplates, type TemplateAction, type TemplateRow } from "../lib/customer-lists/templates.ts";
import { liveCustomerListGraph, readOnlyGraph } from "../lib/customer-lists/graph-live.ts";
import { customerListWritesEnabled, londonDate, londonWeekday, normaliseAccount, syncState } from "../lib/customer-lists/rules.ts";
import { EVENT_COLS, runCustomerListSync, workForRows, type Db, type EventRow, type SyncResult, type SyncRow } from "../lib/customer-lists/sync.ts";
import { venueAccountOf } from "../lib/customer-lists/venue.ts";
import type { ReplicateDb } from "../lib/replicate/load.ts";

type Args = { events: string[]; mode: "dry" | "enable" | "run"; audience: string | null; at: string | null; json: string | null; proposed: string | null };

function parseArgs(argv: string[]): Args {
  const a: Args = { events: [], mode: "dry", audience: null, at: null, json: null, proposed: null };
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
    else if (k === "--proposed") a.proposed = v();
    else if (k === "--audience") a.audience = v().trim();
    else if (k === "--at") a.at = v();
    else if (k === "--json") a.json = v();
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.events.length) throw new Error("--event CODE is required");
  if (a.mode !== "dry" && a.events.length !== 1) throw new Error("--enable and --run take one --event");
  if (a.mode !== "dry" && a.proposed) throw new Error("--proposed is for the dry run only");
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
// One listing per account per run (the show list is found by name in it).
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

const proposed: (TemplateRow & { client_id: string | null })[] = args.proposed
  ? (JSON.parse(readFileSync(args.proposed, "utf8")) as { name: string; notes: string; client_id: string | null }[]).map((t, i) => ({
      id: `proposed-${i + 1}`,
      user_id: null,
      name: t.name,
      notes: t.notes,
      client_id: t.client_id,
      proposed: true,
    }))
  : [];

async function templatesFor(clientId: string | null): Promise<TemplateRow[] | undefined> {
  if (!proposed.length) return undefined; // the sync reads the table itself
  const res = await db.from("audience_templates").select("id, user_id, name, notes, client_id").eq("client_id", clientId ?? "").range(0, 999);
  const onTable = res.error ? [] : ((res.data ?? []) as TemplateRow[]);
  return [...onTable, ...proposed.filter((p) => p.client_id === clientId && !onTable.some((t) => t.name === p.name))];
}

/** The next Monday 08:00 London on or after a day (the first weekly replace). */
function firstReplaceDay(after: Date): string {
  const d = new Date(after.getTime() + 24 * 60 * 60 * 1000);
  while (londonWeekday(d) !== 1) d.setTime(d.getTime() + 24 * 60 * 60 * 1000);
  return londonDate(d);
}

const out: {
  plan: EnablePlan;
  result: SyncResult | null;
  asOf: string;
  stateNow: string;
  tableMissing: boolean;
  /** The template items the show's list would join, read whatever CIRQLIN answered. */
  plannedTemplates: { actions: TemplateAction[]; note: string | null };
}[] = [];

for (const code of args.events) {
  const event = await loadEvent(code);
  const venueAccount = await venueAccountOf(venueDb, event);
  const { rows: existing, tableMissing } = await existingRows(event.id);
  const plan = await planEnable({
    db,
    graph,
    event: { id: event.id, event_code: code, client_id: event.client_id, meta_ad_account_id: event.meta_ad_account_id },
    venueAccount,
    showAudienceId: args.audience,
    existing,
  });

  if (args.mode === "enable") {
    if (tableMissing) throw new Error("customer_list_syncs is missing: apply migration 267 first");
    if (!plan.account.chosen) throw new Error(`${code}: no ad account (event or venue)`);
    for (const row of plan.rows) {
      const payload = enableRowPayload(row);
      const prior = existing.find((r) => r.kind === row.kind && (r.meta_audience_id ?? null) === (row.meta_audience_id ?? null)) ?? existing.find((r) => r.kind === "show" && !r.meta_audience_id);
      const res = prior
        ? await db.from("customer_list_syncs").update(payload).eq("id", prior.id!)
        : await db.from("customer_list_syncs").insert(payload);
      if (res.error) throw new Error(`customer_list_syncs ${row.kind}: ${res.error.message}`);
      console.log(`${prior ? "enabled" : "added"}  ${code}  ${row.list_name ?? "-"}  ${row.meta_audience_id ?? "(made on the trigger)"}  ${row.ad_account_id}`);
    }
    continue;
  }

  const stateNow = syncState(event, new Date());
  const asOf = args.at ? new Date(args.at) : stateNow.state === "waiting" ? stateNow.triggerAt : new Date();
  let rows = plan.rows;
  if (args.mode === "run") {
    const enabled = existing.filter((r) => r.enabled);
    if (!enabled.length) throw new Error(`${code}: no enabled row (run --enable first)`);
    rows = enabled;
  }
  const work = await workForRows(db, rows, (e) => venueAccountOf(venueDb, e), [code]);
  const templates = await templatesFor(event.client_id);
  const plannedTemplates = plan.account.chosen
    ? await addShowListToTemplates({
        db,
        mode: "dry",
        event: { code, name: event.name ?? null, client_id: event.client_id },
        list: { meta_audience_id: plan.showList.existingId, ad_account_id: plan.account.chosen, name: plan.showList.name },
        templates,
      })
    : { actions: [], note: "no ad account" };
  const result = await runCustomerListSync(
    {
      db,
      graph,
      readHashed,
      env: process.env,
      now: args.mode === "run" ? new Date() : asOf,
      mode: args.mode === "run" ? "write" : "dry",
      log: () => {},
      templates,
    },
    work,
  );
  out.push({ plan, result, asOf: asOf.toISOString(), stateNow: stateNow.state, tableMissing, plannedTemplates });
}

if (args.mode !== "enable") {
  const lines: string[] = [];
  lines.push(`Signups into Meta, ${args.mode === "run" ? (out[0]?.result?.writesOff ? "RUN asked, kill switch off: ran as a dry run" : "run") : "dry run (reads only)"} · ${new Date().toISOString()}`);
  lines.push(`Kill switch OFFPIXEL_META_CUSTOMER_LIST_WRITES_ENABLED: ${customerListWritesEnabled(process.env) ? "on" : "off"} · CIRQLIN_PARTNER_HASHES_SECRET: ${process.env.CIRQLIN_PARTNER_HASHES_SECRET?.trim() ? "set" : "not set"}`);
  lines.push("");
  lines.push("| Event | events.meta_ad_account_id | Venue fallback | Account used | List | Meta id | Action | CIRQLIN pages | consented_show | consented_promoter | not_consented | Adds | Removes | Replace | Template items | Note |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const { plan, result, asOf, stateNow, plannedTemplates } of out) {
    const acct = plan.account;
    const head = `${plan.eventCode} | ${acct.eventAccount ?? "null"} | ${acct.venueAccount ?? "none (no venue row)"} | ${acct.chosen ?? "none"} (${acct.source})`;
    for (const r of result?.rows ?? []) {
      const c = r.counts;
      const actions = r.templates.length ? r.templates : plannedTemplates.actions;
      const tmpl = actions.length
        ? actions.map((t) => `${t.template}${t.proposed ? " (proposed)" : ""}: ${t.action}`).join("; ")
        : `none (${r.templatesNote ?? plannedTemplates.note ?? "no template lists this show"})`;
      const replace = r.replaced ? fmt(r.replaced) : r.triggerAt ? `first Mon ${firstReplaceDay(new Date(r.triggerAt))} 08:00 London` : "-";
      const note = [stateNow !== "active" ? `now ${stateNow}; judged as of ${asOf}` : "", r.error ?? ""].filter(Boolean).join("; ");
      lines.push(
        `| ${head} | ${r.listName ?? "-"} | ${r.listId ?? "(to be made)"} | ${r.outcome} | ${r.pages} | ${c ? fmt(c.consented_show) : "-"} | ${c ? fmt(c.consented_promoter) : "-"} | ${c ? fmt(c.not_consented) : "-"} | ${fmt(r.added)} | ${fmt(r.removed)} | ${replace} | ${tmpl} | ${note} |`,
      );
    }
    if (!result?.rows.length) lines.push(`| ${head} | ${plan.showList.name} | - | no row (${acct.chosen ? "no enabled row" : "no ad account"}) | 0 | - | - | - | 0 | 0 | - | - | |`);
  }
  lines.push("");
  const reads = out.reduce((s, o) => s + (o.result?.cirqlinReads ?? 0), 0);
  lines.push(`Meta: ${live.reads()} GETs, ${live.writes()} writes. CIRQLIN: ${reads} reads asked for (without CIRQLIN_PARTNER_HASHES_SECRET none is sent). Only the show's own list is ever written.`);
  if (out.some((o) => o.tableMissing)) lines.push("customer_list_syncs isn't on this database yet (migration 267 unapplied): planned rows only.");
  console.log(lines.join("\n"));
  if (args.json) {
    writeFileSync(
      args.json,
      JSON.stringify(
        out.map((o) => ({ ...o, plan: { ...o.plan, rows: o.plan.rows.map((r) => ({ kind: r.kind, list: r.meta_audience_id, account: normaliseAccount(r.ad_account_id), name: r.list_name })) } })),
        null,
        2,
      ),
    );
  }
}
