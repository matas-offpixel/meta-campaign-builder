import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveLandingPageContext } from "../context.ts";
import { makeFailingDb, makeFakeDb } from "./_fake-db.ts";

/**
 * Resolution-chain behaviours for the public /l route. Runs the REAL chain
 * (the same code the service-role entrypoint delegates to) against an
 * in-memory fake — covering the 404 matrix from the PR spec:
 *
 *   unknown clientSlug                      → null
 *   unknown eventSlug for a valid client    → null
 *   valid slugs but no page_events row      → null
 *   full chain                              → joined context
 */

const GMC = {
  id: "client-gmc",
  user_id: "user-matas",
  name: "GMC Worldwide Productions",
  slug: "gmc-worldwide-productions",
};

const MALLORCA = {
  id: "event-mallorca",
  client_id: GMC.id,
  name: "Jackies - Open Air House Music Festival - MALLORCA",
  slug: "jackies-mallorca-wlf8br",
  event_date: "2026-08-16",
  venue_name: "Open Air",
  venue_city: "Mallorca",
  ticket_url: "https://tickets.example/jackies",
};

const TEMPLATE = {
  id: "tpl-mvp",
  key: "mvp_v1",
  name: "MVP v1",
  block_types_supported: ["hero", "event_card", "signup_form", "footer"],
  default_config: {},
  version: 1,
};

function baseTables() {
  return {
    clients: [{ ...GMC }],
    events: [{ ...MALLORCA }],
    page_events: [
      {
        id: "pe-mallorca",
        event_id: MALLORCA.id,
        provider: "internal",
        evntree_url: null,
        theme_overrides: {},
        content: { template_key: "mvp_v1" } as Record<string, unknown>,
        status: "draft",
        created_at: "2026-07-01T00:00:00Z",
        updated_at: "2026-07-01T00:00:00Z",
      },
    ],
    client_landing_pages: [
      {
        id: "lp-gmc",
        client_id: GMC.id,
        theme: {},
        meta_pixel_id: "555000111222333",
        meta_capi_token_encrypted: "SHOULD-NEVER-BE-SELECTED",
        default_provider: "internal",
      },
    ],
    page_templates: [{ ...TEMPLATE }],
  };
}

describe("resolveLandingPageContext", () => {
  it("resolves the full joined tuple for a valid slug pair", async () => {
    const ctx = await resolveLandingPageContext(
      makeFakeDb(baseTables()),
      GMC.slug,
      MALLORCA.slug,
    );
    assert.ok(ctx);
    assert.equal(ctx.client.name, GMC.name);
    assert.equal(ctx.event.name, MALLORCA.name);
    assert.equal(ctx.pageEvent.provider, "internal");
    assert.equal(ctx.landingPage?.meta_pixel_id, "555000111222333");
    assert.equal(ctx.template?.key, "mvp_v1");
  });

  it("unknown clientSlug → null", async () => {
    const ctx = await resolveLandingPageContext(
      makeFakeDb(baseTables()),
      "nope",
      MALLORCA.slug,
    );
    assert.equal(ctx, null);
  });

  it("unknown eventSlug for a valid client → null", async () => {
    const ctx = await resolveLandingPageContext(
      makeFakeDb(baseTables()),
      GMC.slug,
      "nope",
    );
    assert.equal(ctx, null);
  });

  it("valid slugs but no page_events row → null", async () => {
    const tables = baseTables();
    tables.page_events = [];
    const ctx = await resolveLandingPageContext(
      makeFakeDb(tables),
      GMC.slug,
      MALLORCA.slug,
    );
    assert.equal(ctx, null);
  });

  it("missing client_landing_pages row still resolves (landingPage null)", async () => {
    const tables = baseTables();
    tables.client_landing_pages = [];
    const ctx = await resolveLandingPageContext(
      makeFakeDb(tables),
      GMC.slug,
      MALLORCA.slug,
    );
    assert.ok(ctx);
    assert.equal(ctx.landingPage, null);
  });

  it("content without template_key falls back to mvp_v1", async () => {
    const tables = baseTables();
    tables.page_events[0].content = {};
    const ctx = await resolveLandingPageContext(
      makeFakeDb(tables),
      GMC.slug,
      MALLORCA.slug,
    );
    assert.equal(ctx?.template?.key, "mvp_v1");
  });

  it("ambiguous client slug (cross-user collision) → throws loudly", async () => {
    const tables = baseTables();
    tables.clients.push({ ...GMC, id: "client-imposter", user_id: "user-2" });
    await assert.rejects(
      resolveLandingPageContext(makeFakeDb(tables), GMC.slug, MALLORCA.slug),
      /ambiguous/,
    );
  });

  it("db errors propagate as thrown errors, not nulls", async () => {
    await assert.rejects(
      resolveLandingPageContext(
        makeFailingDb("connection refused"),
        GMC.slug,
        MALLORCA.slug,
      ),
      /connection refused/,
    );
  });
});
