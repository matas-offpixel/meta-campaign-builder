import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultOptimisationGoalForObjective,
  ensureTikTokCampaignNamePrefix,
  stripLockedEventCodePrefix,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
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
    assert.equal(defaultOptimisationGoalForObjective("VIDEO_VIEWS"), "VIDEO_VIEW");
  });
});
