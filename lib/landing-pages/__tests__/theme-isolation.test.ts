import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LandingPageContext } from "../types.ts";
import { buildLandingPageView } from "../view.ts";
import {
  LANDING_PAGE_PRESENTATION_DEFAULTS,
  PAGE_EVENT_PRESENTATION_DEFAULTS,
} from "./_fixtures.ts";

/**
 * TENANT THEME ISOLATION — the PR-2 counterpart of PR 1's data-isolation
 * test. Two clients with maximally distinguishable themes; building the
 * view for tenant A must produce output containing NOTHING of tenant B —
 * no colors, no logo, no thank-you copy, no name — and vice versa.
 *
 * Why this seam: the component tree consumes ONLY LandingPageView (see
 * lib/landing-pages/view.ts), and the view's themeStyle is applied as
 * inline CSS custom properties on the LP root (inheritance is strictly
 * downward, CSS-module class names are hashed). So "no B token in view A"
 * plus that architecture IS the no-bleed guarantee — including in prod
 * builds, where the only cross-page CSS is the shared hashed module, which
 * contains var() references and zero tenant literals.
 *
 * PR 3: the view model now carries `metaPixelId` (the explicit field PR 2
 * reserved) — asserted here to be exactly the OWN tenant's pixel and
 * nothing else. The deeper pixel/CAPI isolation matrix lives in
 * capi-isolation.test.ts.
 */

const TENANT_A = {
  color: "#a11a11",
  accent: "#a22a22",
  bg: "#a33a33",
  logo: "https://cdn.tenant-a.example/logo-a.png",
  thanks: "TENANT_A_THANK_YOU_COPY",
  pixel: "111111111111111",
  // PR 6 surfaces:
  palette: "#A44A44",
  privacy: "https://tenant-a.example/privacy-a",
  boxLogo: "BOX_LOGO_A",
};

const TENANT_B = {
  color: "#b11b11",
  accent: "#b22b22",
  bg: "#b33b33",
  logo: "https://cdn.tenant-b.example/logo-b.png",
  thanks: "TENANT_B_THANK_YOU_COPY",
  pixel: "999999999999999",
  palette: "#B44B44",
  privacy: "https://tenant-b.example/privacy-b",
  boxLogo: "BOX_LOGO_B",
};

function makeContext(
  name: "a" | "b",
  tenant: typeof TENANT_A,
): LandingPageContext {
  return {
    client: { id: `client-${name}`, name: `Client ${name.toUpperCase()}`, slug: `client-${name}` },
    event: {
      id: `event-${name}`,
      name: `Event ${name.toUpperCase()}`,
      slug: `event-${name}`,
      event_date: "2026-08-01",
      venue_name: `Venue ${name.toUpperCase()}`,
      venue_city: `City ${name.toUpperCase()}`,
      ticket_url: null,
      capacity: null,
      presale_at: null,
      general_sale_at: null,
    },
    pageEvent: {
      id: `pe-${name}`,
      event_id: `event-${name}`,
      provider: "internal",
      evntree_url: null,
      theme_overrides: { accent_color: tenant.accent },
      content: { headline: `HEADLINE_${name.toUpperCase()}` },
      status: "live",
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
      ...PAGE_EVENT_PRESENTATION_DEFAULTS,
      artwork_palette: [tenant.palette],
    },
    landingPage: {
      id: `lp-${name}`,
      client_id: `client-${name}`,
      theme: {
        primary_color: tenant.color,
        bg_color: tenant.bg,
        logo_url: tenant.logo,
        thank_you_message: tenant.thanks,
      },
      meta_pixel_id: tenant.pixel,
      default_provider: "internal",
      ...LANDING_PAGE_PRESENTATION_DEFAULTS,
      privacy_policy_url: tenant.privacy,
      box_logo_text: tenant.boxLogo,
    },
    template: { id: `t`, key: "mvp_v1", name: "MVP", block_types_supported: [], default_config: {}, version: 1 },
  };
}

