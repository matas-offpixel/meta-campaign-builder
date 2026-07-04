import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveLandingPageOutcome } from "../resolve.ts";
import type { LandingPageContext, PageEventRow } from "../types.ts";
import {
  LANDING_PAGE_PRESENTATION_DEFAULTS,
  PAGE_EVENT_PRESENTATION_DEFAULTS,
} from "./_fixtures.ts";

/**
 * Outcome decision layer for the public /l route (PR 1 of the landing-page
 * arc). Covers all four route behaviours as pure functions — the HTTP-level
 * checks (200/307/404/500) are Matas' manual pre-merge gate since npm test
 * has no HTTP harness.
 */

function makePageEvent(overrides: Partial<PageEventRow> = {}): PageEventRow {
  return {
    id: "pe-1",
    event_id: "ev-1",
    provider: "internal",
    evntree_url: null,
    theme_overrides: {},
    content: { template_key: "mvp_v1" },
    status: "draft",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...PAGE_EVENT_PRESENTATION_DEFAULTS,
    ...overrides,
  };
}

function makeContext(
  pageEvent: Partial<PageEventRow> = {},
): LandingPageContext {
  return {
    client: { id: "cl-1", name: "GMC Worldwide Productions", slug: "gmc" },
    event: {
      id: "ev-1",
      name: "Jackies Mallorca",
      slug: "jackies-mallorca",
      event_date: "2026-08-16",
      venue_name: "Open Air",
      venue_city: "Mallorca",
      ticket_url: null,
      capacity: null,
    },
    pageEvent: makePageEvent(pageEvent),
    landingPage: {
      id: "lp-1",
      client_id: "cl-1",
      theme: {},
      meta_pixel_id: "111111111111111",
      default_provider: "internal",
      ...LANDING_PAGE_PRESENTATION_DEFAULTS,
    },
    template: {
      id: "tpl-1",
      key: "mvp_v1",
      name: "MVP v1",
      block_types_supported: ["hero", "event_card", "signup_form", "footer"],
      default_config: {},
      version: 1,
    },
  };
}

describe("resolveLandingPageOutcome", () => {
  it("null context → null (route 404s)", () => {
    assert.equal(resolveLandingPageOutcome(null), null);
  });

  it("provider internal → render with the same context", () => {
    const context = makeContext({ provider: "internal" });
    const outcome = resolveLandingPageOutcome(context);
    assert.ok(outcome && outcome.kind === "render");
    assert.equal(outcome.context, context);
  });

  it("provider evntree with url → redirect to that url", () => {
    const outcome = resolveLandingPageOutcome(
      makeContext({
        provider: "evntree",
        evntree_url: "https://evntr.ee/jackies-mallorca",
      }),
    );
    assert.deepEqual(outcome, {
      kind: "redirect",
      url: "https://evntr.ee/jackies-mallorca",
    });
  });

  it("provider evntree with NULL url → misconfigured (loud fail, no silent blank redirect)", () => {
    const outcome = resolveLandingPageOutcome(
      makeContext({ provider: "evntree", evntree_url: null }),
    );
    assert.ok(outcome && outcome.kind === "misconfigured");
    assert.match(outcome.reason, /evntree_url/);
    assert.match(outcome.reason, /page_events_evntree_url_required/);
  });

  it("provider evntree with whitespace-only url → misconfigured too", () => {
    const outcome = resolveLandingPageOutcome(
      makeContext({ provider: "evntree", evntree_url: "   " }),
    );
    assert.ok(outcome && outcome.kind === "misconfigured");
  });
});
