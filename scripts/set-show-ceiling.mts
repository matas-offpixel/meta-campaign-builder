/**
 * MCP PR D: list or set per-show spend ceilings (show_spend_ceilings and
 * show_spend_ceiling_events, migration 274). Matas only: set_by / added_by is
 * his user id (MATAS_USER_IDS). Dry run unless --apply.
 *
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --list
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --show NX26-AZYR                       (what applies now)
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --show NX26-AZYR --total 3500 [--apply]
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --show NX26-AZYR --remove [--apply]
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --group "DHB shared" --total 5000 --events DHB26-A,DHB26-B [--apply]
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --group "DHB shared" --drop-events DHB26-B [--apply]
 *   npx tsx --env-file=.env.local scripts/set-show-ceiling.mts --group "DHB shared" --remove [--apply]
 *
 * The ceiling is the most a show may have committed: spent to date
 * (ad_daily_insights) + its live lifetime budgets left + its live daily
 * budgets to their end or show day. A change through the connector that
 * starts or raises spend past it is refused (lib/mcp/meta/show-ceiling.ts).
 *
 * In order: a show's own row and its group's (both hold when both exist),
 * else the show's default by exact code (SHOW_DEFAULTS: P26-BDAY £4,500),
 * else the brand default by code prefix (BRAND_DEFAULTS: NX £3,000, ES
 * £2,500, EBR £2,500, AS £2,000; DHB none), both in code, else none, so
 * spend-starting changes are refused.
 *
 * A show is in at most one group; adding one that's in another group is
 * refused (drop it there first). --remove on a show deletes its own row (it
 * falls back to its group or default); on a group, the group and its
 * members. Prints codes, ids and £ only.
 */

import { createClient } from "@supabase/supabase-js";

