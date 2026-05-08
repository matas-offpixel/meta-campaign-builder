import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shouldQueueThumbnailWarmAfterRollupSync } from "../thumbnail-warm-after-rollup-sync.ts";

describe("shouldQueueThumbnailWarmAfterRollupSync", () => {
  it("queues when Meta ok and identifiers present", () => {
    assert.equal(
      shouldQueueThumbnailWarmAfterRollupSync({
        metaOk: true,
        adAccountId: "123",
        eventCode: "VENUE_X",
      }),
      true,
    );
  });

  it("does not queue when Meta leg failed", () => {
    assert.equal(
      shouldQueueThumbnailWarmAfterRollupSync({
        metaOk: false,
        adAccountId: "123",
        eventCode: "VENUE_X",
      }),
      false,
    );
  });

  it("does not queue without ad account", () => {
    assert.equal(
      shouldQueueThumbnailWarmAfterRollupSync({
        metaOk: true,
        adAccountId: null,
        eventCode: "VENUE_X",
      }),
      false,
    );
  });

  it("does not queue without event code", () => {
    assert.equal(
      shouldQueueThumbnailWarmAfterRollupSync({
        metaOk: true,
        adAccountId: "123",
        eventCode: null,
      }),
      false,
    );
  });
});
