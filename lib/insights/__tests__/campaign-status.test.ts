import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  campaignStatusLabel,
  campaignStatusTone,
  normaliseMetaCampaignStatus,
} from "../campaign-status.ts";

test("normaliseMetaCampaignStatus maps Meta effective_status values", () => {
  const cases: Array<{
    effectiveStatus: string;
    expected: string;
  }> = [
    { effectiveStatus: "ACTIVE", expected: "ACTIVE" },
    { effectiveStatus: "PAUSED", expected: "PAUSED" },
    { effectiveStatus: "CAMPAIGN_PAUSED", expected: "PAUSED" },
    { effectiveStatus: "DISAPPROVED", expected: "ARCHIVED" },
    { effectiveStatus: "ARCHIVED", expected: "ARCHIVED" },
    { effectiveStatus: "DELETED", expected: "ARCHIVED" },
    { effectiveStatus: "PENDING_REVIEW", expected: "WITH_ISSUES" },
    { effectiveStatus: "IN_PROCESS", expected: "WITH_ISSUES" },
    { effectiveStatus: "WITH_ISSUES", expected: "WITH_ISSUES" },
    { effectiveStatus: "ADSET_PAUSED", expected: "NOT_DELIVERING" },
    { effectiveStatus: "NOT_DELIVERING", expected: "NOT_DELIVERING" },
  ];

  for (const { effectiveStatus, expected } of cases) {
    assert.equal(
      normaliseMetaCampaignStatus({ effectiveStatus, status: "ACTIVE" }),
      expected,
      effectiveStatus,
    );
  }
});

test("normaliseMetaCampaignStatus treats effective_status as source of truth", () => {
  assert.equal(
    normaliseMetaCampaignStatus({
      status: "ACTIVE",
      effectiveStatus: "ADSET_PAUSED",
    }),
    "NOT_DELIVERING",
  );
});

test("campaign status presentation renders NOT_DELIVERING as grey label", () => {
  assert.equal(campaignStatusLabel("NOT_DELIVERING"), "not delivering");
  assert.match(campaignStatusTone("NOT_DELIVERING"), /\bbg-muted\b/);
  assert.match(campaignStatusTone("WITH_ISSUES"), /\borange\b/);
});
