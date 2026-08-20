/**
 * 8-row truth table for optimisationDryRunGates (task #120 PR B).
 *
 * Run: node --test lib/optimisation/__tests__/gates.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOptimisationWritesEnabledFromEnv,
  optimisationDryRunGates,
} from "../gates.ts";

describe("optimisationDryRunGates — 8-row truth table", () => {
  const rows: Array<{
    writes: boolean;
    enabled: boolean;
    live: boolean;
    dryRun: boolean;
    reason: string | null;
  }> = [
    { writes: false, enabled: false, live: false, dryRun: true, reason: "writes_killswitch" },
    { writes: false, enabled: false, live: true, dryRun: true, reason: "writes_killswitch" },
    { writes: false, enabled: true, live: false, dryRun: true, reason: "writes_killswitch" },
    { writes: false, enabled: true, live: true, dryRun: true, reason: "writes_killswitch" },
    { writes: true, enabled: false, live: false, dryRun: true, reason: "not_enabled" },
    { writes: true, enabled: false, live: true, dryRun: true, reason: "not_enabled" },
    { writes: true, enabled: true, live: false, dryRun: true, reason: "not_live" },
    { writes: true, enabled: true, live: true, dryRun: false, reason: null },
  ];

  for (const row of rows) {
    it(`writes=${row.writes} enabled=${row.enabled} live=${row.live} → dryRun=${row.dryRun} reason=${row.reason}`, () => {
      const g = optimisationDryRunGates(row.writes, row.enabled, row.live);
      assert.equal(g.dryRun, row.dryRun);
      assert.equal(g.reason, row.reason);
    });
  }
});

describe("isOptimisationWritesEnabledFromEnv", () => {
  it("is true only for exact \"1\"", () => {
    assert.equal(isOptimisationWritesEnabledFromEnv({ ENABLE_OPTIMISATION_WRITES: "1" }), true);
    assert.equal(isOptimisationWritesEnabledFromEnv({ ENABLE_OPTIMISATION_WRITES: "true" }), false);
    assert.equal(isOptimisationWritesEnabledFromEnv({ ENABLE_OPTIMISATION_WRITES: "0" }), false);
    assert.equal(isOptimisationWritesEnabledFromEnv({}), false);
  });
});
