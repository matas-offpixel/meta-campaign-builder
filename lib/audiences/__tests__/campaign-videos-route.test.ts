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
    assert.match(sources, /fields: "id,picture,title,length"/);
  });
});
