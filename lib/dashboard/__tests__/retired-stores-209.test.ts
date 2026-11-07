import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("migration 209 retires the unread stores", () => {
  const sql = readFileSync(
    "supabase/migrations/209_retire_dead_stores.sql",
    "utf8",
  );

  it("drops campaign_daily_insights and event_funnel_overrides", () => {
    assert.match(sql, /drop table if exists campaign_daily_insights/);
    assert.match(sql, /drop table if exists event_funnel_overrides/);
    assert.match(
      sql,
      /drop trigger if exists set_event_funnel_overrides_updated_at on event_funnel_overrides/,
    );
    assert.match(sql, /drop function if exists set_event_funnel_overrides_updated_at\(\)/);
  });

  it("removes the funnel aggregations module nothing imported", () => {
    assert.equal(existsSync("lib/dashboard/funnel-aggregations.ts"), false);
    assert.equal(
      existsSync("lib/dashboard/__tests__/funnel-aggregations.test.ts"),
      false,
    );
  });

  it("stops claiming a Funnel Planner shell read the override table", () => {
    const claude = readFileSync("CLAUDE.md", "utf8");
    assert.doesNotMatch(claude, /Funnel Planner UI shell/);
    assert.match(claude, /Migration 209/);
    assert.match(claude, /client_funnel_benchmarks/);
  });
});
