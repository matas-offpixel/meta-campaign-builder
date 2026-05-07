import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAudienceName,
  extractEventCode,
  mostCommonEventCode,
} from "../naming.ts";

describe("extractEventCode", () => {
  it("returns null when there are no brackets", () => {
    assert.equal(extractEventCode("Plain campaign name"), null);
  });

  it("returns inner code with hyphens", () => {
    assert.equal(
      extractEventCode("[WC26-MANCHESTER] Promo clip"),
      "WC26-MANCHESTER",
    );
  });

  it("uses the first bracketed group when multiple exist", () => {
    assert.equal(extractEventCode("[A] tail [B]"), "A");
  });
});

describe("mostCommonEventCode", () => {
  it("returns winner and count of non-matching campaigns", () => {
    const r = mostCommonEventCode([
      "[4TF26-ARSENAL-CL] One",
      "[4TF26-ARSENAL-CL] Two",
      "[4TF26-ARSENAL-CL] Three",
      "[OTHER] Four",
    ]);
    assert.equal(r.code, "4TF26-ARSENAL-CL");
    assert.equal(r.otherCount, 1);
  });
});

describe("buildAudienceName", () => {
  const client = { slug: "4thefans", name: "4theFans Ltd" };

  it("single Manchester campaign at 95% uses that event_code", () => {
    const name = buildAudienceName({
      scope: "client",
      client,
      event: null,
      subtype: "video_views",
      retentionDays: 30,
      threshold: 95,
      campaignNames: ["[WC26-MANCHESTER] Summer promo"],
    });
    assert.equal(name, "[WC26-MANCHESTER] 95% video views 30d");
  });

  it("three Arsenal CL + one mismatched → +1 suffix", () => {
    const name = buildAudienceName({
      scope: "client",
      client,
      event: null,
      subtype: "video_views",
      retentionDays: 30,
      threshold: 95,
      campaignNames: [
        "[4TF26-ARSENAL-CL] A",
        "[4TF26-ARSENAL-CL] B",
        "[4TF26-ARSENAL-CL] C",
        "[OTHER] D",
      ],
    });
    assert.equal(name, "[4TF26-ARSENAL-CL+1] 95% video views 30d");
  });

  it("pixel for WC26-Manchester event uses event_code", () => {
    const name = buildAudienceName({
      scope: "event",
      client,
      event: { eventCode: "WC26-MANCHESTER", name: "Manchester" },
      subtype: "website_pixel",
      retentionDays: 30,
    });
    assert.equal(name, "[WC26-MANCHESTER] pixel 30d");
  });

  it("client-scoped FB engagement uses client slug", () => {
    const name = buildAudienceName({
      scope: "client",
      client,
      event: null,
      subtype: "page_engagement_fb",
      retentionDays: 365,
    });
    assert.equal(name, "[4thefans] FB page engagement 365d");
  });
});
