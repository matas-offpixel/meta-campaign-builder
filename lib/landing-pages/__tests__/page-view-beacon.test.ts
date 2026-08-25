import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPageViewPayload,
  fireLandingPageView,
} from "../page-view-beacon.ts";

describe("fireLandingPageView", () => {
  it("uses sendBeacon when it reports success", () => {
    const sent: Array<{ url: string; data: BodyInit }> = [];
    const result = fireLandingPageView(
      "/api/l/gmc/jackies/view",
      '{"utm":{}}',
      {
        sendBeacon: (url, data) => {
          sent.push({ url, data });
          return true;
        },
        fetch: async () => {
          throw new Error("fetch should not run");
        },
      },
    );
    assert.equal(result.method, "sendBeacon");
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.url, "/api/l/gmc/jackies/view");
  });

  it("falls back to fetch keepalive when sendBeacon returns false", async () => {
    let fetched = false;
    const result = fireLandingPageView(
      "/api/l/gmc/jackies/view",
      '{"utm":{}}',
      {
        sendBeacon: () => false,
        fetch: async () => {
          fetched = true;
          return {};
        },
      },
    );
    assert.equal(result.method, "fetch");
    await Promise.resolve();
    assert.equal(fetched, true);
  });

  it("falls back to fetch when sendBeacon throws", () => {
    const result = fireLandingPageView(
      "/api/l/gmc/jackies/view",
      '{"utm":{}}',
      {
        sendBeacon: () => {
          throw new Error("blocked");
        },
        fetch: async () => ({}),
      },
    );
    assert.equal(result.method, "fetch");
  });

  it("never throws when both transports fail", () => {
    assert.doesNotThrow(() => {
      const result = fireLandingPageView(
        "/api/l/gmc/jackies/view",
        '{"utm":{}}',
        {
          sendBeacon: () => {
            throw new Error("no beacon");
          },
          fetch: () => {
            throw new Error("no fetch");
          },
        },
      );
      assert.equal(result.method, "none");
    });
  });
});

describe("buildPageViewPayload", () => {
  it("serialises utm + referrer only — no PII keys", () => {
    const raw = buildPageViewPayload({
      utm: { fbclid: "abc" },
      referrer_url: "https://m.facebook.com/",
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.deepEqual(Object.keys(parsed).sort(), ["referrer_url", "utm"]);
    assert.deepEqual(parsed.utm, { fbclid: "abc" });
  });
});
