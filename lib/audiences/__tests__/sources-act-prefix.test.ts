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

  it("fetchAudienceCampaigns uses last_year insights preset for spend (valid Graph preset)", () => {
    const sources = readFileSync("lib/audiences/sources.ts", "utf8");
    assert.match(sources, /insights\.date_preset\(last_year\)\{spend\}/);
    assert.doesNotMatch(sources, /insights\.date_preset\(lifetime\)/);
    assert.doesNotMatch(sources, /insights\.date_preset\(maximum\)/);
    assert.doesNotMatch(
      sources,
      /fetchAudienceCampaigns[\s\S]*?filtering:\s*JSON\.stringify/,
    );
  });

  it("documents bare DB ids so regressions are obvious in review", () => {
    const doc = readFileSync("lib/meta/ad-account-id.ts", "utf8");
    assert.match(doc, /clients\.meta_ad_account_id/);
    assert.match(doc, /act_/);
  });
});
