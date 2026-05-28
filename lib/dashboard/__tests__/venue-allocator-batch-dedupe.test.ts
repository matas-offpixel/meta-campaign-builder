import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  markVenueAllocatorBatchComplete,
  shouldSkipVenueAllocatorBatch,
  venueAllocatorDedupeKey,
  VENUE_ALLOCATOR_ALREADY_RAN,
} from "../venue-allocator-batch-dedupe.ts";

describe("venueAllocatorBatchDedupe", () => {
  it("builds a stable (client_id, event_code) key", () => {
    assert.equal(
      venueAllocatorDedupeKey("client-1", "WC26-BRIGHTON"),
      "client-1\u0000WC26-BRIGHTON",
    );
  });

  it("invokes allocator once per event_code across multi-fixture batch", () => {
    const completed = new Set<string>();
    const clientId = "37906506-56b7-4d58-ab62-1b042e2b561a";
    const eventCode = "WC26-BRIGHTON";
    const fixtures = ["fix-1", "fix-2", "fix-3", "fix-4"];
    let invokeCount = 0;

    for (const _fixtureId of fixtures) {
      if (
        shouldSkipVenueAllocatorBatch(clientId, eventCode, completed)
      ) {
        continue;
      }
      invokeCount += 1;
      markVenueAllocatorBatchComplete(clientId, eventCode, completed, true);
    }

    assert.equal(invokeCount, 1);
    assert.equal(completed.size, 1);
    assert.equal(
      completed.has(venueAllocatorDedupeKey(clientId, eventCode)),
      true,
    );
  });

  it("does not mark complete when allocator soft-fails so a later fixture can retry", () => {
    const completed = new Set<string>();
    const clientId = "client-1";
    const eventCode = "WC26-EDINBURGH";

    markVenueAllocatorBatchComplete(clientId, eventCode, completed, false);
    assert.equal(completed.size, 0);
    assert.equal(
      shouldSkipVenueAllocatorBatch(clientId, eventCode, completed),
      false,
    );
  });

  it("skips dedupe when no batch set is provided (single-event sync)", () => {
    assert.equal(
      shouldSkipVenueAllocatorBatch("client-1", "WC26-EDINBURGH", undefined),
      false,
    );
  });

  it("exports the skip reason constant for log parity", () => {
    assert.equal(VENUE_ALLOCATOR_ALREADY_RAN, "already_ran_this_batch");
  });
});
