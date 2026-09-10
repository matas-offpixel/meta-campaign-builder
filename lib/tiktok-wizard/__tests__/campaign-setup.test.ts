import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  defaultOptimisationGoalForObjective,
  ensureTikTokCampaignNamePrefix,
  isAwarenessTikTokObjective,
  isTikTokSalesObjective,
  stripLockedEventCodePrefix,
  TIKTOK_OBJECTIVE_LABELS,
  TIKTOK_OBJECTIVES,
  TIKTOK_OPTIMISATION_GOALS_BY_OBJECTIVE,
  tikTokAwarenessReplacementMessage,
  tikTokObjectivePickerValues,
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
    assert.equal(tikTokOptimisationGoalLabel("CONVERSION", "LEAD_GENERATION"), "Leads");
    assert.equal(tikTokOptimisationGoalLabel("CONVERSION", "CONVERSIONS"), "Conversion");
  });

  it("labels CONVERSIONS as Sales and ENGAGEMENT as Community interaction", () => {
    assert.equal(TIKTOK_OBJECTIVE_LABELS.CONVERSIONS, "Sales");
    assert.equal(TIKTOK_OBJECTIVE_LABELS.ENGAGEMENT, "Community interaction");
    assert.equal(isTikTokSalesObjective("CONVERSIONS"), true);
    assert.equal(isTikTokSalesObjective("LEAD_GENERATION"), false);
  });

  it("does not offer AWARENESS; an existing draft still loads with a Reach blocker", () => {
    assert.equal(TIKTOK_OBJECTIVES.includes("AWARENESS"), false);
    assert.deepEqual(tikTokObjectivePickerValues("TRAFFIC"), TIKTOK_OBJECTIVES);
    assert.equal(tikTokObjectivePickerValues("AWARENESS").includes("AWARENESS"), true);
    assert.equal(isAwarenessTikTokObjective("AWARENESS"), true);
    assert.match(tikTokAwarenessReplacementMessage(), /Reach/);
    const src = readFileSync("components/tiktok-wizard/steps/campaign-setup.tsx", "utf8");
    assert.match(src, /tikTokAwarenessReplacementMessage/);
    assert.doesNotMatch(src, /isRetiredTikTokObjective|Conversions is retired/);
  });
});
