import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runWithConcurrency } from "../run-with-concurrency.ts";

// ─── runWithConcurrency unit tests ────────────────────────────────────────────

describe("runWithConcurrency", () => {
  it("empty items → returns empty array without calling fn", async () => {
    let called = false;
    const result = await runWithConcurrency([], 3, async () => {
      called = true;
      return 0;
    });
    assert.deepEqual(result, []);
    assert.equal(called, false);
  });

  it("single item works correctly (limit=1 effectively)", async () => {
    const result = await runWithConcurrency(["a"], 3, async (x) => x + "!");
    assert.deepEqual(result, ["a!"]);
  });

  it("results are in the same order as items regardless of completion order", async () => {
    // Items complete in reverse order (item 0 is slowest)
    const delays = [30, 20, 10, 5, 1];
    const result = await runWithConcurrency(delays, 5, (delay) =>
      new Promise<number>((resolve) => setTimeout(() => resolve(delay), delay)),
    );
    assert.deepEqual(result, delays);
  });

  it("concurrency bound: at no point are more than `limit` tasks in-flight", async () => {
    const limit = 3;
    let inflight = 0;
    let maxInflight = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);

    await runWithConcurrency(items, limit, async (item) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      inflight--;
      return item * 2;
    });

    assert.ok(
      maxInflight <= limit,
      `max in-flight was ${maxInflight}, expected ≤ ${limit}`,
    );
  });

  it("concurrency=3 on 5 items completes in ~ceil(5/3) × per-item delay, not 5 × delay", async () => {
    const DELAY_MS = 20;
    const items = Array.from({ length: 5 }, (_, i) => i);
    const start = Date.now();

    await runWithConcurrency(items, 3, () =>
      new Promise<void>((resolve) => setTimeout(resolve, DELAY_MS)),
    );

    const elapsed = Date.now() - start;
    // ceil(5/3)=2 batches → ~2 * DELAY_MS. Allow generous 4× for CI jitter.
    const expectedMax = 4 * DELAY_MS * Math.ceil(items.length / 3);
    assert.ok(
      elapsed < expectedMax,
      `elapsed ${elapsed}ms should be < ${expectedMax}ms (would be ~${5 * DELAY_MS}ms sequential)`,
    );
  });

  it("throws immediately if any fn throws (error propagates)", async () => {
    const items = ["ok1", "bad", "ok2", "ok3", "ok4"];
    await assert.rejects(
      () =>
        runWithConcurrency(items, 3, async (item) => {
          if (item === "bad")
            throw new Error("Campaign bad does not belong to this client");
          return item;
        }),
      /does not belong/,
    );
  });

  it("limit capped at items.length (no extra workers spawn)", async () => {
    let maxInflight = 0;
    let inflight = 0;
    const items = [1, 2];

    await runWithConcurrency(items, 10, async (item) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      inflight--;
      return item;
    });

    assert.ok(
      maxInflight <= items.length,
      `expected max in-flight ≤ ${items.length}, got ${maxInflight}`,
    );
  });
});

// ─── Structural smoke tests for sources.ts ───────────────────────────────────

describe("fetchAudienceMultiCampaignVideos parallelism structure", () => {
  it("sources.ts uses runWithConcurrency with CAMPAIGN_WALK_CONCURRENCY=3", async () => {
    const { readFileSync } = await import("node:fs");
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");

    assert.match(sources, /CAMPAIGN_WALK_CONCURRENCY.*=.*3/);
    assert.match(sources, /runWithConcurrency/);
    assert.match(sources, /walkCampaignAds/);
    // Sequential for-loop over campaignIds is gone
    assert.doesNotMatch(sources, /for.*const campaignId of campaignIds/);
  });

  it("walkCampaignAds performs ownership check and paginates ads", async () => {
    const { readFileSync } = await import("node:fs");
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");

    assert.match(sources, /async function walkCampaignAds/);
    // Ownership check still present in walkCampaignAds
    assert.match(sources, /does not belong to this client/);
    // Per-campaign ad paging uses MAX_AD_PAGES guard
    assert.match(sources, /for.*adPage.*MAX_AD_PAGES/s);
    // Extracts all three creative page-ID shapes
    assert.match(sources, /object_story_spec.*page_id|page_id.*object_story_spec/s);
    assert.match(sources, /platform_customizations/);
    assert.match(sources, /asset_feed_spec/);
  });

  it("route.ts has maxDuration=120", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync(
      "app/api/audiences/sources/multi-campaign-videos/route.ts",
      "utf8",
    );
    assert.match(route, /maxDuration\s*=\s*120/);
  });
});
