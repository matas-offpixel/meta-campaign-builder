import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  applyCampaignDeliveryHeuristic,
  campaignStatusReasonLabel,
  campaignStatusLabel,
  campaignStatusTone,
  normaliseMetaCampaignStatus,
  sortCampaignsByStatusThenSpend,
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

test("delivery heuristic keeps ACTIVE when impressions exist today", () => {
  assert.deepEqual(
    applyCampaignDeliveryHeuristic({
      status: "ACTIVE",
      lifetimeImpressions: 500,
      impressionsLast24h: 12,
    }),
    { status: "ACTIVE" },
  );
});

test("delivery heuristic marks established ACTIVE campaigns with no 24h delivery", () => {
  assert.deepEqual(
    applyCampaignDeliveryHeuristic({
      status: "ACTIVE",
      lifetimeImpressions: 500,
      impressionsLast24h: 0,
    }),
    { status: "NOT_DELIVERING", reason: "no_delivery_24h" },
  );
  assert.equal(
    campaignStatusReasonLabel("no_delivery_24h"),
    "(no delivery in 24h)",
  );
});

test("delivery heuristic keeps brand-new ACTIVE campaigns active", () => {
  assert.deepEqual(
    applyCampaignDeliveryHeuristic({
      status: "ACTIVE",
      lifetimeImpressions: 0,
      impressionsLast24h: 0,
    }),
    { status: "ACTIVE" },
  );
});

test("delivery heuristic leaves PAUSED and WITH_ISSUES statuses unchanged", () => {
  assert.deepEqual(
    applyCampaignDeliveryHeuristic({
      status: "PAUSED",
      lifetimeImpressions: 500,
      impressionsLast24h: 0,
    }),
    { status: "PAUSED" },
  );
  assert.deepEqual(
    applyCampaignDeliveryHeuristic({
      status: "WITH_ISSUES",
      lifetimeImpressions: 500,
      impressionsLast24h: 0,
    }),
    { status: "WITH_ISSUES" },
  );
});

test("sortCampaignsByStatusThenSpend renders ACTIVE before PAUSED, spend within groups", () => {
  const rows = [
    { id: "paused-high", status: "PAUSED", spend: 900 },
    { id: "active-low", status: "ACTIVE", spend: 100 },
    { id: "not-delivering-high", status: "NOT_DELIVERING", spend: 800 },
    { id: "active-high", status: "ACTIVE", spend: 300 },
    { id: "paused-low", status: "PAUSED", spend: 50 },
    { id: "issues", status: "WITH_ISSUES", spend: 200 },
    { id: "archived", status: "ARCHIVED", spend: 700 },
    { id: "unknown", status: "UNKNOWN", spend: 1000 },
  ];

  assert.deepEqual(
    sortCampaignsByStatusThenSpend(rows).map((row) => row.id),
    [
      "active-high",
      "active-low",
      "issues",
      "not-delivering-high",
      "paused-high",
      "paused-low",
      "archived",
      "unknown",
    ],
  );
});
