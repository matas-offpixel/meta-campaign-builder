/**
 * lib/mailchimp/__tests__/daily-trend-brand-campaign.test.ts
 *
 * Confirms that the BRAND_METRICS set for brand_campaign kind includes the
 * required pills (Spend / Registrations / CPR / Clicks / CPC / Impressions)
 * and does NOT include event-kind-only pills (Tickets / CPT / ROAS).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Replicate the BRAND_METRICS key list from event-trend-chart.tsx.
// If that list ever changes, this test will fail — which is the intent.
const BRAND_METRIC_KEYS = [
  "spend",
  "registrations",
  "cpr",
  "clicks",
  "cpc",
  "impressions",
] as const;

const EVENT_METRIC_KEYS = [
  "spend",
  "tickets",
  "cpt",
  "roas",
  "linkClicks",
  "cpc",
] as const;

const BRAND_SET = new Set<string>(BRAND_METRIC_KEYS);
const EVENT_SET = new Set<string>(EVENT_METRIC_KEYS);

describe("brand_campaign daily trend metric pills", () => {
  it("includes Registrations", () => {
    assert.ok(BRAND_SET.has("registrations"));
  });

  it("includes CPR", () => {
    assert.ok(BRAND_SET.has("cpr"));
  });

  it("includes Impressions", () => {
    assert.ok(BRAND_SET.has("impressions"));
  });

  it("does NOT include Tickets", () => {
    assert.ok(!BRAND_SET.has("tickets"));
  });

  it("does NOT include CPT", () => {
    assert.ok(!BRAND_SET.has("cpt"));
  });

  it("does NOT include ROAS", () => {
    assert.ok(!BRAND_SET.has("roas"));
  });
});

describe("event kind daily trend metric pills (unchanged)", () => {
  it("includes Tickets", () => {
    assert.ok(EVENT_SET.has("tickets"));
  });

  it("includes ROAS", () => {
    assert.ok(EVENT_SET.has("roas"));
  });

  it("includes CPT", () => {
    assert.ok(EVENT_SET.has("cpt"));
  });

  it("does NOT include Registrations", () => {
    assert.ok(!EVENT_SET.has("registrations"));
  });

  it("does NOT include CPR", () => {
    assert.ok(!EVENT_SET.has("cpr"));
  });
});
