import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isObviousBotUserAgent,
  parsePageViewBody,
  processPageView,
  type PageViewHandlerDeps,
  type PageViewInsert,
} from "../page-view-handler.ts";
import type { LandingPageContext } from "../types.ts";
import { PAGE_EVENT_PRESENTATION_DEFAULTS } from "./_fixtures.ts";

function makeContext(
  overrides: Partial<LandingPageContext["pageEvent"]> = {},
): LandingPageContext {
  return {
    client: { id: "client-1", name: "GMC", slug: "gmc" },
    event: {
      id: "event-1",
      name: "Jackies Mallorca",
      slug: "jackies",
      event_date: "2026-08-01",
      venue_name: null,
      venue_city: null,
      ticket_url: null,
      capacity: null,
      presale_at: null,
      general_sale_at: null,
      event_start_at: null,
    },
    pageEvent: {
      id: "pe-1",
      event_id: "event-1",
      provider: "internal",
      evntree_url: null,
      theme_overrides: {},
      content: {},
      status: "live",
      created_at: "",
      updated_at: "",
      ...PAGE_EVENT_PRESENTATION_DEFAULTS,
      ...overrides,
    },
    landingPage: null,
    template: null,
  };
}

function makeDeps(
  overrides: Partial<PageViewHandlerDeps> = {},
): PageViewHandlerDeps & { inserted: PageViewInsert[] } {
  const inserted: PageViewInsert[] = [];
  const deps: PageViewHandlerDeps & { inserted: PageViewInsert[] } = {
    inserted,
    resolveContext: async () => makeContext(),
    checkRateLimit: () => ({ allowed: true, retryAfterMs: 0 }),
    buildRateLimitKey: (xff, c, e) => `v:${xff ?? "anon"}:${c}/${e}`,
    insertView: async (row) => {
      inserted.push(row);
    },
    now: () => new Date("2026-08-25T21:00:00.000Z"),
    ...overrides,
  };
  return deps;
}

function makeInput(
  overrides: Partial<Parameters<typeof processPageView>[1]> = {},
) {
  return {
    clientSlug: "gmc",
    eventSlug: "jackies",
    method: "POST",
    body: {
      utm: { utm_source: "instagram", fbclid: "abc" },
      referrer_url: "https://instagram.com/",
    },
    xForwardedFor: "203.0.113.7",
    userAgent: "Mozilla/5.0",
    geo: { country: "GB", region: "ENG", city: "London" },
    ...overrides,
  };
}

describe("parsePageViewBody", () => {
  it("rejects a non-object body", () => {
    assert.deepEqual(parsePageViewBody(null), {
      ok: false,
      error: "Invalid request body.",
    });
    assert.deepEqual(parsePageViewBody("x"), {
      ok: false,
      error: "Invalid request body.",
    });
  });

  it("allowlists utm and clamps referrer", () => {
    const parsed = parsePageViewBody({
      utm: { utm_source: "tiktok", evil: "1", ttclid: "tt" },
      referrer_url: "https://example.com/",
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.utm, { utm_source: "tiktok", ttclid: "tt" });
    assert.equal(parsed.referrer_url, "https://example.com/");
  });
});

describe("processPageView", () => {
  it("records a view with server geo and resolved event_id", async () => {
    const deps = makeDeps();
    const result = await processPageView(deps, makeInput());
    assert.equal(result.status, 204);
    assert.equal(deps.inserted.length, 1);
    assert.equal(deps.inserted[0]?.eventId, "event-1");
    assert.equal(deps.inserted[0]?.geoCountry, "GB");
    assert.deepEqual(deps.inserted[0]?.utm, {
      utm_source: "instagram",
      fbclid: "abc",
    });
  });

  it("rejects HEAD and GET without inserting", async () => {
    const deps = makeDeps();
    const head = await processPageView(deps, makeInput({ method: "HEAD" }));
    const get = await processPageView(deps, makeInput({ method: "GET" }));
    assert.equal(head.status, 405);
    assert.equal(get.status, 405);
    assert.equal(deps.inserted.length, 0);
  });

  it("rejects malformed JSON-shaped bodies", async () => {
    const deps = makeDeps();
    const result = await processPageView(deps, makeInput({ body: [] }));
    assert.equal(result.status, 400);
    assert.equal(deps.inserted.length, 0);
  });

  it("429 when rate limited", async () => {
    const deps = makeDeps({
      checkRateLimit: () => ({ allowed: false, retryAfterMs: 1000 }),
    });
    const result = await processPageView(deps, makeInput());
    assert.equal(result.status, 429);
    assert.equal(deps.inserted.length, 0);
  });

  it("skips known bot UAs without inserting", async () => {
    const deps = makeDeps();
    const result = await processPageView(
      deps,
      makeInput({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" }),
    );
    assert.equal(result.status, 204);
    assert.equal(result.json.skipped, "bot_ua");
    assert.equal(deps.inserted.length, 0);
  });

  it("404s an unknown page and does not insert", async () => {
    const deps = makeDeps({ resolveContext: async () => null });
    const result = await processPageView(deps, makeInput());
    assert.equal(result.status, 404);
    assert.equal(deps.inserted.length, 0);
  });

  it("does not count evntree or draft pages", async () => {
    const evntree = makeDeps({
      resolveContext: async () =>
        makeContext({ provider: "evntree", evntree_url: "https://evntree.ee/x" }),
    });
    const draft = makeDeps({
      resolveContext: async () => makeContext({ status: "draft" }),
    });
    assert.equal((await processPageView(evntree, makeInput())).status, 204);
    assert.equal((await processPageView(draft, makeInput())).status, 204);
    assert.equal(evntree.inserted.length, 0);
    assert.equal(draft.inserted.length, 0);
  });

  it("store failure returns 204, never 500", async () => {
    const deps = makeDeps({
      insertView: async () => {
        throw new Error("db down");
      },
    });
    const result = await processPageView(deps, makeInput());
    assert.equal(result.status, 204);
    assert.equal(result.json.skipped, "store_failed");
  });
});

describe("isObviousBotUserAgent", () => {
  it("flags known crawlers and leaves a normal browser alone", () => {
    assert.equal(isObviousBotUserAgent("Googlebot/2.1"), true);
    assert.equal(isObviousBotUserAgent("facebookexternalhit/1.1"), true);
    assert.equal(
      isObviousBotUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      ),
      false,
    );
    assert.equal(isObviousBotUserAgent(null), false);
  });
});
