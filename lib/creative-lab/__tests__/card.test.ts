import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { headlinerError, loadCreativeLabCard, rightsLabel, rightsState } from "../../db/creative-lab.ts";
import type { ServiceRoleDb } from "../load.ts";
import { fakeDb } from "./fake-db.ts";

const EVENT = "d2fa91e6-b245-4064-8a20-402a8c0a4dd1";
const LUKE = "fe3736d8-4252-4282-bb32-de1e3fdfb359";

describe("creative lab card", () => {
  it("names the three rights states", () => {
    assert.equal(rightsState({}), "missing");
    assert.equal(rightsLabel({}), "missing");
    assert.equal(rightsState({ rights_doc_ref: "PENDING: Luke Dean team" }), "recorded");
    assert.equal(rightsLabel({ rights_doc_ref: "PENDING: Luke Dean team" }), "recorded, not approved (PENDING: Luke Dean team)");
    assert.equal(rightsState({ rights_doc_ref: "signed", approved_at: "2026-11-06T00:00:00Z" }), "approved");
    assert.equal(rightsLabel({ rights_doc_ref: "signed", approved_at: "2026-11-06T00:00:00Z" }), "approved (signed)");
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
    assert.equal(card.artists[0]?.rightsLabel, "recorded, not approved (PENDING: Luke Dean team)");
    assert.equal(card.rounds.length, 0);
    assert.equal(card.launchesEnabled, false);
    assert.equal(card.daysToEvent, 51);
    assert.match(card.paydayLabel, /November 2026|2026/);
  });
});
