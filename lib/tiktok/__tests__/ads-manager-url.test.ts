import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildTikTokAdsManagerUrl } from "../ads-manager-url.ts";

describe("buildTikTokAdsManagerUrl", () => {
  it("returns the advertiser-scoped campaign list URL with an encoded aadvid", () => {
    const url = buildTikTokAdsManagerUrl("7639802149165301776");
    assert.equal(
      url,
      "https://ads.tiktok.com/i18n/manage/campaign?aadvid=7639802149165301776",
    );

    const parsed = new URL(url!);
    assert.equal(parsed.host, "ads.tiktok.com");
    assert.equal(parsed.pathname, "/i18n/manage/campaign");
    assert.equal(parsed.searchParams.get("aadvid"), "7639802149165301776");
    assert.equal(parsed.searchParams.has("selected_campaign_ids"), false);
    assert.equal(parsed.searchParams.has("st"), false);
    assert.equal(parsed.searchParams.has("et"), false);
  });

  it("encodes reserved characters in the advertiser id", () => {
    const url = buildTikTokAdsManagerUrl("7639 8021&evil");
    assert.equal(
      url,
      "https://ads.tiktok.com/i18n/manage/campaign?aadvid=7639+8021%26evil",
    );
    assert.equal(new URL(url!).searchParams.get("aadvid"), "7639 8021&evil");
  });

  it("returns null when the advertiser id is missing", () => {
    assert.equal(buildTikTokAdsManagerUrl(null), null);
    assert.equal(buildTikTokAdsManagerUrl(undefined), null);
    assert.equal(buildTikTokAdsManagerUrl(""), null);
    assert.equal(buildTikTokAdsManagerUrl("   "), null);
  });
});
