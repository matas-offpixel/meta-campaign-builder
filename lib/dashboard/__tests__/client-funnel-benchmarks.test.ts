import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  resolveClientFunnelBenchmarks,
  seedClientFunnelBenchmarks,
} from "../client-funnel-benchmarks.ts";

describe("client funnel benchmarks", () => {
  it("returns seed 15/50/5 with provenance seed when no rows exist", () => {
    const empty = resolveClientFunnelBenchmarks([]);
    const missing = resolveClientFunnelBenchmarks(null);
    for (const set of [empty, missing, seedClientFunnelBenchmarks()]) {
      assert.equal(set.reach_to_click.rate, 0.15);
      assert.equal(set.click_to_lpv.rate, 0.5);
      assert.equal(set.lpv_to_purchase.rate, 0.05);
      assert.equal(set.reach_to_click.provenance, "seed");
      assert.equal(set.click_to_lpv.provenance, "seed");
      assert.equal(set.lpv_to_purchase.provenance, "seed");
    }
  });

  it("overlays a learned stage without inventing the others", () => {
    const set = resolveClientFunnelBenchmarks([
      {
        stage: "click_to_lpv",
        rate: 0.41,
        n: 6,
        confidence: 0.7,
        provenance: "learned",
        updated_at: "2026-08-25T00:00:00.000Z",
      },
    ]);
    assert.equal(set.click_to_lpv.rate, 0.41);
    assert.equal(set.click_to_lpv.provenance, "learned");
    assert.equal(set.click_to_lpv.n, 6);
    assert.equal(set.reach_to_click.provenance, "seed");
    assert.equal(set.lpv_to_purchase.rate, 0.05);
  });

  it("rejects invented learned provenance and out-of-range rates", () => {
    const set = resolveClientFunnelBenchmarks([
      { stage: "reach_to_click", rate: 1.5, provenance: "learned" },
      { stage: "click_to_lpv", rate: 0.4, provenance: "guessed" },
    ]);
    assert.equal(set.reach_to_click.provenance, "seed");
    assert.equal(set.click_to_lpv.provenance, "seed");
  });

  it("migration 158 is a new table, not a rewrite of 060", () => {
    const sql = readFileSync(
      "supabase/migrations/158_client_funnel_benchmarks.sql",
      "utf8",
    );
    assert.match(sql, /create table if not exists client_funnel_benchmarks/);
    assert.match(sql, /'seed', 'learned', 'manually-overridden'/);
    assert.doesNotMatch(sql, /tofu_to_mofu_rate/);
    assert.match(sql, /event_funnel_overrides/);
  });
});
