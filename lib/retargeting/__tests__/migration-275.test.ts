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
