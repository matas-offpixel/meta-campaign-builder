/**
 * Migration 277: the seven Business Manager tables are read by operators'
 * sessions and the service role only. Each SELECT policy is
 * `using (not public.is_client_member())` (251's test: the database can't
 * read the app's operator list), so an /admin client login reads nothing.
 * And no client-facing surface (the /admin dashboard, share, landing and
 * the public join/redirect pages) names these tables, so nothing a client
 * can reach starts reading them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const TABLES = ["client_business_managers", "client_business_manager_links", "bm_pages", "bm_page_access_events", "bm_ig_accounts", "bm_ad_accounts", "bm_pixels"] as const;
const OLD = [
  "authenticated read business managers",
  "authenticated read business manager links",
  "authenticated read bm pages",
  "authenticated read bm page access events",
  "authenticated read bm_ig_accounts",
  "authenticated read bm_ad_accounts",
  "authenticated read bm_pixels",
];
const sql = readFileSync("supabase/migrations/277_bm_tables_operator_read.sql", "utf8");
const code = sql.replace(/--.*$/gm, "");

test("277: each of the seven tables drops its open read and gets the operators-only read (not a client_users member)", () => {
  for (const t of TABLES) assert.match(code, new RegExp(`\\('${t}',\\s+'[^']+'\\)`), t);
  for (const p of OLD) assert.ok(code.includes(`'${p}'`), p);
  assert.match(code, /drop policy if exists %I on public\.%I', t\.old_policy, t\.tbl/);
  assert.match(code, /create policy %I on public\.%I for select to authenticated using \(not public\.is_client_member\(\)\)/);
  assert.match(code, /enable row level security/);
});

test("277 changes policies only: no using (true), no grants, no table, column or data change, no user id", () => {
  assert.doesNotMatch(code, /using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(code, /\b(grant|revoke|insert into|update public|delete from|truncate|drop table|alter table [^;]* (add|drop) column)\b/i);
  assert.doesNotMatch(code, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  // 251 defines the test this relies on.
  assert.match(readFileSync("supabase/migrations/251_client_member_write_guard.sql", "utf8"), /create or replace function public\.is_client_member\(\)/);
});

/** Every .ts/.tsx file under a directory. */
function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx)$/.test(name) && !full.includes("__tests__")) out.push(full);
  }
  return out;
}

test("no client-facing surface names the BM tables", () => {
  const surfaces = ["app/admin", "app/share", "app/l", "app/c", "app/j", "app/api/share", "components/admin"];
  const hits: string[] = [];
  for (const file of surfaces.flatMap(walk)) {
    const src = readFileSync(file, "utf8");
    for (const t of TABLES) if (src.includes(t)) hits.push(`${file}: ${t}`);
  }
  assert.deepEqual(hits, []);
});
