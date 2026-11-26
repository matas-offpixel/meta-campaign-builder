/**
 * Migration 273 re-adds meta_write_idempotency's op_kind CHECK with every
 * kind live on prod (27, read from pg_constraint on 26 Nov 2026, the same
 * order as 271) plus page_access_request: none missing, none repeated,
 * nothing dropped. The ledger's TypeScript union lists the same 28.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PROD_27 = [
  "campaign_create", "adset_create", "ad_create", "creative_upload", "adset_targeting_update", "adset_destination_update",
  "refresh_creative_create", "refresh_ad_create", "ad_status_update", "adset_status_update", "refresh_adset_budget_update",
  "refresh_adset_create", "refresh_custom_conversion_create", "refresh_campaign_create", "refresh_campaign_lifetime_budget_update",
  "refresh_campaign_status_update", "retargeting_audience_rule_update", "retargeting_study_create", "retargeting_study_end",
  "adset_end_time_update", "customer_list_create", "customer_list_users", "campaign_status_update", "adset_budget_update",
  "campaign_budget_update", "object_name_update", "ad_study_create",
];
const kindsIn = (sql: string) => [...(/add constraint meta_write_idempotency_op_kind_check\s+check \(op_kind in \(([\s\S]*?)\)\);/.exec(sql)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

test("273: prod's 27 kinds in order, then page_access_request; none missing or repeated", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/273_page_access_request.sql"), "utf8");
  const kinds = kindsIn(sql);
  assert.equal(PROD_27.length, 27);
  assert.deepEqual(kinds, [...PROD_27, "page_access_request"]);
  assert.equal(new Set(kinds).size, kinds.length);
  // 271's list is prod's, so 273 drops nothing 271 added.
  assert.deepEqual(kindsIn(readFileSync(join(ROOT, "supabase/migrations/271_scheduled_meta_changes.sql"), "utf8")), PROD_27);
});

test("273 is additive: one drop (the CHECK it re-adds), no table, column or data change", () => {
  const sql = readFileSync(join(ROOT, "supabase/migrations/273_page_access_request.sql"), "utf8").replace(/--.*$/gm, "");
  assert.equal([...sql.matchAll(/\bdrop\b/gi)].length, 1);
  assert.match(sql, /drop constraint if exists meta_write_idempotency_op_kind_check;/);
  assert.doesNotMatch(sql, /\b(drop table|drop column|truncate|delete from|update public\.|insert into)\b/i);
});

test("the ledger's op kinds in TypeScript are the migration's 28", () => {
  const ts = readFileSync(join(ROOT, "lib/meta/write-idempotency.ts"), "utf8");
  const union = /export type MetaWriteOpKind =([\s\S]*?);\n/.exec(ts)![1]!;
  const kinds = [...union.matchAll(/\|\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(kinds, [...PROD_27, "page_access_request"].sort());
});
