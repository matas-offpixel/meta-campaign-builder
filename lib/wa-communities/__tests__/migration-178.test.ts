import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(
  HERE,
  "../../../supabase/migrations/178_wa_community_alias_repoint.sql",
);

describe("migration 178", () => {
  it("drops the constraint name read from pg_constraint, not the draft's name", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    assert.match(sql, /drop constraint wa_community_aliases_slug_format/);
    assert.doesNotMatch(sql, /drop constraint wa_community_aliases_slug_check/);
    assert.match(sql, /slug !~ '\^\[A-Za-z0-9\]\+\(\[-\.\]\[A-Za-z0-9\]\+\)\*\$'/);
    assert.match(sql, /check \(slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'\)/);
    assert.match(sql, /is distinct from/);
    assert.match(sql, /repoint_community_alias/);
    assert.match(sql, /create_community_alias/);
    assert.match(sql, /event_ref/);
    assert.match(
      sql,
      /add column if not exists interstitial_enabled boolean not null default false/,
    );
    assert.match(sql, /deferrable initially deferred/);
  });
});
