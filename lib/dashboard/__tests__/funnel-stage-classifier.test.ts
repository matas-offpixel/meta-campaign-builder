import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyCampaignFunnelStage,
  type FunnelStageCampaignLike,
} from "../funnel-stage-classifier.ts";

describe("classifyCampaignFunnelStage", () => {
  it("uses manual stage overrides before name or objective hints", () => {
    assert.equal(
      classifyCampaignFunnelStage({
        name: "[Leeds26-FACUP] PRESALE conversions",
        objective: "OUTCOME_LEADS",
        funnel_stage: "TOFU",
      }),
      "TOFU",
    );
  });

  it("classifies Leeds FA Cup presale and retargeting campaigns as BOFU", () => {
    const campaigns: FunnelStageCampaignLike[] = [
      { name: "[Leeds26-FACUP] PRESALE | Conversions", objective: "OUTCOME_LEADS" },
      { name: "[Leeds26-FACUP] Hot Data Retarget", objective: "OUTCOME_TRAFFIC" },
      { name: "[Leeds26-FACUP] Pre-Sale Conversion", objective: "TRAFFIC" },
    ];

    assert.deepEqual(campaigns.map(classifyCampaignFunnelStage), [
      "BOFU",
      "BOFU",
      "BOFU",
    ]);
  });

  it("classifies Bristol middle and top funnel campaign names", () => {
    const campaigns: FunnelStageCampaignLike[] = [
      { name: "[WC26-BRISTOL] 4TheFans Page Fan", objective: "OUTCOME_AWARENESS" },
      { name: "[WC26-BRISTOL] View Content Traffic", objective: "OUTCOME_TRAFFIC" },
      { name: "[WC26-BRISTOL] TOFU Advantage+ Lookalike", objective: "OUTCOME_TRAFFIC" },
      { name: "[WC26-BRISTOL] Awareness Interests", objective: "OUTCOME_AWARENESS" },
    ];

    assert.deepEqual(campaigns.map(classifyCampaignFunnelStage), [
      "MOFU",
      "MOFU",
      "TOFU",
      "TOFU",
    ]);
  });

  it("falls back from objective and defaults unknown campaigns to MOFU", () => {
    assert.equal(
      classifyCampaignFunnelStage({ name: "Generic campaign", objective: "OUTCOME_SALES" }),
      "BOFU",
    );
    assert.equal(
      classifyCampaignFunnelStage({ name: "Generic campaign", objective: "OUTCOME_TRAFFIC" }),
      "MOFU",
    );
    assert.equal(
      classifyCampaignFunnelStage({ name: "Generic campaign", objective: "OUTCOME_AWARENESS" }),
      "TOFU",
    );
    assert.equal(
      classifyCampaignFunnelStage({ name: "Generic campaign", objective: "ENGAGEMENT" }),
      "MOFU",
    );
  });
});
