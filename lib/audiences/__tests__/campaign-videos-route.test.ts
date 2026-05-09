import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("multi-campaign-videos source endpoint", () => {
  it("route exists and uses fetchAudienceMultiCampaignVideos", () => {
    const route = readFileSync(
      "app/api/audiences/sources/multi-campaign-videos/route.ts",
      "utf8",
    );
    assert.match(route, /fetchAudienceMultiCampaignVideos/);
    assert.match(route, /clientId.*campaignIds/s);
    assert.match(route, /split.*",".*filter/s);
  });

  it("route validates MAX_CAMPAIGN_IDS guard", () => {
    const route = readFileSync(
      "app/api/audiences/sources/multi-campaign-videos/route.ts",
      "utf8",
    );
    assert.match(route, /MAX_CAMPAIGN_IDS/);
    assert.match(route, /status.*400/s);
  });

  it("route caches with sorted campaign IDs so order doesn't matter", () => {
    const route = readFileSync(
      "app/api/audiences/sources/multi-campaign-videos/route.ts",
      "utf8",
    );
    assert.match(route, /sort\(\)/);
    assert.match(route, /getCachedAudienceSource/);
  });

  it("sources.ts fetchAudienceMultiCampaignVideos dedupes video IDs across campaigns", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(sources, /fetchAudienceMultiCampaignVideos/);
    // Accumulates into a single shared Set across all campaigns
    assert.match(sources, /allVideoIds\.add/);
    // Walks campaigns concurrently via runWithConcurrency
    assert.match(sources, /runWithConcurrency/);
    assert.match(sources, /CAMPAIGN_WALK_CONCURRENCY/);
  });

  it("sources.ts uses concurrent ad walk + batched video metadata fetch", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    // Concurrent campaign walk bounded at CAMPAIGN_WALK_CONCURRENCY=3
    assert.match(sources, /CAMPAIGN_WALK_CONCURRENCY/);
    assert.match(sources, /walkCampaignAds/);
    // Per-campaign ad paging still uses MAX_AD_PAGES guard
    assert.match(sources, /for.*adPage.*MAX_AD_PAGES/s);
    // Video metadata now batched (VIDEO_BATCH_SIZE=25), not per-video chunked
    assert.match(sources, /VIDEO_BATCH_SIZE/);
    assert.match(sources, /batchFetchVideoMetadata/);
  });

  it("sources.ts returns uniqueVideoCount and campaignCount", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(sources, /uniqueVideoCount/);
    assert.match(sources, /campaignCount/);
    // uniqueVideoCount is the Set size before the orphan filter
    assert.match(sources, /allVideoIds\.size/);
  });

  it("source-picker-fetch.ts exports fetchAudienceMultiCampaignVideos + MultiCampaignVideosPayload", () => {
    const fetch = readFileSync("lib/audiences/source-picker-fetch.ts", "utf8");
    assert.match(fetch, /fetchAudienceMultiCampaignVideos/);
    assert.match(fetch, /MultiCampaignVideosPayload/);
    assert.match(fetch, /uniqueVideoCount/);
    assert.match(fetch, /campaignCount/);
  });

  it("source-picker.tsx calls multi-campaign-videos endpoint (not per-campaign)", () => {
    const picker = readFileSync(
      "components/audiences/source-picker.tsx",
      "utf8",
    );
    // Uses the new multi-campaign endpoint
    assert.match(picker, /multi-campaign-videos/);
    assert.match(picker, /fetchAudienceMultiCampaignVideos/);
    // No longer issues one call per campaign ID
    assert.doesNotMatch(picker, /campaignIds\.map.*campaign-videos/s);
  });
});

describe("campaign-videos source endpoint", () => {
  it("is wired to the deduping campaign video source helper", () => {
    const route = readFileSync(
      "app/api/audiences/sources/campaign-videos/route.ts",
      "utf8",
    );
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(route, /fetchAudienceCampaignVideos/);
    assert.match(route, /clientId.*campaignId/s);
    assert.match(sources, /new Set<string>\(\)/);
    assert.match(sources, /extractVideoIdsFromCreative/);
    assert.match(sources, /extract-video-ids-from-creative/);
    // 'from' field is included in batch-fetch-video-metadata.ts to detect orphan videos.
    const batchUtil = readFileSync("lib/audiences/batch-fetch-video-metadata.ts", "utf8");
    assert.match(batchUtil, /fields.*id,picture,title,length,from/);
  });

  it("sources.ts filters orphan videos with no from.id and returns skippedCount", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    // Filters out videos without from.id
    assert.match(sources, /from\?\.id/);
    // Returns skippedCount
    assert.match(sources, /skippedCount/);
    // Logs a warning for dropped videos
    assert.match(sources, /Dropped.*video.*no Page association/);
  });

  it("sources.ts resolves contextPageId from platform_customizations (Advantage+ creatives)", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    // Iterates facebook/instagram platform customizations for page_id
    assert.match(sources, /platform_customizations/);
    assert.match(sources, /"facebook".*"instagram"|"instagram".*"facebook"/s);
  });

  it("sources.ts resolves contextPageId from asset_feed_spec.page_ids (asset-feed creatives)", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    // Reads page_ids array from asset_feed_spec
    assert.match(sources, /asset_feed_spec/);
    assert.match(sources, /page_ids/);
  });

  it("sources.ts falls back to most-common video from.id when creative-level extraction misses", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    // videoFromPageCounts accumulates from.id across surviving videos
    assert.match(sources, /videoFromPageCounts/);
    // contextPageId is assigned from videoFromPageCounts when pageCounts is empty
    assert.match(sources, /!contextPageId.*videoFromPageCounts\.size/s);
  });

  it("Graph API field string includes asset_feed_spec and platform_customizations", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(
      sources,
      /asset_feed_spec.*platform_customizations|platform_customizations.*asset_feed_spec/s,
    );
  });

  it("sources.ts uses small /ads page size + paging + batched video metadata fetch", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(sources, /ADS_PAGE_LIMIT.*100|"100"|limit: ADS_PAGE_LIMIT/s);
    assert.match(sources, /VIDEO_BATCH_SIZE/);
    assert.match(sources, /batchFetchVideoMetadata/);
    assert.match(sources, /params\.after|after.*adsAfter/);
  });
});
