import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { headlinerError, loadCreativeLabCard, rightsLabel, rightsState } from "../../db/creative-lab.ts";
import type { ServiceRoleDb } from "../load.ts";
import { cantRunReason, clipBucket } from "../surface.ts";
import { fakeDb } from "./fake-db.ts";

const EVENT = "d2fa91e6-b245-4064-8a20-402a8c0a4dd1";
const LUKE = "fe3736d8-4252-4282-bb32-de1e3fdfb359";

describe("creative lab card", () => {
  it("names the three rights states", () => {
    assert.equal(rightsState({}), "missing");
    assert.equal(rightsLabel({}), "Promoter page only");
    assert.equal(rightsState({ rights_doc_ref: "PENDING: Luke Dean team" }), "recorded");
    assert.equal(rightsLabel({ rights_doc_ref: "PENDING: Luke Dean team" }), "Promoter page only");
    assert.equal(rightsState({ approved_at: "2026-11-06T00:00:00Z" }), "approved");
    assert.equal(rightsLabel({ approved_at: "2026-11-06T00:00:00Z" }), "Cleared — artist channels too");
  });

  it("keeps headliners as an ordered subset of the lineup", () => {
    assert.equal(headlinerError(["Enzo Siragusa", "Luke Dean"], ["Luke Dean", "Enzo Siragusa"]), null);
    assert.equal(headlinerError(["Enzo Siragusa"], []), null);
    assert.match(headlinerError(["Enzo Siragusa"], ["Luke Dean"]) ?? "", /not on the lineup/);
  });

  it("loads Puzzle facts, Luke Dean recorded but not approved, and no rounds", async () => {
    const db = fakeDb({
      creative_lab_event_facts: [
        {
          event_id: EVENT,
          lineup: ["Enzo Siragusa", "Luke Dean", "Reeshy", "Phill de Janeiro", "Benji King"],
          headliners: ["Enzo Siragusa", "Luke Dean", "Reeshy"],
          allowed_dates: ["2026-12-27"],
        },
      ],
      creative_lab_artists: [
        {
          id: LUKE,
          client_id: "92f7334b-ef76-4095-88d6-f422ba1ff3f2",
          name: "Luke Dean",
          rights_doc_ref: "PENDING: Luke Dean team",
          approved_at: null,
          starting_caption: null,
        },
      ],
      creative_lab_captions: [],
      creative_lab_rounds: [],
      creative_lab_clips: [],
      creative_lab_round_ads: [],
      creative_lab_round_ad_launches: [],
      launched_ad_sets: [],
      launched_ads: [],
      creative_assets: [],
      events: [{ id: EVENT, client_id: "92f7334b-ef76-4095-88d6-f422ba1ff3f2", name: "Puzzle 4th Birthday Part 1", event_date: "2026-12-27" }],
    });
    const card = await loadCreativeLabCard(db as unknown as ServiceRoleDb, {
      eventId: EVENT,
      userId: "op",
      clientId: "92f7334b-ef76-4095-88d6-f422ba1ff3f2",
      eventName: "Puzzle 4th Birthday Part 1",
      eventDate: "2026-12-27",
      venueName: "Circuit",
      venueCity: "Southampton",
      eventStatus: "upcoming",
      now: new Date("2026-11-06T12:00:00Z"),
    });
    assert.deepEqual(card.facts?.lineup[0], "Enzo Siragusa");
    assert.deepEqual(card.facts?.headliners, ["Enzo Siragusa", "Luke Dean", "Reeshy"]);
    assert.equal(card.artists[0]?.rightsLabel, "Promoter page only");
    assert.equal(card.rounds.length, 0);
    assert.equal(card.launchesEnabled, false);
    assert.equal(card.daysToEvent, 51);
    assert.match(card.paydayLabel, /November 2026|2026/);
  });

  it("loads a press-kit clip with burned-in text into Can't run", async () => {
    const burned = { verdict: "text_overlay", frames: [], reason: "Text burned into 3 of 8 frames", flagged: 3 };
    const clean = { verdict: "clean", frames: [], reason: "", flagged: 0 };
    const db = fakeDb({
      creative_lab_event_facts: [{ event_id: EVENT, lineup: ["Luke Dean"], headliners: ["Luke Dean"], allowed_dates: ["2026-12-27"] }],
      creative_lab_artists: [{ id: LUKE, client_id: "92f7334b-ef76-4095-88d6-f422ba1ff3f2", name: "Luke Dean", approved_at: "2026-11-01T00:00:00Z" }],
      creative_lab_captions: [],
      creative_lab_rounds: [],
      creative_lab_clips: [
        { id: "clip-burned", user_id: "op", artist_id: LUKE, clip_no: 1, source: "presskit", overlay_check: burned, in_s: 0, out_s: 8 },
        { id: "clip-clean", user_id: "op", artist_id: LUKE, clip_no: 2, source: "presskit", overlay_check: clean, in_s: 0, out_s: 8 },
        { id: "clip-ig", user_id: "op", artist_id: LUKE, clip_no: 3, source: "instagram", overlay_check: burned, in_s: 0, out_s: 8 },
      ],
      creative_lab_round_ads: [],
      creative_lab_round_ad_launches: [],
      launched_ad_sets: [],
      launched_ads: [],
      creative_assets: [],
      events: [{ id: EVENT, client_id: "92f7334b-ef76-4095-88d6-f422ba1ff3f2", name: "Puzzle 4th Birthday", event_date: "2026-12-27" }],
    });
    const card = await loadCreativeLabCard(db as unknown as ServiceRoleDb, {
      eventId: EVENT,
      userId: "op",
      clientId: "92f7334b-ef76-4095-88d6-f422ba1ff3f2",
      eventName: "Puzzle 4th Birthday",
      eventDate: "2026-12-27",
      venueName: "Circuit & Engine Rooms",
      venueCity: "Southampton",
      eventStatus: "upcoming",
      now: new Date("2026-11-06T12:00:00Z"),
    });
    const textClip = card.clips.find((clip) => clip.id === "clip-burned");
    const cleanClip = card.clips.find((clip) => clip.id === "clip-clean");
    const igClip = card.clips.find((clip) => clip.id === "clip-ig");
    assert.equal(textClip?.overlay?.verdict, "text_overlay");
    assert.equal(clipBucket(textClip!), "cant");
    assert.equal(cantRunReason(textClip!), "Text burned into 3 of 8 frames");
    assert.equal(clipBucket(cleanClip!), "new");
    assert.equal(cantRunReason(cleanClip!), null);
    assert.equal(clipBucket(igClip!), "new");
  });
});
