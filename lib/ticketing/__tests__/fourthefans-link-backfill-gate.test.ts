import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Mirrors the POST `/api/ticketing/links` guard — keep in sync when editing the route.
 */
function shouldTriggerFourthefansHistoryBackfill(provider: string): boolean {
  return provider === "fourthefans";
}

describe("fourthefans history backfill on new ticketing link", () => {
  it("fires only for fourthefans connections", () => {
    assert.equal(shouldTriggerFourthefansHistoryBackfill("fourthefans"), true);
    assert.equal(shouldTriggerFourthefansHistoryBackfill("eventbrite"), false);
    assert.equal(shouldTriggerFourthefansHistoryBackfill("manual"), false);
  });
});
