import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveAdContext, type AdContextIndex } from "../ad-facts.ts";

const index: AdContextIndex = {
  launchedAds: new Map([
    ["ad-launched", { clientId: "client-a", eventId: "event-a" }],
    ["ad-unlinked", { clientId: null, eventId: null }],
  ]),
  launchedAdSets: new Map([["adset-launched", { clientId: "client-b", eventId: "event-b" }]]),
  codedEvents: [
    { eventId: "event-c", clientId: "client-c", eventCode: "BB26-KAYODE", adAccountId: "act_111111" },
    { eventId: "event-d1", clientId: "client-d", eventCode: "WC26-MAN", adAccountId: "act_111111" },
    { eventId: "event-d2", clientId: "client-e", eventCode: "WC26-MAN", adAccountId: "act_222222" },
    { eventId: "event-f1", clientId: "client-f", eventCode: "DUP", adAccountId: "act_999999" },
    { eventId: "event-f2", clientId: "client-f", eventCode: "DUP", adAccountId: "act_999999" },
  ],
};

describe("resolveAdContext", () => {
  it("launched_ads first", () => {
    assert.deepEqual(
      resolveAdContext({ meta_ad_id: "ad-launched", meta_adset_id: "adset-launched", campaign_name: "[BB26-KAYODE]" }, index),
      { clientId: "client-a", eventId: "event-a", source: "launched_ads" },
    );
  });

  it("then launched_ad_sets by meta_adset_id (also when the ad row carries no links)", () => {
    for (const metaAdId of ["ad-other", "ad-unlinked"]) {
      assert.deepEqual(
        resolveAdContext({ meta_ad_id: metaAdId, meta_adset_id: "adset-launched", campaign_name: "[BB26-KAYODE]" }, index),
        { clientId: "client-b", eventId: "event-b", source: "launched_ad_sets" },
      );
    }
  });

  it("then [EVENT_CODE] in campaign_name, dash-normalised, narrowed by ad account when ambiguous", () => {
    assert.deepEqual(
      resolveAdContext({ meta_ad_id: "x", meta_adset_id: "y", campaign_name: "[BB26\u2013KAYODE] Presale" }, index),
      { clientId: "client-c", eventId: "event-c", source: "campaign_code" },
    );
    assert.deepEqual(
      resolveAdContext({ meta_ad_id: "x", campaign_name: "[WC26-MAN] On sale", ad_account_id: "222222" }, index),
      { clientId: "client-e", eventId: "event-d2", source: "campaign_code" },
    );
  });

  it("null when nothing matches, or a code stays ambiguous", () => {
    const none = { clientId: null, eventId: null, source: null };
    assert.deepEqual(resolveAdContext({ meta_ad_id: "x", campaign_name: "Evergreen retargeting" }, index), none);
    assert.deepEqual(resolveAdContext({ meta_ad_id: "x", campaign_name: "[UNKNOWN] Push" }, index), none);
    assert.deepEqual(resolveAdContext({ meta_ad_id: "x", campaign_name: "[WC26-MAN]" }, index), none);
    assert.deepEqual(resolveAdContext({ meta_ad_id: "x", campaign_name: "[DUP]", ad_account_id: "act_999999" }, index), none);
    assert.deepEqual(resolveAdContext({ meta_ad_id: "x", campaign_name: "[BB26-KAYODE-2]" }, index), none);
  });
});
