/**
 * Migration 260 (Top tracks, TK1–TK11), checked by reading the SQL (there's
 * no local Postgres in the test setup): additive only, owner RLS and 251's
 * client-member write guard on the new table, the TK3 columns, and the
 * top_tracks test kind.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/260_creative_lab_top_tracks.sql"), "utf8");
const CODE = SQL.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

describe("migration 260", () => {
  it("is additive: drops only its own constraints, policies and triggers before re-making them", () => {
    assert.doesNotMatch(CODE, /\bdrop\s+(table|column)\b/i);
    assert.doesNotMatch(CODE, /\btruncate\b|\bdelete\s+from\b|\bupdate\s+public\./i);
    for (const m of CODE.matchAll(/drop constraint if exists (\w+)/g)) assert.match(CODE, new RegExp(`add constraint ${m[1]}\\b`));
    assert.match(CODE, /create table if not exists public\.creative_lab_top_tracks_renders \(/);
  });

  it("keeps the kinds 255 allowed and adds top_tracks", () => {
    assert.match(CODE, /check \(kind in \('tracks', 'statics', 'together', 'copy', 'clip', 'top_tracks'\)\)/);
  });

  it("adds TK18's analysis, TK15's choice and the hook columns", () => {
    for (const col of ["analysis", "analysis_key", "analysis_state", "drop_choice", "hook_s", "hook_source", "hook_set_by", "hook_set_at"]) assert.match(CODE, new RegExp(`add column if not exists ${col}\\b`));
    assert.match(CODE, /drop_choice in \('last', 'earlier'\)/);
    assert.match(CODE, /analysis_state in \('running', 'done', 'failed'\)/);
  });

  it("puts owner RLS and the restrictive client-member guard on the new table", () => {
    assert.match(CODE, /alter table public\.creative_lab_top_tracks_renders enable row level security/);
    assert.match(CODE, /using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
    for (const op of ["insert", "update", "delete"]) assert.match(CODE, new RegExp(`as restrictive for ${op} to authenticated`));
  });
});
