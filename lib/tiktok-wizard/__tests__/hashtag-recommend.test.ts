import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TIKTOK_HASHTAG_UNAVAILABLE_NOTE,
  tikTokHashtagUnavailableNote,
} from "../hashtag-recommend.ts";

describe("tikTokHashtagUnavailableNote", () => {
  it("surfaces the not-available note for a zero-row hashtag response on a plausible seed", () => {
    assert.equal(
      tikTokHashtagUnavailableNote({
        failed: false,
        rowCount: 0,
        keywords: ["techno"],
      }),
      TIKTOK_HASHTAG_UNAVAILABLE_NOTE,
    );
  });

  it("does not claim the account is gated when the request failed or returned rows", () => {
    assert.equal(
      tikTokHashtagUnavailableNote({
        failed: true,
        rowCount: 0,
        keywords: ["techno"],
      }),
      null,
    );
    assert.equal(
      tikTokHashtagUnavailableNote({
        failed: false,
        rowCount: 3,
        keywords: ["techno"],
      }),
      null,
    );
  });

  it("does not treat a multi-word-only query as an entitlement gap", () => {
    assert.equal(
      tikTokHashtagUnavailableNote({
        failed: false,
        rowCount: 0,
        keywords: ["tech house"],
      }),
      null,
    );
  });

  it("states the empty response as an observation and names both causes", () => {
    assert.match(TIKTOK_HASHTAG_UNAVAILABLE_NOTE, /TikTok returned no hashtag recommendations/);
    assert.match(TIKTOK_HASHTAG_UNAVAILABLE_NOTE, /not enabled on this ad account/);
    assert.match(TIKTOK_HASHTAG_UNAVAILABLE_NOTE, /single-token hashtag index/);
    assert.equal(
      /hashtag targeting may not be enabled on this ad account/.test(
        TIKTOK_HASHTAG_UNAVAILABLE_NOTE,
      ),
      false,
    );
  });
});
