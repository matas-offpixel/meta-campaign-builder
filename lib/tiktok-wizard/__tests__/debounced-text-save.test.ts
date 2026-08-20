import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  applyTikTokCampaignSetupPatch,
  createDebouncedCallback,
  TIKTOK_TEXT_SAVE_DEBOUNCE_MS,
  tikTokTextFieldDisabledWhileSaving,
} from "../debounced-text-save.ts";

describe("TikTok campaign-name save", () => {
  it("debounces rapid changes to one save of the last value and never disables the input", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const saves: string[] = [];
    let latest = "";
    const debounced = createDebouncedCallback(() => {
      saves.push(latest);
    }, TIKTOK_TEXT_SAVE_DEBOUNCE_MS);

    for (const next of ["H", "He", "Hel", "Hell", "Hello"]) {
      latest = next;
      debounced.schedule();
      assert.equal(tikTokTextFieldDisabledWhileSaving(true), false);
    }

    mock.timers.tick(TIKTOK_TEXT_SAVE_DEBOUNCE_MS - 1);
    assert.deepEqual(saves, []);
    mock.timers.tick(1);
    assert.deepEqual(saves, ["Hello"]);
    mock.timers.reset();
  });

  it("builds overlapping saves from the latest ref, not a stale closure", () => {
    let latest = createDefaultTikTokDraft("draft-1");
    latest.campaignSetup.campaignName = "[EVT] Old";
    latest.campaignSetup.objective = "TRAFFIC";

    const afterName = applyTikTokCampaignSetupPatch(latest, {
      campaignName: "[EVT] Hello",
    });
    latest = afterName;

    const afterObjective = applyTikTokCampaignSetupPatch(latest, {
      objective: "CONVERSIONS",
    });

    assert.equal(afterObjective.campaignSetup.campaignName, "[EVT] Hello");
    assert.equal(afterObjective.campaignSetup.objective, "CONVERSIONS");

    const staleSecond = applyTikTokCampaignSetupPatch(
      createDefaultTikTokDraft("draft-1"),
      { objective: "CONVERSIONS" },
    );
    assert.notEqual(staleSecond.campaignSetup.campaignName, "[EVT] Hello");
  });
});
