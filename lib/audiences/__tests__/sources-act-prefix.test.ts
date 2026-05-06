import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("audience Meta source helpers use act_ ad account paths", () => {
  it("fetchAudiencePixels and fetchAudienceCampaigns prefix bare ids for Graph paths", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(sources, /\$\{withActPrefix\(adAccountId\)\}\/adspixels/);
    assert.match(sources, /\$\{withActPrefix\(adAccountId\)\}\/campaigns/);
    assert.match(sources, /withoutActPrefix\(adAccountId\)/);
  });

  it("fetchAudienceCampaigns uses created_time in Graph filtering for /campaigns (not time_created)", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(
      sources,
      /fetchAudienceCampaigns[\s\S]*?filtering:\s*JSON\.stringify\(\[\s*\{\s*field:\s*"created_time",\s*operator:\s*"GREATER_THAN"/,
    );
    assert.doesNotMatch(
      sources,
      /fetchAudienceCampaigns[\s\S]*?field:\s*"time_created"/,
    );
  });

  it("documents bare DB ids so regressions are obvious in review", () => {
    const doc = readFileSync("lib/meta/ad-account-id.ts", "utf8");
    assert.match(doc, /clients\.meta_ad_account_id/);
    assert.match(doc, /act_/);
  });
});
