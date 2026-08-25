import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveLandingPageContext } from "../context.ts";
import { resolveLandingPageOutcome } from "../resolve.ts";
import { destinationHelperKind } from "../../wizard/lp-destination.ts";
import { assessWizardLandingPage } from "../wizard-renderability.ts";
import { makeFakeDb } from "./_fake-db.ts";

/**
 * Wizard offer contract: a URL is offered only when the public resolver
 * would actually render it. Read-only — wizards do not create pages.
 */

const CLIENT = {
  id: "client-ironworks",
  user_id: "user-matas",
  name: "IRONWORKS",
  slug: "ironworks",
};

const EVENT = {
  id: "event-jamie",
  client_id: CLIENT.id,
  name: "Jamie Jones",
  slug: "ironworks-jamie-jones",
  event_date: "2026-10-03",
  venue_name: "Ironworks",
  venue_city: "London",
  ticket_url: null,
};

const TEMPLATE = {
  id: "tpl-mvp",
  key: "mvp_v1",
  name: "MVP v1",
  block_types_supported: ["hero", "event_card", "signup_form", "footer"],
  default_config: {},
  version: 1,
};

function draftPage() {
  return {
    id: "pe-jamie",
    event_id: EVENT.id,
    provider: "internal" as const,
    evntree_url: null,
    theme_overrides: {},
    content: {} as Record<string, unknown>,
    status: "draft" as const,
    created_at: "2026-08-25T00:00:00Z",
    updated_at: "2026-08-25T00:00:00Z",
  };
}

function livePage() {
  return { ...draftPage(), status: "live" as const };
}

function clientConfig() {
  return {
    id: "clp-ironworks",
    client_id: CLIENT.id,
    theme: {},
    default_provider: "internal" as const,
    meta_pixel_id: null,
    meta_capi_token_encrypted: null,
  };
}

function baseTables(over: {
  page_events?: ReturnType<typeof draftPage>[];
  client_landing_pages?: ReturnType<typeof clientConfig>[];
} = {}) {
  return {
    clients: [{ ...CLIENT }],
    events: [{ ...EVENT }],
    page_events: over.page_events ?? [],
    client_landing_pages: over.client_landing_pages ?? [],
    page_templates: [{ ...TEMPLATE }],
  };
}

async function publicOutcome(tables: ReturnType<typeof baseTables>) {
  const context = await resolveLandingPageContext(
    makeFakeDb(tables),
    CLIENT.slug,
    EVENT.slug,
  );
  return resolveLandingPageOutcome(context);
}

describe("assessWizardLandingPage — offer only what the renderer serves", () => {
  it("draft page → not offered", () => {
    const assessed = assessWizardLandingPage({
      hasPage: true,
      pageStatus: "draft",
      hasClientConfig: true,
      provider: "internal",
      clientSlug: CLIENT.slug,
      eventSlug: EVENT.slug,
    });
    assert.equal(assessed.state, "draft");
    assert.equal(assessed.offerUrl, false);
  });

  it("published + client config → offered", () => {
    const assessed = assessWizardLandingPage({
      hasPage: true,
      pageStatus: "live",
      hasClientConfig: true,
      provider: "internal",
      clientSlug: CLIENT.slug,
      eventSlug: EVENT.slug,
    });
    assert.equal(assessed.state, "ready");
    assert.equal(assessed.offerUrl, true);
  });

  it("missing client config → unconfigured, not offered", () => {
    const assessed = assessWizardLandingPage({
      hasPage: true,
      pageStatus: "live",
      hasClientConfig: false,
      provider: "internal",
      clientSlug: CLIENT.slug,
      eventSlug: EVENT.slug,
    });
    assert.equal(assessed.state, "unconfigured");
    assert.equal(assessed.offerUrl, false);
  });

  it("no page → none (plain URL field only)", () => {
    const assessed = assessWizardLandingPage({
      hasPage: false,
      pageStatus: null,
      hasClientConfig: false,
      provider: null,
      clientSlug: CLIENT.slug,
      eventSlug: EVENT.slug,
    });
    assert.equal(assessed.state, "none");
    assert.equal(assessed.offerUrl, false);
  });

  it("archived is not offered even with client config", () => {
    const assessed = assessWizardLandingPage({
      hasPage: true,
      pageStatus: "archived",
      hasClientConfig: true,
      provider: "internal",
      clientSlug: CLIENT.slug,
      eventSlug: EVENT.slug,
    });
    assert.equal(assessed.state, "draft");
    assert.equal(assessed.offerUrl, false);
  });
});

describe("public renderer 404 contract (offer is a subset)", () => {
  it("live internal page with no client_landing_pages still renders (theme defaults)", async () => {
    const tables = baseTables({ page_events: [livePage()] });
    const outcome = await publicOutcome(tables);
    assert.ok(outcome && outcome.kind === "render");
    assert.equal(outcome.context.landingPage, null);
    assert.equal(
      assessWizardLandingPage({
        hasPage: true,
        pageStatus: "live",
        hasClientConfig: false,
        provider: "internal",
        clientSlug: CLIENT.slug,
        eventSlug: EVENT.slug,
      }).offerUrl,
      false,
      "wizard still refuses — config is part of the offer contract",
    );
  });

  it("draft 404s even when client config exists", async () => {
    const tables = baseTables({
      page_events: [draftPage()],
      client_landing_pages: [clientConfig()],
    });
    assert.equal(await publicOutcome(tables), null);
  });
});

describe("destinationHelperKind — one line per state", () => {
  const lp = "https://app.offpixel.co.uk/l/ironworks/ironworks-jamie-jones";
  const tickets = "https://tickets.example.com/jj";

  it("ready + empty field → why, never nudge", () => {
    assert.equal(
      destinationHelperKind({
        state: "ready",
        offerUrl: true,
        lpUrl: lp,
        chosenUrl: "",
      }),
      "why",
    );
  });

  it("ready + off-funnel URL → nudge only", () => {
    assert.equal(
      destinationHelperKind({
        state: "ready",
        offerUrl: true,
        lpUrl: lp,
        chosenUrl: tickets,
      }),
      "nudge",
    );
  });

  it("ready + already using LP → no helper", () => {
    assert.equal(
      destinationHelperKind({
        state: "ready",
        offerUrl: true,
        lpUrl: lp,
        chosenUrl: lp,
      }),
      null,
    );
  });

  it("draft / unconfigured / none show no helper (no create nudge)", () => {
    assert.equal(
      destinationHelperKind({
        state: "draft",
        offerUrl: false,
        lpUrl: lp,
        chosenUrl: tickets,
      }),
      null,
    );
    assert.equal(
      destinationHelperKind({
        state: "unconfigured",
        offerUrl: false,
        lpUrl: lp,
        chosenUrl: "",
      }),
      null,
    );
    assert.equal(
      destinationHelperKind({
        state: "none",
        offerUrl: false,
        lpUrl: null,
        chosenUrl: "",
      }),
      null,
    );
  });
});
