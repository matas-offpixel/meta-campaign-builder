/**
 * M3c: link each client to its Business Manager (client_business_managers.client_id),
 * the BM tool's connections, so request_page_access asks from the client's own.
 *
 *   npx tsx --env-file=.env.local scripts/link-client-business-managers.mts            (dry run: reads only)
 *   npx tsx --env-file=.env.local scripts/link-client-business-managers.mts --apply    (writes client_id)
 *   … --client <uuid|name>                                                              (one client)
 *
 * A client's Business Manager is the owner business of its ad accounts
 * (GET /act_{id}?fields=business with Matas's own token, user_facebook_tokens:
 * never the env token): the client's meta_ad_account_id, its events' and its
 * venues'. The rules are lib/bm/client-link.ts planClientLinks: an
 * Off/Pixel-owned account says nothing about the client's BM; a business
 * that owns two clients' accounts is left for Matas; a connection already
 * linked to another client is never overwritten. Archived clients are left out.
 *
 * --apply writes client_id on each planned link whose row has no client yet,
 * one UPDATE … WHERE business_id AND client_id IS NULL. Nothing else is
 * written and nothing is sent to Meta (GETs only). Prints client and business
 * names and ids, account ids and reasons: no tokens, no person data.
 */

import { createClient } from "@supabase/supabase-js";

import { MATAS_USER_IDS } from "../lib/auth/operator-allowlist.ts";
import { planClientLinks, type AccountOwner, type Connected, type LinkClient } from "../lib/bm/client-link.ts";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const clientArg = argv.includes("--client") ? argv[argv.indexOf("--client") + 1]?.trim() : undefined;
const version = process.env.META_API_VERSION ?? "v21.0";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const digits = (v: string | null | undefined) => (v ? v.trim().replace(/^act_/, "") : "");
const isAccount = (v: string) => /^\d{5,32}$/.test(v);

async function all<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await db.from(table).select(cols).order("id", { ascending: true }).range(from, from + 999);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    out.push(...((res.data ?? []) as T[]));
    if ((res.data ?? []).length < 1000) return out;
  }
}

const tokenRow = await db.from("user_facebook_tokens").select("provider_token").eq("user_id", MATAS_USER_IDS[0]!).maybeSingle();
const token = (tokenRow.data as { provider_token?: string } | null)?.provider_token?.trim();
if (!token) {
  console.error("Matas has no Facebook token in user_facebook_tokens: connect Facebook in Off/Pixel first.");
  process.exit(2);
}

type ClientRow = { id: string; name: string | null; status: string | null; meta_ad_account_id: string | null; meta_business_id: string | null };
let clients = (await all<ClientRow>("clients", "id, name, status, meta_ad_account_id, meta_business_id")).filter((c) => c.status !== "archived");
if (clientArg) {
  clients = clients.filter((c) => c.id === clientArg || (c.name ?? "").toLowerCase() === clientArg.toLowerCase());
  if (clients.length !== 1) {
    console.error(`--client ${clientArg}: ${clients.length} clients match`);
    process.exit(2);
  }
}
const events = await all<{ id: string; client_id: string | null; meta_ad_account_id: string | null }>("events", "id, client_id, meta_ad_account_id");
const venues = await all<{ id: string; client_id: string | null; meta_ad_account_id: string | null }>("venues", "id, client_id, meta_ad_account_id");
const connected = (await all<{ id: string; business_id: string; business_name: string | null; client_id: string | null }>("client_business_managers", "id, business_id, business_name, client_id")).map(
  (r): Connected => ({ businessId: String(r.business_id), name: r.business_name ?? String(r.business_id), clientId: r.client_id }),
);

const accountsOf = new Map<string, Set<string>>();
const add = (clientId: string | null, account: string | null) => {
  const a = digits(account);
  if (!clientId || !isAccount(a)) return;
  (accountsOf.get(clientId) ?? accountsOf.set(clientId, new Set()).get(clientId)!).add(a);
};
for (const c of clients) add(c.id, c.meta_ad_account_id);
for (const e of events) add(e.client_id, e.meta_ad_account_id);
for (const v of venues) add(v.client_id, v.meta_ad_account_id);

const linkClients: LinkClient[] = clients.map((c) => ({ id: c.id, name: c.name ?? c.id, accounts: [...(accountsOf.get(c.id) ?? [])].sort(), storedBusinessId: c.meta_business_id?.trim() || null }));

// One GET per distinct account, the owner business only.
const owners = new Map<string, AccountOwner>();
let gets = 0;
for (const account of [...new Set(linkClients.flatMap((c) => c.accounts))]) {
  const u = new URL(`https://graph.facebook.com/${version}/act_${account}`);
  u.searchParams.set("fields", "business{id,name}");
  u.searchParams.set("access_token", token);
  gets += 1;
  try {
    const res = await fetch(u, { method: "GET", cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { business?: { id?: string; name?: string }; error?: unknown } | null;
    owners.set(account, !res.ok || !body || body.error ? "unread" : body.business?.id ? { id: String(body.business.id), name: body.business.name ?? null } : null);
  } catch {
    owners.set(account, "unread");
  }
}

const plan = planClientLinks(linkClients, owners, connected);
console.log(`${apply ? "APPLY" : "DRY RUN"}: ${linkClients.length} client(s), ${connected.length} connected Business Manager(s), ${gets} Meta GET(s)`);
console.log(`\nLinked (${plan.links.length}):`);
for (const l of plan.links) {
  const stored = l.storedBusinessMatches == null ? "" : l.storedBusinessMatches ? "  · matches clients.meta_business_id" : "  · differs from clients.meta_business_id";
  console.log(`  ${l.client} (${l.clientId}) → ${l.business} (${l.businessId})${l.already ? "  · already linked" : ""}  · accounts ${l.accounts.map((a) => `act_${a}`).join(", ")}${stored}`);
}
console.log(`\nNot linked (${plan.unlinked.length}):`);
for (const u of plan.unlinked) console.log(`  ${u.client} (${u.clientId}): ${u.reason} — ${u.detail}`);
const linkedBusinesses = new Set(plan.links.map((l) => l.businessId));
const idle = connected.filter((c) => !linkedBusinesses.has(c.businessId) && !c.clientId);
console.log(`\nConnected Business Managers no client's accounts point to (${idle.length}): ${idle.map((c) => `${c.name} (${c.businessId})`).join(", ")}`);

if (!apply) {
  console.log("\nDry run: nothing was written. Run with --apply to write client_id on the links above.");
  process.exit(0);
}
let written = 0;
for (const l of plan.links.filter((x) => !x.already)) {
  const res = await db.from("client_business_managers").update({ client_id: l.clientId }).eq("business_id", l.businessId).is("client_id", null).select("business_id");
  if (res.error) {
    console.error(`  ${l.business} (${l.businessId}): not written — ${res.error.message}`);
    continue;
  }
  written += (res.data ?? []).length;
}
console.log(`\nWrote client_id on ${written} connection(s).`);
