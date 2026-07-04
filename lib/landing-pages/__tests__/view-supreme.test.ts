import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_ACCENT, resolveAccent } from "../theme.ts";
import type { LandingPageContext } from "../types.ts";
import { buildLandingPageView } from "../view.ts";
import {
  LANDING_PAGE_PRESENTATION_DEFAULTS,
  PAGE_EVENT_PRESENTATION_DEFAULTS,
} from "./_fixtures.ts";

/**
 * PR-6 view-model behaviour: hero fallback chain, countdown gating,
 * media parsing/sanitising, logo + footer config. This is the seam the
 * Supreme components consume — carousel "1 image = no scroller" etc. are
 * pure branches on these values (node:test runs react-server, so client
 * components are exercised at this seam, not via DOM render).
 */

const NOW = Date.parse("2026-07-04T12:00:00Z");

function makeContext(): LandingPageContext {
  return {
    client: { id: "cl-1", name: "GMC Worldwide", slug: "gmc" },
    event: {
      id: "ev-1",
      name: "Jackies Mallorca",
      slug: "jackies",
      event_date: "2026-08-16",
      venue_name: "Open Air",
      venue_city: "Mallorca",
      ticket_url: "https://tickets.example/jackies",
      capacity: 1200,
      presale_at: null,
      general_sale_at: null,
    },
    pageEvent: {
      id: "pe-1",
      event_id: "ev-1",
      provider: "internal",
      evntree_url: null,
      theme_overrides: {},
      content: { artwork_url: "https://cdn.example/artwork.jpg" },
      status: "live",
      created_at: "",
      updated_at: "",
      ...PAGE_EVENT_PRESENTATION_DEFAULTS,
    },
    landingPage: {
      id: "lp-1",
      client_id: "cl-1",
      theme: {},
      meta_pixel_id: null,
      default_provider: "internal",
      ...LANDING_PAGE_PRESENTATION_DEFAULTS,
    },
    template: null,
  };
}

describe("hero images — fallback chain", () => {
  it("empty hero_images → single-image fallback to content.artwork_url", () => {
    const view = buildLandingPageView(makeContext(), NOW);
    assert.deepEqual(view.heroImages, ["https://cdn.example/artwork.jpg"]);
  });

  it("populated hero_images wins over artwork; junk entries are dropped", () => {
    const context = makeContext();
    context.pageEvent.hero_images = [
      "https://cdn.example/1.jpg",
      "javascript:alert(1)",
      42,
      "https://cdn.example/2.jpg",
    ];
    const view = buildLandingPageView(context, NOW);
    assert.deepEqual(view.heroImages, [
      "https://cdn.example/1.jpg",
      "https://cdn.example/2.jpg",
    ]);
  });

  it("no hero images AND no artwork → [] (renderer shows the placeholder)", () => {
    const context = makeContext();
    context.pageEvent.content = {};
    assert.deepEqual(buildLandingPageView(context, NOW).heroImages, []);
  });
});

describe("countdown — gating", () => {
  it("future target → countdown present with the configured label", () => {
    const context = makeContext();
    context.pageEvent.countdown_target_at = "2026-07-10T18:00:00Z";
    context.pageEvent.countdown_label = "presale opens in";
    const view = buildLandingPageView(context, NOW);
    assert.deepEqual(view.countdown, {
      targetAt: "2026-07-10T18:00:00Z",
      label: "presale opens in",
    });
  });

  it("NULL, past, or unparseable target → countdown null (block hidden)", () => {
    for (const target of [null, "2026-07-01T00:00:00Z", "garbage"]) {
      const context = makeContext();
      context.pageEvent.countdown_target_at = target;
      assert.equal(
        buildLandingPageView(context, NOW).countdown,
        null,
        `target=${target} should hide the block`,
      );
    }
  });

  it("blank label falls back to the default copy", () => {
    const context = makeContext();
    context.pageEvent.countdown_target_at = "2026-07-10T18:00:00Z";
    context.pageEvent.countdown_label = "   ";
    assert.equal(
      buildLandingPageView(context, NOW).countdown?.label,
      "tickets on sale in",
    );
  });
});

