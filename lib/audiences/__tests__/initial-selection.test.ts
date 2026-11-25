/**
 * The audience builder's start from its URL, and the template tab's link to
 * it for video viewers (built, not drawn until design rules).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HOUSE_DISCO } from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import { videoViewersBuilderHref } from "../../audience-templates/view.ts";
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

describe("videoViewersBuilderHref", () => {
  it("opens the builder on Video views at the item's threshold and days", () => {
    const video = HOUSE_DISCO.items.find((i) => i.listRole === "video_viewers")!;
    assert.equal(videoViewersBuilderHref("c1", video), "/audiences/c1/new?subtype=video_views&threshold=50&retention=30");
  });
  it("only for video viewers", () => {
    for (const i of HOUSE_DISCO.items.filter((x) => x.listRole !== "video_viewers")) assert.equal(videoViewersBuilderHref("c1", i), null);
  });
  it("isn't drawn yet: the panel doesn't use it", async () => {
    const { readFileSync } = await import("node:fs");
    const panel = readFileSync(new URL("../../../components/audience-templates/audience-templates-panel.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(panel, /videoViewersBuilderHref|audienceBuilderHref/);
  });
});
