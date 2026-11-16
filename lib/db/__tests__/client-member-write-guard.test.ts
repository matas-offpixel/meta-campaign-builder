import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

/**
 * Migration 251 (client_users members can't write agency tables through the
 * database API), checked by reading the SQL: there's no local Postgres in
 * this repo's test setup, so the policies themselves are verified by reading
 * and by the prod pg_policies read recorded in the PR.
 */

const ROOT = process.cwd();
const SQL = readFileSync(join(ROOT, "supabase/migrations/251_client_member_write_guard.sql"), "utf8");

function tableList(): string[] {
  const m = SQL.match(/tables text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(m, "table array not found");
  return [...m[1]!.matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]!);
}

describe("migration 251: client member write guard", () => {
  it("decides by membership: a security-definer check on client_users for auth.uid()", () => {
    assert.match(SQL, /create or replace function public\.is_client_member\(\)/);
    assert.match(SQL, /security definer/);
    assert.match(SQL, /set search_path = public/);
    assert.match(SQL, /from public\.client_users cu where cu\.user_id = auth\.uid\(\)/);
    assert.match(SQL, /revoke all on function public\.is_client_member\(\) from public;/);
    assert.match(SQL, /grant execute on function public\.is_client_member\(\) to authenticated;/);
  });

  it("adds restrictive insert, update and delete policies, and no select policy", () => {
    assert.match(SQL, /as restrictive for insert to authenticated with check \(not public\.is_client_member\(\)\)/);
    assert.match(
      SQL,
      /as restrictive for update to authenticated using \(not public\.is_client_member\(\)\) with check \(not public\.is_client_member\(\)\)/,
    );
    assert.match(SQL, /as restrictive for delete to authenticated using \(not public\.is_client_member\(\)\)/);
    assert.doesNotMatch(SQL, /for select/i);
    assert.doesNotMatch(SQL, /as permissive/i);
    assert.doesNotMatch(SQL, /\bdisable row level security\b/i);
  });

  it("covers the tables Matas named and the ones the audit found", () => {
    const tables = new Set(tableList());
    for (const t of [
      // Matas's list
      "clients",
      "events",
      "campaign_drafts",
      "campaign_plans",
      "campaign_plan_meta_launch",
      "campaign_plan_google_launch",
      "campaign_plan_tiktok_launch",
      "meta_custom_audiences",
      "audience_seeds",
      "client_asset_queue",
      // from the audit
      "creative_lab_artists",
      "creative_lab_clips",
      "creative_lab_rounds",
      "creative_lab_round_ads",
      "creative_lab_renders",
      "creative_lab_ig_candidates",
      "client_ticketing_connections",
      "event_ticketing_links",
      "d2c_connections",
      "creative_assets",
      "launched_ad_sets",
      "launched_ads",
    ]) {
      assert.ok(tables.has(t), `missing ${t}`);
    }
  });

  it("leaves user_facebook_tokens out (members connect their own Facebook through /api/auth)", () => {
    assert.equal(tableList().includes("user_facebook_tokens"), false);
  });

  it("lists 112 tables, each once", () => {
    const list = tableList();
    assert.equal(list.length, 112);
    assert.equal(new Set(list).size, list.length);
  });

  it("is re-runnable: drops its own policies before creating them, skips missing tables", () => {
    assert.match(SQL, /drop policy if exists %I on public\.%I', 'client_member_no_insert'/);
    assert.match(SQL, /to_regclass\('public\.' \|\| t\) is null/);
  });
});

describe("the client dashboard's writes don't depend on a member session", () => {
  it("server actions under requireClientContext never query through the session client", () => {
    const dir = join(ROOT, "lib/actions");
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    const clientActions = files.filter((f) => readFileSync(join(dir, f), "utf8").includes("requireClientContext("));
    assert.ok(clientActions.length >= 4, `found ${clientActions.length}`);
    for (const f of clientActions) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/const (\w+) = await createClient\(\)/g)) {
        const name = m[1]!;
        assert.doesNotMatch(src, new RegExp(`\\b${name}\\s*\\.\\s*from\\(`), `${f}: ${name} (session client) queries a table`);
        assert.doesNotMatch(src, new RegExp(`\\b${name}\\s*\\.\\s*rpc\\(`), `${f}: ${name} (session client) calls an RPC`);
      }
    }
  });
});