describe("bottom media + footer + logo config", () => {
  it("youtube_url parses to a video id; junk hides the embed", () => {
    const context = makeContext();
    context.pageEvent.youtube_url = "https://youtu.be/dQw4w9WgXcQ";
    assert.equal(buildLandingPageView(context, NOW).youtubeVideoId, "dQw4w9WgXcQ");
    context.pageEvent.youtube_url = "https://vimeo.com/1";
    assert.equal(buildLandingPageView(context, NOW).youtubeVideoId, null);
  });

  it("bottom_images sanitised like hero images", () => {
    const context = makeContext();
    context.pageEvent.bottom_images = [
      "https://cdn.example/g1.jpg",
      "data:image/png;base64,x",
    ];
    assert.deepEqual(buildLandingPageView(context, NOW).bottomImages, [
      "https://cdn.example/g1.jpg",
    ]);
  });

  it("logo defaults: box_logo with client-name text; wordmark honoured; missing row safe", () => {
    const view = buildLandingPageView(makeContext(), NOW);
    assert.equal(view.logoStyle, "box_logo");
    assert.equal(view.boxLogoText, "GMC Worldwide");
    assert.equal(view.showOffPixelAttribution, true);

    const wordmark = makeContext();
    wordmark.landingPage!.logo_style = "wordmark";
    wordmark.landingPage!.box_logo_text = "GMC";
    wordmark.landingPage!.show_off_pixel_attribution = false;
    const wview = buildLandingPageView(wordmark, NOW);
    assert.equal(wview.logoStyle, "wordmark");
    assert.equal(wview.boxLogoText, "GMC");
    assert.equal(wview.showOffPixelAttribution, false);

    const bare = makeContext();
    bare.landingPage = null;
    const bview = buildLandingPageView(bare, NOW);
    assert.equal(bview.logoStyle, "box_logo");
    assert.equal(bview.showOffPixelAttribution, true);
    assert.equal(bview.privacyPolicyUrl, null);
  });

  it("social links: only valid http(s) entries render, tickets from the event row", () => {
    const context = makeContext();
    context.pageEvent.content = {
      ...context.pageEvent.content,
      instagram_url: "https://instagram.com/gmc",
      tiktok_url: "javascript:alert(1)",
    };
    const view = buildLandingPageView(context, NOW);
    assert.deepEqual(view.socialLinks, [
      { label: "instagram", url: "https://instagram.com/gmc" },
      { label: "tickets", url: "https://tickets.example/jackies" },
    ]);
    assert.equal(view.capacity, 1200);
  });
});

describe("PR 7: onSaleAt — presale/general-sale precedence", () => {
  it("presale_at wins when both are set", () => {
    const context = makeContext();
    context.event.presale_at = "2026-07-08T10:00:00Z";
    context.event.general_sale_at = "2026-07-10T10:00:00Z";
    assert.equal(
      buildLandingPageView(context, NOW).onSaleAt,
      "2026-07-08T10:00:00Z",
    );
  });

  it("falls back to general_sale_at when presale_at is null", () => {
    const context = makeContext();
    context.event.presale_at = null;
    context.event.general_sale_at = "2026-07-10T10:00:00Z";
    assert.equal(
      buildLandingPageView(context, NOW).onSaleAt,
      "2026-07-10T10:00:00Z",
    );
  });

  it("both null or unparseable → null (header hides the row entirely)", () => {
    for (const [presale, general] of [
      [null, null],
      ["garbage", null],
      ["garbage", "also garbage"],
      ["", ""],
    ] as const) {
      const context = makeContext();
      context.event.presale_at = presale;
      context.event.general_sale_at = general;
      assert.equal(
        buildLandingPageView(context, NOW).onSaleAt,
        null,
        `presale=${presale} general=${general} should hide the row`,
      );
    }
  });

  it("an unparseable presale_at still falls through to a valid general_sale_at", () => {
    const context = makeContext();
    context.event.presale_at = "not-a-date";
    context.event.general_sale_at = "2026-07-10T10:00:00Z";
    assert.equal(
      buildLandingPageView(context, NOW).onSaleAt,
      "2026-07-10T10:00:00Z",
    );
  });
});

describe("resolveAccent — precedence + sanitisation", () => {
  it("palette[0] → client primary_color → DEFAULT_ACCENT", () => {
    assert.equal(resolveAccent(["#123456"], { primary_color: "#abcdef" }), "#123456");
    assert.equal(resolveAccent([], { primary_color: "#abcdef" }), "#abcdef");
    assert.equal(resolveAccent(null, {}), DEFAULT_ACCENT);
    assert.equal(resolveAccent(null, null), DEFAULT_ACCENT);
  });

  it("hostile values never reach the style attribute", () => {
    assert.equal(
      resolveAccent(["red;} body{display:none"], { primary_color: "url(evil)" }),
      DEFAULT_ACCENT,
    );
  });
});