import { MATAS_USER_IDS } from "../lib/auth/operator-allowlist.ts";
import { BRAND_DEFAULTS, SHOW_DEFAULTS, codeDefault, resolveShowCeiling } from "../lib/mcp/meta/show-ceiling.ts";
import { pounds } from "../lib/mcp/meta/ceiling-words.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const list = flag("--list");
const apply = flag("--apply");
const remove = flag("--remove");
const showArg = value("--show")?.trim();
const groupArg = value("--group")?.trim();
const totalArg = value("--total");
const codes = (name: string) => (value(name) ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const addCodes = codes("--events");
const dropCodes = codes("--drop-events");
const by = value("--by") ?? MATAS_USER_IDS[0];

const usage = () => {
  console.error(
    [
      "usage: scripts/set-show-ceiling.mts --list",
      "     | --show CODE [--total <£> | --remove] [--apply]",
      "     | --group NAME [--total <£>] [--events CODE,CODE] [--drop-events CODE] [--remove] [--apply]",
      "     [--by <matas uuid>]",
    ].join("\n"),
  );
  process.exit(2);
};
if ([list, Boolean(showArg), Boolean(groupArg)].filter(Boolean).length !== 1) usage();
if (remove && totalArg != null) usage();
if (showArg && (addCodes.length || dropCodes.length)) usage();
const total = totalArg == null ? null : Number(totalArg);
if (total != null && (!Number.isFinite(total) || total < 0 || Math.round(total * 100) / 100 !== total)) {
  console.error("--total is pounds for the whole show (or group), 0 or more, at most 2 decimal places (e.g. 3000 or 2750.50)");
  process.exit(2);
}
if (groupArg && (groupArg.length < 1 || groupArg.length > 80)) {
  console.error("--group is a name of 1 to 80 characters");
  process.exit(2);
}
if (!by || !MATAS_USER_IDS.includes(by)) {
  console.error("--by must be one of MATAS_USER_IDS: only Matas sets ceilings");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const gbp = (n: number | string) => `£${pounds(Number(n))}`;
const fail = (what: string, e: { message: string } | null) => {
  if (e) throw new Error(`${what}: ${e.message}`);
};

// Migration 274 may not be applied yet: then no row exists, only the brand defaults apply, and nothing can be written.
const ready = !(await db.from("show_spend_ceilings").select("id").limit(1)).error;
if (!ready) console.log("Migration 274 isn't applied yet: there are no show or group rows, so only the brand defaults apply. Nothing can be written until it is.");

type EventRow = { id: string; event_code: string | null; event_date: string | null };
type CeilingRow = { id: string; event_id: string | null; group_name: string | null; total_gbp: number | string; set_at: string };

/** One event by exact code; never a guess. */
async function eventByCode(code: string): Promise<EventRow> {
  const res = await db.from("events").select("id, event_code, event_date").eq("event_code", code.toUpperCase());
  fail("events", res.error);
  const rows = (res.data ?? []) as EventRow[];
  if (rows.length !== 1) {
    console.error(rows.length === 0 ? `No event has code ${code}.` : `${code} is on ${rows.length} events; this script needs one:`);
    for (const r of rows) console.error(`  ${r.event_code}  ${r.id}  ${r.event_date ?? "no date"}`);
    process.exit(1);
  }
  return rows[0]!;
}

async function codesOf(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const res = await db.from("events").select("id, event_code").in("id", ids);
  fail("events", res.error);
  return new Map(((res.data ?? []) as EventRow[]).map((r) => [r.id, r.event_code ?? r.id]));
}

async function describe(ev: EventRow): Promise<string> {
  if (!ready) {
    const d = codeDefault(ev.event_code);
    if (!d || d.totalGbp == null) return "no ceiling (spend-starting changes through Claude refused)";
    return `${gbp(d.totalGbp)} (the ${d.key} default)`;
  }
  const r = await resolveShowCeiling(db, { id: ev.id, code: ev.event_code ?? ev.id });
  if (r.kind === "none") return "no ceiling (spend-starting changes through Claude refused)";
  return r.ceilings
    .map((c) => `${gbp(c.totalGbp)} ${c.source.kind === "default" ? `(the ${c.source.brand} default)` : c.source.kind === "own" ? "(set for this show)" : `(shared by ${c.source.codes.join(", ")})`}`)
    .join(" and ");
}

// ── --list ──────────────────────────────────────────────────────────────────

if (list) {
  console.log("Defaults (in code, lib/mcp/meta/show-ceiling.ts), by exact code first:");
  for (const d of SHOW_DEFAULTS) console.log(`  ${d.code.padEnd(9)} ${gbp(d.totalGbp)}  ${d.note}`);
  console.log("then by brand prefix:");
  for (const d of BRAND_DEFAULTS) console.log(`  ${d.brand.padEnd(9)} ${d.totalGbp == null ? "none" : gbp(d.totalGbp)}  ${d.note}`);
  if (!ready) process.exit(0);
  const rows = await db.from("show_spend_ceilings").select("id, event_id, group_name, total_gbp, set_at").order("set_at", { ascending: true });
  fail("show_spend_ceilings", rows.error);
  const ceilings = (rows.data ?? []) as CeilingRow[];
  const members = await db.from("show_spend_ceiling_events").select("event_id, ceiling_id");
  fail("show_spend_ceiling_events", members.error);
  const memberRows = (members.data ?? []) as Array<{ event_id: string; ceiling_id: string }>;
  const names = await codesOf([...new Set([...ceilings.map((c) => c.event_id), ...memberRows.map((m) => m.event_id)].filter((x): x is string => Boolean(x)))]);
  const own = ceilings.filter((c) => c.event_id);
  const groups = ceilings.filter((c) => c.group_name);
  console.log(`${own.length} show ceiling(s):`);
  for (const c of own) console.log(`  ${names.get(c.event_id!) ?? "?"}  ${c.event_id}  ${gbp(c.total_gbp)}  set ${c.set_at}`);
  console.log(`${groups.length} group(s):`);
  for (const g of groups) {
    const m = memberRows.filter((x) => x.ceiling_id === g.id).map((x) => names.get(x.event_id) ?? x.event_id);
    console.log(`  "${g.group_name}"  ${gbp(g.total_gbp)}  ${m.length ? m.join(", ") : "no shows yet"}  set ${g.set_at}`);
  }
  process.exit(0);
}

// ── --show ──────────────────────────────────────────────────────────────────

if (showArg) {
  const ev = await eventByCode(showArg);
  console.log(`${ev.event_code} (${ev.id})  show day ${ev.event_date ?? "not set"}`);
  console.log(`  now:   ${await describe(ev)}`);
  if (total == null && !remove) process.exit(0);
  if (!ready) {
    console.log(`  after: ${remove ? "none of its own" : gbp(total!)} (once migration 274 is applied)`);
    process.exit(0);
  }
  const current = await db.from("show_spend_ceilings").select("id, total_gbp").eq("event_id", ev.id).maybeSingle();
  fail("show_spend_ceilings", current.error);
  const row = current.data as { id: string; total_gbp: number } | null;
  console.log(`  row:   ${row ? gbp(row.total_gbp) : "none of its own"} → ${remove ? "none of its own (its group or brand default applies)" : gbp(total!)}`);
  if (!apply) {
    console.log("dry run: nothing written. Add --apply to write it.");
    process.exit(0);
  }
  if (remove) {
    if (row) fail("show_spend_ceilings delete", (await db.from("show_spend_ceilings").delete().eq("id", row.id)).error);
  } else if (row) {
    fail("show_spend_ceilings update", (await db.from("show_spend_ceilings").update({ total_gbp: total, set_by: by, set_at: new Date().toISOString() }).eq("id", row.id)).error);
  } else {
    fail("show_spend_ceilings insert", (await db.from("show_spend_ceilings").insert({ event_id: ev.id, total_gbp: total, set_by: by })).error);
  }
  console.log(`written. now: ${await describe(ev)}`);
  process.exit(0);
}

// ── --group ──────────────────────────────────────────────────────

if (!ready) {
  const adds0 = await Promise.all(addCodes.map(eventByCode));
  console.log(`group "${groupArg}"`);
  console.log(`  after (once migration 274 is applied): ${remove ? "removed" : `${total == null ? "its total" : gbp(total)}, ${adds0.map((e) => e.event_code).sort().join(", ") || "no shows yet"}`}`);
  for (const ev of adds0) console.log(`  ${ev.event_code}: now ${await describe(ev)}`);
  console.log("dry run: nothing written.");
  process.exit(0);
}

const existing = await db.from("show_spend_ceilings").select("id, event_id, group_name, total_gbp, set_at").eq("group_name", groupArg!).maybeSingle();
fail("show_spend_ceilings", existing.error);
const group = existing.data as CeilingRow | null;
const memberRes = group ? await db.from("show_spend_ceiling_events").select("event_id").eq("ceiling_id", group.id) : { data: [], error: null };
fail("show_spend_ceiling_events", memberRes.error);
const memberIds = ((memberRes.data ?? []) as Array<{ event_id: string }>).map((m) => m.event_id);
const memberCodes = await codesOf(memberIds);
const adds = await Promise.all(addCodes.map(eventByCode));
const drops = await Promise.all(dropCodes.map(eventByCode));

// A show is in one group at most.
for (const ev of adds) {
  const other = await db.from("show_spend_ceiling_events").select("ceiling_id").eq("event_id", ev.id).maybeSingle();
  fail("show_spend_ceiling_events", other.error);
  const at = (other.data as { ceiling_id: string } | null)?.ceiling_id;
  if (at && at !== group?.id) {
    console.error(`${ev.event_code} is already in another group; drop it there first.`);
    process.exit(1);
  }
}
if (!group && (remove || dropCodes.length)) {
  console.error(`No group named "${groupArg}".`);
  process.exit(1);
}
if (!group && total == null) {
  console.error(`A new group needs --total.`);
  process.exit(2);
}

const after = new Set(memberIds);
for (const ev of adds) after.add(ev.id);
for (const ev of drops) after.delete(ev.id);
const allCodes = new Map([...memberCodes, ...adds.map((e) => [e.id, e.event_code ?? e.id] as const), ...drops.map((e) => [e.id, e.event_code ?? e.id] as const)]);
const show = (ids: Iterable<string>) => [...ids].map((id) => allCodes.get(id) ?? id).sort().join(", ") || "no shows yet";

console.log(`group "${groupArg}"`);
console.log(`  now:   ${group ? `${gbp(group.total_gbp)}, ${show(memberIds)}` : "doesn't exist"}`);
console.log(`  after: ${remove ? "removed (its shows fall back to their own row or brand default)" : `${gbp(total ?? group!.total_gbp)}, ${show(after)}`}`);
for (const ev of adds) console.log(`  ${ev.event_code}: now ${await describe(ev)}`);
if (!apply) {
  console.log("dry run: nothing written. Add --apply to write it.");
  process.exit(0);
}
if (remove) {
  // Members go with the group (on delete cascade).
  fail("show_spend_ceilings delete", (await db.from("show_spend_ceilings").delete().eq("id", group!.id)).error);
  console.log("removed");
  process.exit(0);
}
let groupId = group?.id;
if (!group) {
  const ins = await db.from("show_spend_ceilings").insert({ group_name: groupArg, total_gbp: total, set_by: by }).select("id").single();
  fail("show_spend_ceilings insert", ins.error);
  groupId = (ins.data as { id: string }).id;
} else if (total != null && Number(group.total_gbp) !== total) {
  fail("show_spend_ceilings update", (await db.from("show_spend_ceilings").update({ total_gbp: total, set_by: by, set_at: new Date().toISOString() }).eq("id", group.id)).error);
}
for (const ev of adds) {
  if (memberIds.includes(ev.id)) continue;
  fail("show_spend_ceiling_events insert", (await db.from("show_spend_ceiling_events").insert({ event_id: ev.id, ceiling_id: groupId, added_by: by })).error);
}
for (const ev of drops) fail("show_spend_ceiling_events delete", (await db.from("show_spend_ceiling_events").delete().eq("event_id", ev.id).eq("ceiling_id", groupId!)).error);
console.log("written");
for (const ev of adds) console.log(`  ${ev.event_code}: now ${await describe(ev)}`);
