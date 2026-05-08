import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

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
    // 'from' is now included to detect orphan videos (no Page association).
    assert.match(sources, /fields: "id,picture,title,length,from"/);
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

  it("sources.ts uses small /ads page size + paging + chunked video metadata fetch", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(sources, /ADS_PAGE_LIMIT.*100|"100"|limit: ADS_PAGE_LIMIT/s);
    assert.match(sources, /VIDEO_FETCH_CONCURRENCY/);
    assert.match(sources, /chunk\.map\(async/);
    assert.match(sources, /params\.after|after.*adsAfter/);
  });
});
