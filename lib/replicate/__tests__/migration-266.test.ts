/**
 * Migration 266, checked by reading the SQL (there's no local Postgres in the
 * test setup): additive only, owner RLS and 251's client-member write guard on
 * every new table, and the columns R1 / R2 / R6 / R7 need.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { GENRE_FAMILY_KEYS } from "../../learning/genre/families.ts";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/266_campaign_creator_replicate.sql"), "utf8");
const CODE = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const TABLES = ["audience_templates", "audience_template_items", "campaign_additions"];

describe("migration 266", () => {
  it("is additive: new tables and nullable columns, nothing dropped, no data written", () => {
    assert.doesNotMatch(CODE, /\bdrop\s+(table|column|constraint|index)\b/i);
    assert.doesNotMatch(CODE, /\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\.|\binsert\s+into\b/i);
    assert.doesNotMatch(CODE, /\balter\s+column\b|\brename\b/i);
    for (const t of TABLES) assert.match(CODE, new RegExp(`create table if not exists public\\.${t} \\(`));
    // Only venues, events and the new tables are altered.
    for (const m of CODE.matchAll(/alter table (?:public\.)?(%I|[a-z_]+)/gi)) {
      assert.ok(["venues", "events", "%I"].includes(m[1]!), m[0]);
    }
    for (const m of CODE.matchAll(/add column if not exists (\w+) ([^,;\n]+)/g)) {
      assert.doesNotMatch(m[2]!, /not null/i, `${m[1]} must be nullable`);
    }
  });

  it("R2: venue account and pixel, the event's pixel override, the venue's client", () => {
    assert.match(CODE, /alter table public\.venues[\s\S]*add column if not exists client_id uuid references public\.clients \(id\) on delete set null/);
    assert.match(CODE, /add column if not exists meta_ad_account_id text/);
    assert.match(CODE, /alter table public\.venues[\s\S]*add column if not exists meta_pixel_id text/);
    assert.match(CODE, /alter table public\.events\s+add column if not exists meta_pixel_id text/);
  });

  it("R6: templates under a business, items by role, unique with nulls not distinct", () => {
    assert.match(CODE, /business_id\s+text/);
    assert.match(CODE, /genre_families\s+text\[\]/);
    assert.match(CODE, /confirmed_by\s+uuid/);
    assert.match(CODE, /confirmed_at\s+timestamptz/);
    assert.match(CODE, /template_id\s+uuid\s+not null references public\.audience_templates \(id\) on delete cascade/);
    assert.match(CODE, /kind\s+text\s+not null check \(kind in \('customer_list', 'retargeting_pool', 'page_engagers', 'interest'\)\)/);
    for (const col of ["list_role", "page_id", "retention_days", "interest_id", "interest_name", "meta_audience_id"]) {
      assert.match(CODE, new RegExp(`\\n\\s+${col}\\s`), col);
    }
    assert.match(CODE, /unique nulls not distinct\s+\(template_id, kind, list_role, family_key, page_id, retention_days, interest_id\)/);
  });

  it("R6: template families and an item's family_key are lib/learning/genre/families.ts's keys", () => {
    const families = CODE.match(/genre_families <@ array\[([^\]]+)\]/);
    const item = CODE.match(/family_key\s+text\s+check \(family_key in \(([^)]+)\)\)/);
    for (const m of [families, item]) {
      assert.ok(m);
      assert.deepEqual([...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]), [...GENRE_FAMILY_KEYS]);
    }
  });

  it("R7: campaign_additions by event, stage, campaign, ad sets and kind", () => {
    assert.match(CODE, /event_id\s+uuid\s+not null references public\.events \(id\) on delete cascade/);
    assert.match(CODE, /stage\s+text\s+not null check \(stage in \('signup', 'presale', 'on_sale', 'show_week'\)\)/);
    assert.match(CODE, /meta_campaign_id\s+text\s+not null/);
    assert.match(CODE, /meta_adset_ids\s+text\[\]\s+not null default '\{\}'/);
    assert.match(CODE, /kind\s+text\s+not null check \(kind in \('creative', 'audience'\)\)/);
    assert.match(CODE, /detail\s+jsonb\s+not null default/);
    assert.match(CODE, /created_by\s+uuid/);
  });

  it("puts owner RLS and the restrictive client-member guard on every new table", () => {
    const list = CODE.match(/tables text\[\] := array\[([\s\S]*?)\];/);
    assert.ok(list);
    assert.deepEqual([...list[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), TABLES);
    for (const t of TABLES) assert.match(CODE, new RegExp(`create table if not exists public\\.${t} \\([\\s\\S]*?user_id\\s+uuid\\s+not null references auth\\.users`));
    assert.match(CODE, /enable row level security/);
    assert.match(CODE, /using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
    assert.match(CODE, /as restrictive for insert to authenticated with check \(not public\.is_client_member\(\)\)/);
    assert.match(CODE, /as restrictive for update to authenticated using \(not public\.is_client_member\(\)\) with check \(not public\.is_client_member\(\)\)/);
    assert.match(CODE, /as restrictive for delete to authenticated using \(not public\.is_client_member\(\)\)/);
    assert.doesNotMatch(CODE, /disable row level security/i);
    assert.doesNotMatch(CODE, /\bto anon\b|\bgrant\b/i);
  });
});
