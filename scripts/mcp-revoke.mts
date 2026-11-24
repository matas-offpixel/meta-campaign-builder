/**
 * MCP: list or revoke Claude connections (migration 268's mcp_oauth_grants).
 *
 *   npx tsx --env-file=.env.local scripts/mcp-revoke.mts --list
 *   npx tsx --env-file=.env.local scripts/mcp-revoke.mts --user <uuid>          (dry run)
 *   npx tsx --env-file=.env.local scripts/mcp-revoke.mts --user <uuid> --apply
 *   npx tsx --env-file=.env.local scripts/mcp-revoke.mts --all --apply
 *
 * --list and the dry run read only and print grant ids, users (ids), scopes,
 * client names and dates. --apply sets revoked_at on each live grant and its
 * tokens (revoked_reason 'script'); the connector's next call gets 401 and
 * Claude shows it as needing to connect again. Never prints a token. To stop
 * every connection at once without the script, unset ENABLE_MCP.
 */

import { createClient } from "@supabase/supabase-js";

import { createSupabaseStore } from "../lib/mcp/oauth/store.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const user = value("--user");
const list = flag("--list");
const all = flag("--all");
const apply = flag("--apply");
if ((!list && !user && !all) || (user && all) || (user && !/^[0-9a-f-]{36}$/i.test(user))) {
  console.error("usage: scripts/mcp-revoke.mts --list | --user <uuid> [--apply] | --all [--apply]");
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const store = createSupabaseStore(db);

const grants = await store.listLiveGrants({ userId: user });
const clients = new Map<string, string | null>();
for (const g of grants) if (!clients.has(g.client_id)) clients.set(g.client_id, (await store.getClient(g.client_id))?.client_name ?? null);

console.log(`${grants.length} live grant(s)${user ? ` for ${user}` : ""}`);
for (const g of grants) {
  console.log(`  ${g.id}  user=${g.user_id}  scope="${g.scope}"  client="${clients.get(g.client_id) ?? "?"}"  since=${g.created_at}`);
}
if (list) process.exit(0);
if (!apply) {
  console.log("dry run: nothing revoked. Add --apply to revoke these.");
  process.exit(0);
}
const now = new Date().toISOString();
for (const g of grants) await store.revokeGrant(g.id, "script", now);
console.log(`revoked ${grants.length} grant(s) and their tokens`);
