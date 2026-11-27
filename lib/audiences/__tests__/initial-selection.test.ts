/**
 * The audience builder's start from its URL.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { audienceBuilderHref, initialSelectionFrom } from "../initial-selection.ts";

describe("initialSelectionFrom", () => {
  it("reads a known subtype, threshold and days", () => {
    assert.deepEqual(initialSelectionFrom({ subtype: "video_views", threshold: "50", retention: "30" }), { subtype: "video_views", threshold: 50, retentionDays: 30 });
  });
  it("ignores anything else: the builder starts as it always has", () => {
    assert.deepEqual(initialSelectionFrom({}), {});
    assert.deepEqual(initialSelectionFrom({ subtype: "customer_list", threshold: "60", retention: "400" }), {});
    assert.deepEqual(initialSelectionFrom({ retention: "1.5" }), {});
  });
  it("round-trips through the URL", () => {
    const href = audienceBuilderHref("c1", { subtype: "video_views", threshold: 75, retentionDays: 60 });
    assert.equal(href, "/audiences/c1/new?subtype=video_views&threshold=75&retention=60");
    const q = Object.fromEntries(new URL(href, "https://x").searchParams);
    assert.deepEqual(initialSelectionFrom(q), { subtype: "video_views", threshold: 75, retentionDays: 60 });
  });
});
