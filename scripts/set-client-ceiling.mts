/**
 * MCP M3a: list or set a client's daily ceiling (client_spend_ceilings,
 * migration 268) until Settings › Claude ships. Matas only: the row's
 * set_by is his user id (MATAS_USER_IDS).
 *
 *   npx tsx --env-file=.env.local scripts/set-client-ceiling.mts --list
 *   npx tsx --env-file=.env.local scripts/set-client-ceiling.mts --client <uuid|name> --daily 150          (dry run)
 *   npx tsx --env-file=.env.local scripts/set-client-ceiling.mts --client <uuid|name> --daily 150 --apply
 *   npx tsx --env-file=.env.local scripts/set-client-ceiling.mts --client <uuid|name> --remove [--apply]
 *
 * A ceiling is the most a live change through the connector may start, in £
 * a day (launch_draft live: the draft's money a day). No ceiling means a
 * spend-starting change for that client is refused; paused launches,
 * uploads and event edits never read it. --remove deletes the row, so live
 * changes for that client are refused again. --list and the dry run read
 * only. Prints client names, ids and £ only.
 */

import { createClient } from "@supabase/supabase-js";

import { MATAS_USER_IDS } from "../lib/auth/operator-allowlist.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const list = flag("--list");
const apply = flag("--apply");
const remove = flag("--remove");
const clientArg = value("--client")?.trim();
const dailyArg = value("--daily");
const by = value("--by") ?? MATAS_USER_IDS[0];

const usage = () => {
  console.error("usage: scripts/set-client-ceiling.mts --list | --client <uuid|name> (--daily <£> | --remove) [--apply] [--by <matas uuid>]");
  process.exit(2);
};
if (!list && !clientArg) usage();
if (clientArg && !remove && dailyArg == null) usage();
if (remove && dailyArg != null) usage();
const daily = dailyArg == null ? null : Number(dailyArg);
if (daily != null && (!Number.isFinite(daily) || daily < 0 || Math.round(daily * 100) / 100 !== daily)) {
  console.error("--daily is pounds a day, 0 or more, at most 2 decimal places (e.g. 150 or 87.50)");
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
const gbp = (n: number | string) => `£${Number(n).toFixed(2)}`;

type ClientRow = { id: string; name: string | null; status: string | null };

if (list) {
  const ceilings = await db.from("client_spend_ceilings").select("client_id, daily_gbp, set_at");
  if (ceilings.error) throw new Error(`client_spend_ceilings: ${ceilings.error.message}`);
  const rows = (ceilings.data ?? []) as Array<{ client_id: string; daily_gbp: number; set_at: string }>;
  const names = new Map<string, string>();
  if (rows.length) {
    const c = await db.from("clients").select("id, name").in("id", rows.map((r) => r.client_id));
    for (const r of (c.data ?? []) as ClientRow[]) names.set(r.id, r.name ?? "?");
  }
  console.log(`${rows.length} client ceiling(s)`);
  for (const r of rows) console.log(`  ${names.get(r.client_id) ?? "?"}  ${r.client_id}  ${gbp(r.daily_gbp)} a day  set ${r.set_at}`);
  console.log("A client not listed has no ceiling: its live changes through Claude are refused.");
  process.exit(0);
}

// The client, by id or by exact name (case-insensitive); never a guess.
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientArg!);
const found = isUuid
  ? await db.from("clients").select("id, name, status").eq("id", clientArg!)
  : await db.from("clients").select("id, name, status").ilike("name", clientArg!.replace(/[%_]/g, (c) => `\\${c}`));
if (found.error) throw new Error(`clients: ${found.error.message}`);
const matches = (found.data ?? []) as ClientRow[];
if (matches.length !== 1) {
  console.error(matches.length === 0 ? `No client matches "${clientArg}".` : `"${clientArg}" matches ${matches.length} clients; pass the id:`);
  for (const m of matches) console.error(`  ${m.name}  ${m.id}`);
  process.exit(1);
}
const client = matches[0]!;
const current = await db.from("client_spend_ceilings").select("daily_gbp, set_at").eq("client_id", client.id).maybeSingle();
if (current.error) throw new Error(`client_spend_ceilings: ${current.error.message}`);
const now = current.data as { daily_gbp: number; set_at: string } | null;

console.log(`${client.name} (${client.id})${client.status === "archived" ? " — archived" : ""}`);
console.log(`  now:   ${now ? `${gbp(now.daily_gbp)} a day (set ${now.set_at})` : "no ceiling"}`);
console.log(`  after: ${remove ? "no ceiling (live changes through Claude refused)" : `${gbp(daily!)} a day`}`);
if (!apply) {
  console.log("dry run: nothing written. Add --apply to write it.");
  process.exit(0);
}
if (remove) {
  const del = await db.from("client_spend_ceilings").delete().eq("client_id", client.id);
  if (del.error) throw new Error(`client_spend_ceilings delete: ${del.error.message}`);
  console.log("removed");
} else {
  const up = await db
    .from("client_spend_ceilings")
    .upsert({ client_id: client.id, daily_gbp: daily, set_by: by, set_at: new Date().toISOString() }, { onConflict: "client_id" });
  if (up.error) throw new Error(`client_spend_ceilings upsert: ${up.error.message}`);
  console.log("written");
}
