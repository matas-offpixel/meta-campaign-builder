/**
 * Migration 255, checked by reading the SQL (there's no local Postgres in
 * the test setup): additive only, owner RLS and 251's client-member write
 * guard on every new table, and the columns the records need.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/255_creative_tests.sql"), "utf8");
const CODE = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

const TABLES = [
  "creative_test_plans",
  "creative_tests",
  "creative_test_variants",
  "creative_test_reads",
  "creative_lab_audio_files",
  "creative_lab_snippet_renders",
  "spotify_top_tracks_cache",
];

describe("migration 255", () => {
  it("is additive: creates tables, alters only its own, drops only its own policies and triggers", () => {
    assert.doesNotMatch(CODE, /\bdrop\s+(table|column|constraint)\b/i);
    assert.doesNotMatch(CODE, /\balter\s+table\s+(?!public\.%I)/i);
    assert.doesNotMatch(CODE, /\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\./i);
    for (const t of TABLES) assert.match(CODE, new RegExp(`create table if not exists public\\.${t} \\(`));
  });

  it("puts owner RLS and the restrictive client-member guard on every new table", () => {
    const list = CODE.match(/tables text\[\] := array\[([\s\S]*?)\];/);
    assert.ok(list);
    assert.deepEqual([...list[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), TABLES);
    assert.match(CODE, /enable row level security/);
    assert.match(CODE, /using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
    assert.match(CODE, /as restrictive for insert to authenticated with check \(not public\.is_client_member\(\)\)/);
    assert.match(CODE, /as restrictive for update to authenticated using \(not public\.is_client_member\(\)\) with check \(not public\.is_client_member\(\)\)/);
    assert.match(CODE, /as restrictive for delete to authenticated using \(not public\.is_client_member\(\)\)/);
  });

  it("holds what the records need", () => {
    // TT1 / CT12: a test runs in the Tests ad set of its format, or in place.
    assert.match(CODE, /format\s+text not null check \(format in \('video', 'statics'\)\)/);
    assert.match(CODE, /runs_in\s+text not null default 'tests_adset' check \(runs_in in \('tests_adset', 'main_adsets'\)\)/);
    // Matas, 16 Nov: Approve creates it paused, Start turns it live.
    for (const col of ["approved_at", "started_at", "first_delivery_at", "daily_budget_minor", "hold_minor", "at_minimum", "call_evidence"]) {
      assert.match(CODE, new RegExp(`\\b${col}\\b`));
    }
    // CT1 / CT4: 15 to 20 seconds, 16 by default.
    assert.match(CODE, /length_s\s+integer not null default 16 check \(length_s between 15 and 20\)/);
    // CT2: who supplied the file; TT5: the rights flag and the raw Meta response.
    assert.match(CODE, /supplier\s+text check \(supplier in \('client', 'artist_team'\)\)/);
    assert.match(CODE, /rights_flag\s+text/);
    assert.match(CODE, /mute_raw\s+jsonb/);
    // TF2: one read per test per day.
    assert.match(CODE, /unique \(test_id, read_day\)/);
  });

  it("never stores a link to fetch audio from (CT2)", () => {
    assert.doesNotMatch(CODE, /youtube|soundcloud|spotify_url|audio_url|source_url/i);
  });
});
