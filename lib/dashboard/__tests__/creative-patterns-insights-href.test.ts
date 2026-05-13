import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildCreativePatternsInsightsHref } from "../creative-patterns-funnel-view.ts";

describe("buildCreativePatternsInsightsHref — dashboard surface", () => {
  it("emits the internal /clients/[id]/dashboard route when not shared", () => {
    const href = buildCreativePatternsInsightsHref({
      surface: "dashboard",
      clientId: "c1",
      region: "wc26_london",
      phase: "ticket_sale",
      funnel: "bottom",
    });
    assert.equal(
      href,
      "/clients/c1/dashboard?tab=insights&region=wc26_london&phase=ticket_sale&funnel=bottom",
    );
  });

  it("emits /share/client/[token] when shared with a token", () => {
    const href = buildCreativePatternsInsightsHref({
      surface: "dashboard",
      clientId: "c1",
      region: "wc26_london",
      token: "ABCDEFGHIJKLMNOP",
      isShared: true,
      phase: "registration",
      funnel: "top",
    });
    assert.equal(
      href,
      "/share/client/ABCDEFGHIJKLMNOP?tab=insights&region=wc26_london&phase=registration&funnel=top",
    );
  });
});

describe("buildCreativePatternsInsightsHref — venue surface", () => {
  it("emits the internal /clients/[id]/venues/[event_code] route when not shared", () => {
    const href = buildCreativePatternsInsightsHref({
      surface: "venue",
      clientId: "c1",
      eventCode: "WC26-BRIGHTON",
      phase: "ticket_sale",
      funnel: "bottom",
    });
    assert.equal(
      href,
      "/clients/c1/venues/WC26-BRIGHTON?tab=insights&phase=ticket_sale&funnel=bottom",
    );
  });

  it("emits /share/venue/[token] when shared with a token", () => {
    // Regression: this branch previously always emitted /clients/.../venues/...
    // even when the panel was rendered from /share/venue/[token]. Phase/funnel
    // pill clicks on the share insights tab took Joe to the internal route,
    // which the proxy default-deny 307'd to /login.
    const href = buildCreativePatternsInsightsHref({
      surface: "venue",
      clientId: "c1",
      eventCode: "WC26-BRIGHTON",
      token: "venue-share-tok-xyz",
      isShared: true,
      phase: "ticket_sale",
      funnel: "bottom",
    });
    assert.equal(
      href,
      "/share/venue/venue-share-tok-xyz?tab=insights&phase=ticket_sale&funnel=bottom",
    );
  });

  it("falls back to the internal route when isShared is true but token is missing", () => {
    // Belt-and-braces: a misconfigured caller shouldn't silently mint a URL
    // with an undefined token segment. Internal route is the safer default.
    const href = buildCreativePatternsInsightsHref({
      surface: "venue",
      clientId: "c1",
      eventCode: "WC26-BRIGHTON",
      isShared: true,
      phase: "ticket_sale",
      funnel: "bottom",
    });
    assert.equal(
      href,
      "/clients/c1/venues/WC26-BRIGHTON?tab=insights&phase=ticket_sale&funnel=bottom",
    );
  });
});
