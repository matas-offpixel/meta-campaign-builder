/**
 * Migration 275: retargeting_builds — additive, one row per show, RLS on with
 * an owner read only, and the write ledger's op_kind CHECK left as it is.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../../../supabase/migrations/275_retargeting_builds.sql", import.meta.url), "utf8");
const code = sql.replace(/--.*$/gm, "");

test("migration 275: one build row per show, RLS on, owner read only, additive, no ledger CHECK change", () => {
  const code = sql.replace(/--.*$/gm, "").slice(0, sql.replace(/--.*$/gm, "").indexOf("public.page_groups"));
  assert.match(code, /create table if not exists public\.retargeting_builds \(/);
  assert.match(code, /constraint retargeting_builds_event_unique unique \(event_id\)/);
  assert.match(code, /alter table public\.retargeting_builds enable row level security;/);
  assert.match(code, /for select\s+using \(auth\.uid\(\) = user_id\)/);
  assert.doesNotMatch(code, /for (insert|update|delete|all)\b/i);
  assert.doesNotMatch(code, /\b(drop table|drop column|truncate|delete from|update public\.)/i);
  assert.doesNotMatch(code, /meta_write_idempotency/);
  assert.match(code, /state\s+text\s+not null default 'building' check \(state in \('building', 'paused', 'live', 'failed'\)\)/);
  assert.match(code, /source\s+text\s+not null check \(source in \('panel', 'connector'\)\)/);
});

test("migration 275: page_groups, one per client and genre, service role only, unconfirmed until Matas confirms", () => {
  assert.match(code, /create table if not exists public\.page_groups \(/);
  assert.match(code, /constraint page_groups_client_genre_unique unique \(client_id, genre_family\)/);
  assert.match(code, /page_ids\s+text\[\]/);
  assert.match(code, /ig_ids\s+text\[\]/);
  assert.match(code, /confirmed_at\s+timestamptz,/);
  assert.match(code, /constraint page_groups_confirmed_pair check \(\(confirmed_at is null\) = \(confirmed_by is null\)\)/);
  assert.match(code, /alter table public\.page_groups enable row level security;/);
  assert.match(code, /revoke all on public\.page_groups from anon, authenticated;/);
  assert.doesNotMatch(code.slice(code.indexOf("public.page_groups")), /create policy/);
});
