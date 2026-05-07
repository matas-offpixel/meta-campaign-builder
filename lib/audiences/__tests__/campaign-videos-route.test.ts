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
});
