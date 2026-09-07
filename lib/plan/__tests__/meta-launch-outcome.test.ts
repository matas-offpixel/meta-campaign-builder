import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatMetaAdsCountSentence,
  interpretMetaLaunchSummary,
  persistLaunchFailureAdvisory,
  PLAN_LAUNCH_UNRECORDED_ADVISORY,
} from "../meta-launch-outcome.ts";

describe("interpretMetaLaunchSummary", () => {
  it("records zero ads as failed and keeps the platform id", () => {
    const outcome = interpretMetaLaunchSummary({
      metaCampaignId: "120001",
      adsCreated: 0,
      adsFailed: 5,
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.campaignId, "120001");
    assert.equal(outcome.error, "campaign created, 0 of 5 ads — see the log");
    assert.equal(outcome.advisory, undefined);
  });

  it("records a partial ad create as live with the count advisory", () => {
    const outcome = interpretMetaLaunchSummary({
      metaCampaignId: "120002",
      adsCreated: 3,
      adsFailed: 2,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.campaignId, "120002");
    assert.equal(outcome.advisory, "campaign created, 3 of 5 ads — see the log");
    assert.equal(outcome.error, undefined);
  });

  it("records a clean create as live with no advisory", () => {
    const outcome = interpretMetaLaunchSummary({
      metaCampaignId: "120003",
      adsCreated: 5,
      adsFailed: 0,
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.campaignId, "120003");
    assert.equal(outcome.advisory, undefined);
    assert.equal(outcome.error, undefined);
  });
});

describe("persist launch failure", () => {
  it("names the unrecorded write in the operator's words", () => {
    assert.equal(
      persistLaunchFailureAdvisory({ status: "live", platformCampaignId: "120001" }),
      PLAN_LAUNCH_UNRECORDED_ADVISORY,
    );
    assert.equal(
      persistLaunchFailureAdvisory({ status: "failed", platformCampaignId: "120001" }),
      PLAN_LAUNCH_UNRECORDED_ADVISORY,
    );
    assert.equal(
      persistLaunchFailureAdvisory({ status: "launching", platformCampaignId: null }),
      null,
    );
    assert.equal(PLAN_LAUNCH_UNRECORDED_ADVISORY, "launched, but not recorded here — tell Matas");
    assert.equal(formatMetaAdsCountSentence(0, 5), "campaign created, 0 of 5 ads — see the log");
  });
});
