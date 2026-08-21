import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultOptimisationGoalForObjective,
  ensureTikTokCampaignNamePrefix,
  isRetiredTikTokObjective,
  stripLockedEventCodePrefix,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
  tikTokOptimisationGoalLabel,
  validOptimisationGoalForObjective,
} from "../campaign-setup.ts";

describe("TikTok campaign setup helpers", () => {
  it("locks the event_code prefix without duplicating it", () => {
    assert.equal(
      ensureTikTokCampaignNamePrefix("BB26-RIANBRAZIL", "Prospecting"),
      "[BB26-RIANBRAZIL] Prospecting",
    );
    assert.equal(
      ensureTikTokCampaignNamePrefix(
        "BB26-RIANBRAZIL",
        "[BB26-RIANBRAZIL] Prospecting",
      ),
      "[BB26-RIANBRAZIL] Prospecting",
    );
    assert.equal(
      stripLockedEventCodePrefix(
        "BB26-RIANBRAZIL",
        "[BB26-RIANBRAZIL] Prospecting",
      ),
      "Prospecting",
    );
  });

  it("cross-validates objective and optimisation goal", () => {
    assert.equal(validOptimisationGoalForObjective("TRAFFIC", "CLICK"), true);
    assert.equal(
      validOptimisationGoalForObjective("TRAFFIC", "CONVERSION"),
      false,
    );
    assert.deepEqual(TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE.CONVERSIONS, [
      "CONVERSION",
      "VALUE",
    ]);
    assert.deepEqual(TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE.LEAD_GENERATION, [
      "CONVERSION",
    ]);
    assert.equal(
      validOptimisationGoalForObjective("LEAD_GENERATION", "CONVERSION"),
      true,
    );
    assert.equal(
      validOptimisationGoalForObjective("LEAD_GENERATION", "VALUE"),
      false,
    );
    assert.equal(defaultOptimisationGoalForObjective("LEAD_GENERATION"), "CONVERSION");
    assert.equal(defaultOptimisationGoalForObjective("VIDEO_VIEWS"), "VIDEO_VIEW");
    assert.equal(isRetiredTikTokObjective("CONVERSIONS"), true);
    assert.equal(isRetiredTikTokObjective("LEAD_GENERATION"), false);
    assert.equal(tikTokOptimisationGoalLabel("CONVERSION", "LEAD_GENERATION"), "Leads");
    assert.equal(tikTokOptimisationGoalLabel("CONVERSION", "CONVERSIONS"), "Conversion");
  });
});
