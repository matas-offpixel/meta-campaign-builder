/**
 * Unit tests for assertSameObjective — the GOAL 1 pre-flight check that
 * ensures all campaigns selected in multi-campaign attach mode share the
 * same objective before launching.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertSameObjective } from "../attach-objective.ts";
import type { ExistingMetaCampaignSnapshot } from "@/lib/types";

function snap(name: string, objective: string): ExistingMetaCampaignSnapshot {
  return {
    id: `camp_${name.replace(/\s/g, "_")}`,
    name,
    objective,
    status: "ACTIVE",
    capturedAt: new Date().toISOString(),
  };
}

describe("assertSameObjective", () => {
  it("returns ok:true for an empty list", () => {
    const result = assertSameObjective([]);
    assert.equal(result.ok, true);
  });

  it("returns ok:true for a single campaign", () => {
    const result = assertSameObjective([snap("Camp A", "OUTCOME_SALES")]);
    assert.equal(result.ok, true);
  });

  it("returns ok:true when all campaigns share the same objective", () => {
    const result = assertSameObjective([
      snap("Hackney Traffic 18-34", "LINK_CLICKS"),
      snap("Soho Traffic 18-34", "LINK_CLICKS"),
      snap("Camden Traffic 18-34", "LINK_CLICKS"),
    ]);
    assert.equal(result.ok, true);
  });

  it("returns ok:false with correct names when Purchase + Traffic are mixed", () => {
    const result = assertSameObjective([
      snap("Hackney Purchase", "OUTCOME_SALES"),
      snap("Hackney Traffic 35+", "LINK_CLICKS"),
      snap("Hackney Traffic 18-34", "LINK_CLICKS"),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.campaignA, "Hackney Purchase");
      assert.equal(result.campaignB, "Hackney Traffic 35+");
      assert.equal(result.objA, "OUTCOME_SALES");
      assert.equal(result.objB, "LINK_CLICKS");
    }
  });

  it("names the FIRST conflicting pair, not just any pair", () => {
    // All Traffic except the last one — conflict is between index 0 and 3.
    const result = assertSameObjective([
      snap("Camp Traffic 1", "LINK_CLICKS"),
      snap("Camp Traffic 2", "LINK_CLICKS"),
      snap("Camp Traffic 3", "LINK_CLICKS"),
      snap("Camp Purchase", "OUTCOME_SALES"),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.campaignA, "Camp Traffic 1");
      assert.equal(result.campaignB, "Camp Purchase");
    }
  });

  it("returns ok:true for two campaigns with the same objective", () => {
    const result = assertSameObjective([
      snap("Hackney Traffic 35+", "LINK_CLICKS"),
      snap("Soho Traffic 35+", "LINK_CLICKS"),
    ]);
    assert.equal(result.ok, true);
  });

  it("treats different objective strings as conflicting even if they map to the same internal type", () => {
    // OUTCOME_TRAFFIC vs LINK_CLICKS are both "traffic" internally,
    // but their raw strings differ — assert raw-string comparison.
    const result = assertSameObjective([
      snap("Camp A", "OUTCOME_TRAFFIC"),
      snap("Camp B", "LINK_CLICKS"),
    ]);
    assert.equal(result.ok, false);
  });
});
