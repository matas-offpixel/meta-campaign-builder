import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../campaign-defaults.ts";
import {
  applyEventToCampaignSettings,
  buildDuplicatedCampaign,
  describeCarrierMismatch,
  describeCodeEventMismatch,
  duplicateCampaignSettings,
  eventCarriersDisagree,
  formatWiredEventLabel,
  replaceEventCodePrefix,
  resolveDraftEventId,
} from "../campaign-event.ts";
import type { CampaignSettings } from "../types.ts";

const MALL_GRAB = {
  id: "event-mallgrab",
  event_code: "ES26-MALLGRAB",
  client_id: "client-es",
  name: "Mall Grab",
  venue_city: "Sheffield",
  event_date: "2026-09-04",
};

const SCHAK = {
  id: "event-schak",
  event_code: "NX26-SCHAK",
  client_id: "client-nx",
  name: "SCHAK",
  venue_city: "Newcastle",
  event_date: "2026-09-18",
};

const AZYR = {
  id: "event-azyr",
  event_code: "NX26-AZYR",
  client_id: "client-nx",
  name: "AZYR",
  venue_city: "Newcastle",
  event_date: "2026-09-18",
};

const ARMED_MISMATCHES: Array<{
  campaignCode: string;
  campaignName: string;
  event: typeof MALL_GRAB;
}> = [
  { campaignCode: "NX26-SCHAK", campaignName: "[NX26-SCHAK] Registration", event: MALL_GRAB },
  { campaignCode: "NX26-AZYR", campaignName: "[NX26-AZYR] Registration", event: MALL_GRAB },
  { campaignCode: "NX26-DJEZ", campaignName: "[NX26-DJEZ] Registration", event: MALL_GRAB },
  { campaignCode: "NX26-IPC", campaignName: "[NX26-IPC] Registration", event: MALL_GRAB },
  { campaignCode: "EE26-EED", campaignName: "[EE26-EED] Registration", event: MALL_GRAB },
];

function settings(partial: Partial<CampaignSettings> = {}): CampaignSettings {
  return {
    ...createDefaultDraft().settings,
    campaignCode: "NX26-SCHAK",
    campaignName: "[NX26-SCHAK] SCHAK - Registration",
    eventId: MALL_GRAB.id,
    clientId: MALL_GRAB.client_id,
    ...partial,
  };
}

describe("resolveDraftEventId — JSON is the source of truth", () => {
  it("uses settings.eventId when both carriers are set", () => {
    assert.equal(resolveDraftEventId("json-event", "column-event"), "json-event");
  });

  it("falls back to the column when JSON is empty", () => {
    assert.equal(resolveDraftEventId("", "column-event"), "column-event");
    assert.equal(resolveDraftEventId(undefined, "column-event"), "column-event");
  });

  it("returns null when neither is set", () => {
    assert.equal(resolveDraftEventId("", ""), null);
    assert.equal(resolveDraftEventId(undefined, null), null);
  });

  it("reports a draft whose column and JSON disagree", () => {
    assert.equal(eventCarriersDisagree("json-event", "column-event"), true);
    assert.equal(eventCarriersDisagree("same", "same"), false);
    assert.equal(eventCarriersDisagree("", "column-event"), false);
    const text = describeCarrierMismatch({
      jsonEventId: SCHAK.id,
      columnEventId: MALL_GRAB.id,
      jsonEvent: SCHAK,
      columnEvent: MALL_GRAB,
    });
    assert.match(text ?? "", /draft says NX26-SCHAK/);
    assert.match(text ?? "", /column still ES26-MALLGRAB/);
    assert.match(text ?? "", /Using the draft/);
  });
});

describe("duplicateCampaignSettings — must choose its event", () => {
  it("throws rather than inheriting when no event is chosen", () => {
    assert.throws(
      () => duplicateCampaignSettings(settings(), { id: "" }),
      /eventId is required/,
    );
  });

  it("does not keep the source eventId", () => {
    const next = duplicateCampaignSettings(settings(), SCHAK);
    assert.equal(next.eventId, SCHAK.id);
    assert.notEqual(next.eventId, MALL_GRAB.id);
  });

  it("re-derives campaignCode and the [CODE] prefix, leaves the rest of the name", () => {
    const next = duplicateCampaignSettings(settings(), AZYR);
    assert.equal(next.campaignCode, "NX26-AZYR");
    assert.equal(next.campaignName, "[NX26-AZYR] SCHAK - Registration (Copy)");
    assert.equal(next.clientId, AZYR.client_id);
  });

  it("leaves a hand-edited name with no prefix alone beyond (Copy)", () => {
    const next = duplicateCampaignSettings(
      settings({ campaignName: "My special launch" }),
      AZYR,
    );
    assert.equal(next.campaignName, "My special launch (Copy)");
    assert.equal(next.campaignCode, "NX26-AZYR");
  });

  it("a draft whose code and event already agree is byte-identical after apply", () => {
    const agreeing = settings({
      eventId: SCHAK.id,
      clientId: SCHAK.client_id,
      campaignCode: "NX26-SCHAK",
      campaignName: "[NX26-SCHAK] SCHAK - Registration",
    });
    assert.deepEqual(applyEventToCampaignSettings(agreeing, SCHAK), agreeing);
  });
});

