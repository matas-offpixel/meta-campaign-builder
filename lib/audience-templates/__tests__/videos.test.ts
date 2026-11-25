/**
 * Picked videos are this draft's, for this event (25 Nov ruling): the
 * template never stores them, Replicate's copy never carries them, and a
 * pick for another event is never used.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultDraft } from "../../campaign-defaults.ts";
import { replicateDraft, type ReplicateEvent, type ReplicateVenue } from "../../replicate/replicate.ts";
import { HOUSE_DISCO, RC_E_DATA, RC_E_EVENT, RC_E_KNOWN, RC_E_PICKS } from "../../../scripts/plan-frames/audience-templates-fixtures.ts";
import { itemRow, ITEM_CONFLICT_KEY } from "../store.ts";
import { buildTemplateView } from "../view.ts";
import { isUsablePick, pickFor, withPick } from "../videos.ts";

const video = HOUSE_DISCO.items.find((i) => i.listRole === "video_viewers")!;

describe("picks", () => {
  it("one pick per template item and event; a new pick replaces it", () => {
    const next = withPick(RC_E_PICKS, { ...RC_E_PICKS[0]!, videoIds: ["1200000000000009"] });
    assert.equal(next.length, 1);
    assert.deepEqual(next[0]!.videoIds, ["1200000000000009"]);
    const other = withPick(RC_E_PICKS, { ...RC_E_PICKS[0]!, eventId: "e2", code: "NX26-OTHER" });
    assert.equal(other.length, 2);
  });

  it("a pick is used only for its own template, item and event", () => {
    assert.ok(pickFor(RC_E_PICKS, "House & disco", video, RC_E_EVENT));
    assert.equal(pickFor(RC_E_PICKS, "Techno", video, RC_E_EVENT), null);
    assert.equal(pickFor(RC_E_PICKS, "House & disco", { ...video, retentionDays: 60 }, RC_E_EVENT), null);
    assert.equal(pickFor(RC_E_PICKS, "House & disco", video, { ...RC_E_EVENT, eventId: "another" }), null);
    assert.equal(pickFor(RC_E_PICKS, "House & disco", HOUSE_DISCO.items[0]!, RC_E_EVENT), null);
  });

  it("usable only with numeric video ids and their page", () => {
    assert.ok(isUsablePick(RC_E_PICKS[0]));
    assert.equal(isUsablePick({ ...RC_E_PICKS[0]!, videoIds: [] }), false);
    assert.equal(isUsablePick({ ...RC_E_PICKS[0]!, contextId: undefined }), false);
  });
});

describe("Save to template never stores picked videos", () => {
  it("the template's items are the same before and after picking", () => {
    const before = JSON.stringify(HOUSE_DISCO.items);
    buildTemplateView(HOUSE_DISCO, RC_E_KNOWN, {
      accountId: RC_E_DATA.accountId,
      accountName: RC_E_DATA.accountName,
      pixelId: RC_E_DATA.pixelId,
      pixelName: RC_E_DATA.pixelName,
      writesEnabled: false,
      confirmerName: () => null,
      picks: (it) => pickFor(RC_E_PICKS, "House & disco", it, RC_E_EVENT),
    });
    assert.equal(JSON.stringify(HOUSE_DISCO.items), before);
  });

  it("a saved row carries no video ids, and only pages are saved", () => {
    const row = itemRow(video, "u1") as Record<string, unknown>;
    assert.ok(!JSON.stringify(row).includes("1200000000000001"));
    assert.deepEqual(row.detail, { threshold: 50 });
    assert.ok(!ITEM_CONFLICT_KEY.includes("video"));
    const action = readFileSync(new URL("../../actions/audience-templates.ts", import.meta.url), "utf8");
    const save = action.slice(action.indexOf("export async function saveTemplatePages"));
    assert.match(save, /items\.filter\(\(i\) => i\.kind === "page_engagers"/);
    assert.doesNotMatch(save, /videoIds|TemplateVideoPick|picks/);
  });
});

describe("Replicate", () => {
  const SOURCE_EVENT: ReplicateEvent = {
    id: RC_E_EVENT.eventId,
    event_code: RC_E_EVENT.code,
    client_id: "client-electric",
    name: "Locklead",
    venue_name: "NX Newcastle",
    event_date: "2027-02-27",
    general_sale_at: "2026-11-20T12:00:00Z",
    signup_url: null,
    meta_ad_account_id: "606252931141334",
  };
  const TARGET_EVENT: ReplicateEvent = { ...SOURCE_EVENT, id: "event-other", event_code: "NX27-OTHER", name: "Other" };
  const VENUE: ReplicateVenue = { id: "venue-nx", name: "NX Newcastle", meta_ad_account_id: "act_606252931141334", meta_pixel_id: "645185673672763" };

  it("the copy carries no picks", () => {
    const source = createDefaultDraft();
    source.settings = { ...source.settings, eventId: RC_E_EVENT.eventId, campaignCode: RC_E_EVENT.code, campaignName: `[${RC_E_EVENT.code}] PURCHASE` };
    source.templateVideoPicks = RC_E_PICKS;
    const { draft } = replicateDraft(source, { event: TARGET_EVENT, venue: VENUE }, { sourceEvent: SOURCE_EVENT, now: new Date("2026-11-26T09:00:00Z"), id: "copy" });
    assert.ok(!("templateVideoPicks" in draft), "dropped, not emptied");
    assert.ok(!JSON.stringify(draft).includes("1200000000000001"));
    assert.deepEqual(source.templateVideoPicks, RC_E_PICKS, "the source draft keeps its own");
    // And were one ever copied, the copy's event wouldn't use it.
    assert.equal(pickFor(RC_E_PICKS, "House & disco", video, { eventId: draft.settings.eventId ?? "", code: draft.settings.campaignCode }), null);
  });
});
