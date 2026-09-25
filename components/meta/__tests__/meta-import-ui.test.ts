/**
 * Meta import entry point. The route already refuses a save without
 * `carry` or an event; these tests pin the dialog to that contract.
 *
 * Run: node --test components/meta/__tests__/meta-import-ui.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  metaImportCountsLine,
  metaImportDraftHref,
  metaImportErrorText,
  metaImportNotCarriedLine,
  metaImportReadBody,
  metaImportSaveBlocked,
  metaImportSaveBody,
} from "../meta-import-flow.ts";

const ROOT = new URL("../../../", import.meta.url);

function source(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

describe("library entry", () => {
  it("the Campaign Library header renders Import from Meta beside New Campaign", () => {
    const library = source("components/library/campaign-library.tsx");
    assert.match(library, /<MetaImportButton \/>/);
    const header = library.slice(library.indexOf("<header"), library.indexOf("</header>"));
    assert.match(header, /MetaImportButton/);
    assert.match(header, /New Campaign/);
    assert.match(source("components/meta/meta-import-button.tsx"), /Import from Meta/);
  });
});

describe("read saves nothing", () => {
  it("a read posts the account and campaign and no carry", () => {
    const body = metaImportReadBody("act_1", "52522388611107");
    assert.deepEqual(body, { adAccountId: "act_1", campaignId: "52522388611107" });
    assert.equal("carry" in body, false);
    const picker = source("components/meta/meta-import-picker.tsx");
    assert.match(picker, /metaImportReadBody\(adAccountId, campaignId\)/);
    assert.doesNotMatch(
      picker.slice(0, picker.indexOf("async function confirmImport")),
      /carry:/,
    );
  });
});

describe("save", () => {
  it("the event select blocks save until an event is chosen", () => {
    assert.equal(metaImportSaveBlocked("", 2), true);
    assert.equal(metaImportSaveBlocked("   ", 2), true);
    assert.equal(metaImportSaveBlocked("evt-1", 0), true);
    assert.equal(metaImportSaveBlocked("evt-1", 1), false);
    const picker = source("components/meta/meta-import-picker.tsx");
    assert.match(picker, /metaImportSaveBlocked\(eventId, ticked\.size\)/);
    assert.match(picker, /Pick an event — nothing will be saved/);
    assert.match(picker, /disabled=\{saving \|\| noEventsOnAccount \|\| blocked\}/);
    assert.match(picker, /META_IMPORT_NO_EVENTS_ON_ACCOUNT/);
    assert.doesNotMatch(picker, /This ad account is not linked to a client/);
  });

  it("save posts the ticked ids and the draft opens at the returned id", () => {
    const body = metaImportSaveBody({
      adAccountId: "act_1",
      campaignId: "52522388611107",
      carry: ["cr_a", "cr_b"],
      eventId: "evt-1",
    });
    assert.deepEqual(body.carry, ["cr_a", "cr_b"]);
    assert.equal(body.eventId, "evt-1");
    assert.equal(metaImportDraftHref("draft-9"), "/campaign/draft-9");
    const picker = source("components/meta/meta-import-picker.tsx");
    assert.match(picker, /carry: \[\.\.\.ticked\]/);
    assert.match(picker, /router\.push\(href\)/);
    assert.match(picker, /metaImportDraftHref\(saved\.draftId\)/);
    assert.match(picker, /<MetaImportReport/);
  });
});

describe("what was not carried", () => {
  it("notCarried entries render with their reason", () => {
    assert.equal(
      metaImportNotCarriedLine({ id: "c1", name: "Poster", reason: "no_asset_reported" }),
      "Poster — no_asset_reported",
    );
    assert.equal(
      metaImportNotCarriedLine({ id: "aud", name: "Lookalike", reason: "unavailable_on_ad_account" }),
      "Lookalike — unavailable_on_ad_account",
    );
    assert.match(source("components/meta/meta-import-report.tsx"), /metaImportNotCarriedLine\(row\)/);
    assert.match(source("components/meta/meta-import-picker.tsx"), /metaImportNotCarriedLine/);
    assert.match(source("components/plan/meta-drawer-details.tsx"), /<MetaImportReport/);
  });

  it("counts name ad sets, carried and not carried", () => {
    assert.equal(
      metaImportCountsLine({
        adSetCount: 3,
        creativeCounts: { read: 8, carried: 5, notCarried: 3 },
      }),
      "3 ad sets · 5 of 8 creatives carried · 3 not carried",
    );
  });
});

describe("route errors", () => {
  it("renders the route's own message verbatim", () => {
    const refused = "Meta import refused: objective APP_INSTALLS is not supported";
    assert.equal(metaImportErrorText({ error: refused }), refused);
    assert.equal(metaImportErrorText({ error: "event_id is required" }), "event_id is required");
    assert.equal(
      metaImportErrorText({ error: "event_id does not belong to this client" }),
      "event_id does not belong to this client",
    );
    assert.equal(
      metaImportErrorText({ error: "Meta import failed: /{campaign_id}/adsets returned no ad sets for 1" }),
      "Meta import failed: /{campaign_id}/adsets returned no ad sets for 1",
    );
    assert.match(source("components/meta/meta-import-picker.tsx"), /setError\(metaImportErrorText\(json\)\)/);
    assert.doesNotMatch(source("components/meta/meta-import-picker.tsx"), /Import failed/);
  });
});