describe("describeCodeEventMismatch — names both sides", () => {
  it("the five armed mismatches each name both sides", () => {
    for (const row of ARMED_MISMATCHES) {
      const text = describeCodeEventMismatch({
        campaignCode: row.campaignCode,
        campaignName: row.campaignName,
        event: row.event,
      });
      assert.ok(text, row.campaignCode);
      assert.match(text, new RegExp(`code says ${row.campaignCode}`));
      assert.match(text, /wired to ES26-MALLGRAB \(Mall Grab, Sheffield, 4 Sep\)/);
    }
  });

  it("a correct draft produces no warning", () => {
    assert.equal(
      describeCodeEventMismatch({
        campaignCode: "NX26-AZYR",
        campaignName: "[NX26-AZYR] Registration",
        event: AZYR,
      }),
      null,
    );
  });

  it("formats the wired event the operator can check", () => {
    assert.equal(
      formatWiredEventLabel(MALL_GRAB),
      "ES26-MALLGRAB (Mall Grab, Sheffield, 4 Sep)",
    );
  });
});

describe("replaceEventCodePrefix", () => {
  it("replaces only the first [CODE]", () => {
    assert.equal(
      replaceEventCodePrefix("[NX26-SCHAK] keep this [not-a-code]", "NX26-AZYR"),
      "[NX26-AZYR] keep this [not-a-code]",
    );
  });
});

describe("buildDuplicatedCampaign", () => {
  it("stamps a new id and draft status", () => {
    const original = createDefaultDraft();
    original.settings = settings();
    original.status = "published";
    const copy = buildDuplicatedCampaign(
      original,
      SCHAK,
      "2026-09-13T12:00:00.000Z",
      "copy-id",
    );
    assert.equal(copy.id, "copy-id");
    assert.equal(copy.status, "draft");
    assert.equal(copy.settings.eventId, SCHAK.id);
    assert.match(copy.settings.campaignName, /\(Copy\)$/);
  });
});

describe("production call sites — no silent inherit", () => {
  it("duplicateCampaign requires eventId and does not default it from the source", () => {
    const src = readFileSync("lib/db/drafts.ts", "utf8");
    assert.match(src, /export async function duplicateCampaign\(/);
    assert.match(src, /eventId: string/);
    assert.match(src, /if \(!eventId\?\.trim\(\)\) return null/);
    assert.match(src, /buildDuplicatedCampaign/);
    assert.match(readFileSync("lib/campaign-event.ts", "utf8"), /\(Copy\)/);
    assert.doesNotMatch(src, /eventId:\s*original\.settings\.eventId/);
  });

  it("both library call sites prompt before duplicateCampaign", () => {
    const library = readFileSync("components/library/campaign-library.tsx", "utf8");
    assert.match(library, /EventPickDialog/);
    assert.match(library, /setEventPick/);
    assert.match(library, /duplicateCampaign\(/);
    assert.match(library, /duplicateCampaign\(eventPick\.sourceId, userId, pickedEventId\)/);
  });

  it("the campaign picker reuses the plan library modal, not a second one", () => {
    const dialog = readFileSync("components/library/event-pick-dialog.tsx", "utf8");
    const plan = readFileSync("components/library/plan-library.tsx", "utf8");
    assert.match(dialog, /Pick the event\. Identities re-resolve from that client\. Launched campaigns stay put\./);
    assert.match(plan, /EventPickDialog/);
    assert.match(plan, /from "@\/components\/library\/event-pick-dialog"/);
  });

  it("evaluate.ts, apply.ts, gates.ts, and plan-workspace.tsx match origin/main", () => {
    for (const file of [
      "lib/optimisation/evaluate.ts",
      "lib/optimisation/apply.ts",
      "lib/optimisation/gates.ts",
      "components/plan/plan-workspace.tsx",
    ]) {
      const main = execSync(`git show origin/main:${file}`, { encoding: "utf8" });
      assert.equal(readFileSync(file, "utf8"), main, file);
    }
  });

  it("Campaign Setup shows the event and names a mismatch", () => {
    const setup = readFileSync("components/steps/campaign-setup.tsx", "utf8");
    assert.match(setup, /describeCodeEventMismatch/);
    assert.match(setup, /Use this event/);
    assert.match(setup, /Wired to/);
  });
});
