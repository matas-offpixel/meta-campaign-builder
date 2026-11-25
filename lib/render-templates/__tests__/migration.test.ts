import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SQL = readFileSync(new URL("../../../supabase/migrations/270_render_packages.sql", import.meta.url), "utf8");
const code = SQL.replace(/--.*$/gm, "");

test("migration 270 is additive: no table or column dropped, no data rewritten", () => {
  assert.doesNotMatch(code, /drop\s+table|drop\s+column|truncate|delete\s+from|update\s+\w+\s+set/i);
  // Only constraints are dropped, each re-added in the same file.
  for (const m of code.matchAll(/drop constraint if exists (\w+)/g)) assert.match(code, new RegExp(`add constraint ${m[1]}\\b`), m[1]);
});

test("one package rendering per event; caption renders keep their clip and caption; package rights mirror AL1", () => {
  assert.match(code, /create unique index if not exists creative_lab_render_packages_one_running\s+on creative_lab_render_packages \(event_id\) where status = 'rendering'/);
  assert.match(code, /recipe is null and clip_id is not null and caption_id is not null/);
  assert.match(code, /not \(owner_kind = 'promoter' and rights_shareable\)/);
  assert.match(code, /source <> 'claude' or approval_asked is not null/);
  assert.match(code, /kind in \('read', 'draft', 'meta', 'render'\)/);
});
