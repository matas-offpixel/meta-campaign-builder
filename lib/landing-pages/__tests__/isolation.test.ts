import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveLandingPageContext } from "../context.ts";
import { makeFakeDb } from "./_fake-db.ts";

/**
 * CRITICAL multi-tenant isolation test (C+O non-negotiable C).
 *
 * Every client owns their Meta Pixel ID + CAPI token. Landing-page events
 * fire to THE CLIENT'S pixel only — cross-contamination between clients
 * (or into Off/Pixel's own retargeting audiences) is a PRIVACY BUG.
 *
 * This test seeds TWO clients, each with their own client_landing_pages
 * row, pixel id, event, and page_events row, then resolves client A's
 * context and asserts client B's identifiers appear NOWHERE in the entire
 * serialized result. It guards against any future join/cache mistake in
 * the resolution chain — if someone "optimises" the lookup into a join
 * that can pick up another tenant's row, this fails.
 */

const CLIENT_A = {
  id: "client-a",
  user_id: "user-matas",
  name: "GMC Worldwide Productions",
  slug: "gmc-worldwide-productions",
};
const CLIENT_B = {
  id: "client-b",
  user_id: "user-matas",
  name: "Ironworks",
  slug: "ironworks",
};

const PIXEL_A = "111111111111111";
const PIXEL_B = "999999999999999";
const CAPI_TOKEN_B = "SECRET-CAPI-TOKEN-CLIENT-B";

const EVENT_A = {
  id: "event-a",
  client_id: CLIENT_A.id,
  name: "Jackies Mallorca 2026",
  slug: "jackies-mallorca",
  event_date: "2026-08-16",
  venue_name: null,
  venue_city: "Mallorca",
  ticket_url: null,
};
const EVENT_B = {
  id: "event-b",
  client_id: CLIENT_B.id,
  name: "Ironworks OHD",
  slug: "ironworks-ohd",
  event_date: "2026-09-01",
  venue_name: "Ironworks",
  venue_city: "London",
  ticket_url: null,
};

function tables() {
  return {
    clients: [{ ...CLIENT_A }, { ...CLIENT_B }],
    events: [{ ...EVENT_A }, { ...EVENT_B }],
    page_events: [
      {
        id: "pe-a",
        event_id: EVENT_A.id,
        provider: "internal",
        evntree_url: null,
        theme_overrides: {},
        content: { template_key: "mvp_v1" },
        status: "live",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
      {
        id: "pe-b",
        event_id: EVENT_B.id,
        provider: "internal",
        evntree_url: null,
        theme_overrides: {},
        content: { template_key: "mvp_v1" },
        status: "live",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ],
    client_landing_pages: [
      {
        id: "lp-a",
        client_id: CLIENT_A.id,
        theme: { accent: "coral" },
        meta_pixel_id: PIXEL_A,
        meta_capi_token_encrypted: "SECRET-CAPI-TOKEN-CLIENT-A",
        default_provider: "internal",
      },
      {
        id: "lp-b",
        client_id: CLIENT_B.id,
        theme: { accent: "steel" },
        meta_pixel_id: PIXEL_B,
        meta_capi_token_encrypted: CAPI_TOKEN_B,
        default_provider: "internal",
      },
    ],
    page_templates: [
      {
        id: "tpl-mvp",
        key: "mvp_v1",
        name: "MVP v1",
        block_types_supported: ["hero", "event_card", "signup_form", "footer"],
        default_config: {},
        version: 1,
      },
    ],
  };
}

describe("multi-tenant pixel isolation", () => {
  it("client A's context contains A's pixel and NEVER client B's pixel or ids", async () => {
    const ctx = await resolveLandingPageContext(
      makeFakeDb(tables()),
      CLIENT_A.slug,
      EVENT_A.slug,
    );
    assert.ok(ctx);
    assert.equal(ctx.landingPage?.meta_pixel_id, PIXEL_A);

    // The hard guarantee: serialize the ENTIRE context and prove nothing of
    // client B leaked in through any join, projection, or default.
    const serialized = JSON.stringify(ctx);
    assert.ok(!serialized.includes(PIXEL_B), "client B pixel id leaked");
    assert.ok(!serialized.includes(CLIENT_B.id), "client B id leaked");
    assert.ok(!serialized.includes(EVENT_B.id), "client B event leaked");
    assert.ok(!serialized.includes("lp-b"), "client B landing page row leaked");
  });

  it("the symmetric check holds for client B", async () => {
    const ctx = await resolveLandingPageContext(
      makeFakeDb(tables()),
      CLIENT_B.slug,
      EVENT_B.slug,
    );
    assert.ok(ctx);
    assert.equal(ctx.landingPage?.meta_pixel_id, PIXEL_B);
    const serialized = JSON.stringify(ctx);
    assert.ok(!serialized.includes(PIXEL_A), "client A pixel id leaked");
    assert.ok(!serialized.includes(CLIENT_A.id), "client A id leaked");
  });

  it("CAPI tokens never appear in ANY resolved context (not selected on the public path)", async () => {
    for (const [clientSlug, eventSlug] of [
      [CLIENT_A.slug, EVENT_A.slug],
      [CLIENT_B.slug, EVENT_B.slug],
    ] as const) {
      const ctx = await resolveLandingPageContext(
        makeFakeDb(tables()),
        clientSlug,
        eventSlug,
      );
      const serialized = JSON.stringify(ctx);
      assert.ok(
        !serialized.includes("SECRET-CAPI-TOKEN"),
        `CAPI token leaked into public context for ${clientSlug}`,
      );
      assert.ok(
        !serialized.includes("meta_capi_token_encrypted"),
        "meta_capi_token_encrypted column selected on the public path",
      );
    }
  });

  it("client A's slug with client B's event slug → null (chain, not global, lookup)", async () => {
    const ctx = await resolveLandingPageContext(
      makeFakeDb(tables()),
      CLIENT_A.slug,
      EVENT_B.slug,
    );
    assert.equal(ctx, null);
  });
});
