import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createDefaultTikTokDraft } from "../../types/tiktok-draft.ts";
import {
  applyTikTokCampaignSetupPatch,
  createDebouncedCallback,
  TIKTOK_TEXT_SAVE_DEBOUNCE_MS,
} from "../debounced-text-save.ts";

describe("TikTok campaign-name save", () => {
  it("debounces rapid changes to one save of the last value", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const saves: string[] = [];
    let latest = "";
    const debounced = createDebouncedCallback(() => {
      saves.push(latest);
    }, TIKTOK_TEXT_SAVE_DEBOUNCE_MS);

    for (const next of ["H", "He", "Hel", "Hell", "Hello"]) {
      latest = next;
      debounced.schedule();
    }

    mock.timers.tick(TIKTOK_TEXT_SAVE_DEBOUNCE_MS - 1);
    assert.deepEqual(saves, []);
    mock.timers.tick(1);
    assert.deepEqual(saves, ["Hello"]);
    mock.timers.reset();
  });

  it("flushes a pending name save on unmount instead of discarding it", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const saves: string[] = [];
    let latest = "";
    const debounced = createDebouncedCallback(() => {
      saves.push(latest);
    }, TIKTOK_TEXT_SAVE_DEBOUNCE_MS);

    latest = "Hello";
    debounced.schedule();
    mock.timers.tick(TIKTOK_TEXT_SAVE_DEBOUNCE_MS - 1);
    assert.deepEqual(saves, []);

    // Component unmount: flush, do not cancel.
    debounced.flush();
    assert.deepEqual(saves, ["Hello"]);

    mock.timers.tick(TIKTOK_TEXT_SAVE_DEBOUNCE_MS);
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

  it("a draft changed from outside is what the next patch builds on", () => {
    const draftRef = { current: createDefaultTikTokDraft("draft-1") };
    draftRef.current.campaignSetup.campaignName = "[EVT] Typed locally";
    draftRef.current.campaignSetup.objective = "TRAFFIC";

    const fromOutside = createDefaultTikTokDraft("draft-1");
    fromOutside.campaignSetup.campaignName = "[EVT] Typed locally";
    fromOutside.campaignSetup.objective = "CONVERSIONS";
    fromOutside.campaignSetup.optimisationGoal = "CONVERSION";
    // Render-body assign — not gated on draft.id.
    draftRef.current = fromOutside;

    const next = applyTikTokCampaignSetupPatch(draftRef.current, {
      campaignName: "[EVT] After outside change",
    });
    assert.equal(next.campaignSetup.campaignName, "[EVT] After outside change");
    assert.equal(next.campaignSetup.objective, "CONVERSIONS");
    assert.equal(next.campaignSetup.optimisationGoal, "CONVERSION");
  });
});
