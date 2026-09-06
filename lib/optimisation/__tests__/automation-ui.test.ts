import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { optimisationWritesGateState } from "../gates.ts";
import {
  attachAdsetNames,
  armFromFlags,
  flagsFromArm,
  parseAutomationFlagWrite,
  presentDecisionRow,
} from "../automation-ui.ts";

describe("flagsFromArm / armFromFlags", () => {
  it("Off writes both flags false", () => {
    assert.deepEqual(flagsFromArm("off"), { enabled: false, live: false });
    assert.equal(armFromFlags(false, false), "off");
  });

  it("Shadow writes enabled only", () => {
    assert.deepEqual(flagsFromArm("shadow"), { enabled: true, live: false });
    assert.equal(armFromFlags(true, false), "shadow");
  });

  it("Live writes both flags true", () => {
    assert.deepEqual(flagsFromArm("live"), { enabled: true, live: true });
    assert.equal(armFromFlags(true, true), "live");
  });

  it("live without enabled surfaces as Off (three-of-three still dry-runs)", () => {
    assert.equal(armFromFlags(false, true), "off");
  });
});

describe("parseAutomationFlagWrite — writes exactly the two flags", () => {
  it("Off / Shadow never set live true", () => {
    const off = parseAutomationFlagWrite({ arm: "off" });
    const shadow = parseAutomationFlagWrite({ arm: "shadow" });
    assert.equal(off.ok, true);
    assert.equal(shadow.ok, true);
    if (off.ok) {
      assert.deepEqual({ enabled: off.enabled, live: off.live }, { enabled: false, live: false });
    }
    if (shadow.ok) {
      assert.deepEqual(
        { enabled: shadow.enabled, live: shadow.live },
        { enabled: true, live: false },
      );
    }
  });

  it("Live without confirmLive is rejected and does not produce flags", () => {
    const result = parseAutomationFlagWrite({ arm: "live" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "confirm_required");
    }
    assert.equal("enabled" in result, false);
    assert.equal("live" in result, false);
  });

  it("Live with confirmLive: true writes both flags", () => {
    const result = parseAutomationFlagWrite({ arm: "live", confirmLive: true });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        { enabled: result.enabled, live: result.live },
        { enabled: true, live: true },
      );
    }
  });

  it("Off → Live is allowed when confirmed (Shadow-first is not enforced)", () => {
    const result = parseAutomationFlagWrite({ arm: "live", confirmLive: true });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.arm, "live");
  });

  it("rejects an unknown arm", () => {
    const result = parseAutomationFlagWrite({ arm: "maybe" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid");
  });
});

describe("presentDecisionRow — dry-run vs applied", () => {
  const base = {
    decided_at: "2026-08-21T12:00:00.000Z",
    metric: "cpr",
    metric_value: 4.2,
    rule_matched: "CPR above target",
    action_recommended: "scale_down",
    budget_before_pence: 5000,
    budget_after_pence: 4000,
    reason_text: "CPR £4.20 vs target £3.00",
  };

  it("marks a shadow row as dry_run", () => {
    const view = presentDecisionRow({ ...base, applied: false, dry_run: true });
    assert.equal(view.kind, "dry_run");
    assert.equal(view.dryRun, true);
    assert.equal(view.applied, false);
    assert.equal(view.budgetBeforePence, 5000);
    assert.equal(view.budgetAfterPence, 4000);
  });

  it("marks a live write as applied", () => {
    const view = presentDecisionRow({ ...base, applied: true, dry_run: false });
    assert.equal(view.kind, "applied");
    assert.equal(view.applied, true);
    assert.equal(view.dryRun, false);
    assert.equal(view.channel, "meta");
  });

  it("reads channel from the column, then meta_response_json, then defaults to meta", () => {
    assert.equal(
      presentDecisionRow({ ...base, applied: false, dry_run: true, channel: "tiktok" }).channel,
      "tiktok",
    );
    assert.equal(
      presentDecisionRow({
        ...base,
        applied: false,
        dry_run: true,
        meta_response_json: { channel: "google" },
      }).channel,
      "google",
    );
    assert.equal(
      presentDecisionRow({ ...base, applied: false, dry_run: true }).channel,
      "meta",
    );
  });

  it("passes adset_id through and attachAdsetNames resolves the draft name", () => {
    const view = presentDecisionRow({
      ...base,
      applied: false,
      dry_run: true,
      adset_id: "120398",
    });
    assert.equal(view.adsetId, "120398");
    assert.equal(view.adsetName, null);
    const named = attachAdsetNames([view], [
      { id: "local-1", name: "Tech House Pages", metaAdSetId: "120398" },
    ]);
    assert.equal(named[0]!.adsetName, "Tech House Pages");
  });

  it("campaign-scope rows take the campaign name, never the ad-set fallback", () => {
    const view = presentDecisionRow({
      ...base,
      applied: true,
      dry_run: false,
      scope: "campaign",
      campaign_id: "120",
      adset_id: "120",
    });
    assert.equal(view.scope, "campaign");
    const named = attachAdsetNames(
      [view],
      [{ id: "local-1", name: "Some ad set", metaAdSetId: "120" }],
      "[NX26-DOD] DOD - Signup - Artist",
    );
    assert.equal(named[0]!.adsetName, "[NX26-DOD] DOD - Signup - Artist");
  });
});

describe("optimisationWritesGateState — env-gate probe", () => {
  it("reflects exact \"1\" as writesEnabled", () => {
    assert.deepEqual(
      optimisationWritesGateState({ ENABLE_OPTIMISATION_WRITES: "1" }),
      { writesEnabled: true, skippedReason: null },
    );
  });

  it("unset or any other value is killswitch", () => {
    assert.deepEqual(optimisationWritesGateState({}), {
      writesEnabled: false,
      skippedReason: "killswitch",
    });
    assert.deepEqual(
      optimisationWritesGateState({ ENABLE_OPTIMISATION_WRITES: "true" }),
      { writesEnabled: false, skippedReason: "killswitch" },
    );
  });
});
