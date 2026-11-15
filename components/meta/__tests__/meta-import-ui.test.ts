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
  META_IMPORT_NO_EVENT_LABEL,
  META_IMPORT_NO_EVENTS_YET,
  metaImportEventPickerOptions,
} from "../../../lib/meta/import/event.ts";
import {
  metaImportCountsLine,
  metaImportDraftHref,
  metaImportErrorText,
  metaImportNotCarriedLine,
  metaImportPickerDropLines,
  metaImportReadBody,
  metaImportSaveBlocked,
  metaImportSaveBody,
  summariseMetaImportPickerDrops,
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
  it("Picker: Import enabled with zero events", () => {
    assert.equal(metaImportSaveBlocked(2), false);
    assert.equal(metaImportSaveBlocked(0), true);
    const options = metaImportEventPickerOptions([]);
    assert.deepEqual(options, [{ value: "", label: META_IMPORT_NO_EVENT_LABEL }]);
    assert.equal(
      META_IMPORT_NO_EVENTS_YET,
      "No events yet — import without one and attach on the Campaign step",
    );
    const picker = source("components/meta/meta-import-picker.tsx");
    assert.match(picker, /metaImportSaveBlocked\(ticked\.size\)/);
    assert.match(picker, /META_IMPORT_NO_EVENTS_YET/);
    assert.match(picker, /disabled=\{saving \|\| blocked\}/);
    assert.doesNotMatch(picker, /noEventsOnAccount/);
    assert.doesNotMatch(picker, /META_IMPORT_NO_EVENTS_ON_ACCOUNT/);
    assert.doesNotMatch(picker, /Pick an event — nothing will be saved/);
    assert.doesNotMatch(picker, /disabled=\{saving \|\| events\.length === 0\}/);
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
    assert.match(source("components/plan/meta-drawer-details.tsx"), /<MetaImportReport/);
    const picker = source("components/meta/meta-import-picker.tsx");
    assert.match(picker, /summariseMetaImportPickerDrops/);
    assert.doesNotMatch(picker, /metaImportNotCarriedLine/);
    assert.match(picker, /sticky bottom-0/);
    assert.match(picker, /max-h-40 overflow-y-auto/);
    assert.match(picker, /Show all/);
  });

  it("Picker render helper: 40 unticked + 2 no_media → 40 creatives unticked + one grouped line naming both; no per-row operator_unticked output", () => {
    const rows = [
      ...Array.from({ length: 40 }, (_, index) => ({
        id: `u${index}`,
        name: `Unticked ${index}`,
        reason: "operator_unticked",
      })),
      { id: "m1", name: "Don Diablo 2026-10-01", reason: "no_media_reported" },
      { id: "m2", name: "Don Diablo -Feed 2026-09-30", reason: "no_media_reported" },
    ];
    const lines = metaImportPickerDropLines(summariseMetaImportPickerDrops(rows));
    assert.deepEqual(lines, [
      "40 creatives unticked",
      "2 creatives have no media on Meta and were skipped: Don Diablo 2026-10-01, Don Diablo -Feed 2026-09-30",
    ]);
    assert.equal(lines.join("\n").includes("operator_unticked"), false);
    assert.equal(lines.join("\n").includes("Unticked 0"), false);
  });

  it("5 drops of one reason → 3 names + +2 more", () => {
    const summary = summariseMetaImportPickerDrops(
      ["One", "Two", "Three", "Four", "Five"].map((name, index) => ({
        name,
        reason: "no_media_reported",
        id: `d${index}`,
      })),
    );
    assert.equal(summary.groups.length, 1);
    assert.equal(
      summary.groups[0]?.summary,
      "5 creatives have no media on Meta and were skipped: One, Two, Three, +2 more",
    );
    assert.deepEqual(summary.groups[0]?.names, ["One", "Two", "Three", "Four", "Five"]);
  });

  it("Suffix stripped in display, present in log payload", () => {
    const hex = "3c6ea094c3d72e4344ee1523fd4bdfa0";
    const logPayload = [
      {
        id: "m1",
        name: `Don Diablo 2026-10-01-${hex}`,
        reason: "no_media_reported",
      },
      {
        id: "m2",
        name: "Don Diablo -Feed 2026-09-30",
        reason: "no_media_reported",
      },
      {
        id: "bare",
        name: hex,
        reason: "no_asset_reported",
      },
    ];
    const summary = summariseMetaImportPickerDrops(logPayload);
    assert.equal(
      summary.groups[0]?.summary,
      "2 creatives have no media on Meta and were skipped: Don Diablo 2026-10-01, Don Diablo -Feed 2026-09-30",
    );
    assert.equal(summary.groups[0]?.summary.includes(hex), false);
    assert.equal(summary.groups[1]?.names[0], hex);
    assert.equal(logPayload[0]?.name, `Don Diablo 2026-10-01-${hex}`);
    assert.equal(logPayload[1]?.name, "Don Diablo -Feed 2026-09-30");
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

  it("counts unique creatives and the ads behind them after grouping", () => {
    assert.equal(
      metaImportCountsLine({
        adSetCount: 16,
        creativeCounts: { read: 77, uniqueCreatives: 5, adsRead: 77, carried: 5, notCarried: 0 },
      }),
      "16 ad sets · 5 of 5 creatives carried (77 ads) · 0 not carried",
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