describe("tenant theme isolation", () => {
  const contextA = makeContext("a", TENANT_A);
  const contextB = makeContext("b", TENANT_B);
  const viewA = buildLandingPageView(contextA);
  const viewB = buildLandingPageView(contextB);
  const serializedA = JSON.stringify(viewA);
  const serializedB = JSON.stringify(viewB);

  it("view A carries its own theme values", () => {
    assert.equal(viewA.theme.primary_color, TENANT_A.color);
    assert.equal(viewA.theme.accent_color, TENANT_A.accent);
    assert.equal(viewA.theme.logo_url, TENANT_A.logo);
    assert.equal(viewA.thankYouMessage, TENANT_A.thanks);
    assert.equal(viewA.themeStyle["--lp-primary-color"], TENANT_A.color);
  });

  it("NOTHING of tenant B appears anywhere in tenant A's view (and vice versa)", () => {
    for (const token of Object.values(TENANT_B)) {
      assert.ok(
        !serializedA.includes(token),
        `tenant B token "${token}" leaked into tenant A's view`,
      );
    }
    assert.ok(!serializedA.includes("HEADLINE_B"));
    assert.ok(!serializedA.includes("Client B"));
    for (const token of Object.values(TENANT_A)) {
      assert.ok(
        !serializedB.includes(token),
        `tenant A token "${token}" leaked into tenant B's view`,
      );
    }
  });

  it("metaPixelId is exactly the own tenant's pixel — never the other's (PR 3 seam)", () => {
    assert.equal(viewA.metaPixelId, TENANT_A.pixel);
    assert.equal(viewB.metaPixelId, TENANT_B.pixel);
    assert.ok(!serializedA.includes(TENANT_B.pixel), "tenant B pixel leaked into A's view");
    assert.ok(!serializedB.includes(TENANT_A.pixel), "tenant A pixel leaked into B's view");
    // No landing-page row → no pixel at all; no fallback source exists.
    const bare = makeContext("a", TENANT_A);
    bare.landingPage = null;
    assert.equal(buildLandingPageView(bare).metaPixelId, null);
  });

  it("theme resolution never falls back to another tenant — a broken theme falls to DEFAULTS", () => {
    const broken = makeContext("a", TENANT_A);
    broken.landingPage = null; // client has no landing-page row at all
    broken.pageEvent.theme_overrides = {}; // and no per-event overrides
    const view = buildLandingPageView(broken);
    // Defaults, not anything tenant-shaped.
    for (const token of [...Object.values(TENANT_A), ...Object.values(TENANT_B)]) {
      assert.ok(!JSON.stringify(view.theme).includes(token));
    }
  });

  it("PR 6: accent resolves from the OWN tenant's palette; privacy/box-logo stay tenant-local", () => {
    assert.equal(viewA.accent, TENANT_A.palette);
    assert.equal(viewB.accent, TENANT_B.palette);
    assert.equal(viewA.privacyPolicyUrl, TENANT_A.privacy);
    assert.equal(viewA.boxLogoText, TENANT_A.boxLogo);
    // Palette gone → falls to the OWN client's primary, never B's anything.
    const noPalette = makeContext("a", TENANT_A);
    noPalette.pageEvent.artwork_palette = null;
    assert.equal(buildLandingPageView(noPalette).accent, TENANT_A.color);
  });
});

describe("buildLandingPageView content handling", () => {
  it("falls back headline → event name, rejects non-http artwork, survives empty content", () => {
    const context = makeContext("a", TENANT_A);
    context.pageEvent.content = { artwork_url: "javascript:alert(1)" };
    const view = buildLandingPageView(context);
    assert.equal(view.headline, "Event A");
    assert.equal(view.artworkUrl, null);
    assert.equal(view.templateKey, "mvp_v1");
  });
});
