import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const SQL = readFileSync(new URL("../../../supabase/migrations/269_artist_assets.sql", import.meta.url), "utf8");

describe("migration 269 (AL2)", () => {
  it("two service-role-only tables: RLS on, everything revoked, a false read policy (as 264)", () => {
    for (const t of ["artist_assets", "artist_library_folders"]) {
      assert.match(SQL, new RegExp(`create table if not exists ${t} \\(`), t);
      assert.match(SQL, new RegExp(`alter table ${t} enable row level security;`), t);
      assert.match(SQL, new RegExp(`revoke all on ${t} from anon, authenticated;`), t);
      assert.match(SQL, new RegExp(`create policy "${t} no authenticated read" on ${t} for select to authenticated using \\(false\\)`), t);
    }
    assert.doesNotMatch(SQL, /using \((?!false)/, "no policy that lets anyone read");
    assert.doesNotMatch(SQL, /for (insert|update|delete|all)/i, "no write policy");
  });

  it("additive only", () => {
    assert.doesNotMatch(SQL, /\b(drop table|drop column|truncate|delete from|update \w+ set|alter column)\b/i);
  });

  it("the plan's columns, kinds and owners", () => {
    for (const col of ["artist_id", "kind", "drive_file_id", "storage_path", "source_event_id", "source_client_id", "owner_kind", "shareable", "approved_by", "approved_at", "meta_ad_id", "launched_ad_id", "created_at"]) {
      assert.match(SQL, new RegExp(`\\n  ${col}\\s`), col);
    }
    assert.match(SQL, /artist_id\s+uuid not null references artists \(id\)/);
    assert.match(SQL, /kind in \('clip', 'static', 'render', 'caption'\)/);
    assert.match(SQL, /owner_kind in \('artist', 'promoter', 'offpixel'\)/);
    assert.match(SQL, /shareable\s+boolean not null,/);
    assert.match(SQL, /constraint artist_assets_key unique \(artist_id, asset_key\)/);
  });

  it("a CHECK forbids shareable promoter rows", () => {
    assert.match(SQL, /constraint artist_assets_promoter_not_shareable check \(not \(owner_kind = 'promoter' and shareable\)\)/);
  });
});
