import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  venueSpend,
  type VenueSpendGroup,
} from "../venue-spend-model.ts";

function group(campaignSpend: number | null): VenueSpendGroup {
  return {
    city: null,
    campaignSpend,
    eventCount: 1,
    events: [{ id: "event-1" }],
  };
}

describe("venueSpend rollup fallback", () => {
  it("uses rollup spend when Meta cached spend is 0 and rollup paid spend is positive", () => {
    const spend = venueSpend(
      group(0),
      null,
      new Map(),
      new Map([["event-1", 160]]),
    );

    assert.equal(spend.kind, "rollup");
    assert.equal(spend.venuePaidMedia, 160);
  });

  it("keeps split behaviour when Meta cached spend is 0 and rollup spend is also 0", () => {
    const spend = venueSpend(
      group(0),
      null,
      new Map(),
      new Map([["event-1", 0]]),
    );

    assert.equal(spend.kind, "split");
    assert.equal(spend.perEventTotal, 0);
  });

  it("does not override a positive Meta cached spend with rollup spend", () => {
    const spend = venueSpend(
      group(250),
      null,
      new Map(),
      new Map([["event-1", 160]]),
    );

    assert.equal(spend.kind, "split");
    assert.equal(spend.perEventTotal, 250);
  });
});
