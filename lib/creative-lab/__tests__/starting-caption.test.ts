import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { recordStartingCaption, STARTING_PRIMARY, startingCaptionStyle } from "../starting-caption.ts";
import { fakeDb } from "./fake-db.ts";

const USER = "op";
const EVENT = "evt-1";

function db() {
  return fakeDb({
    events: [{
      id: EVENT,
      client_id: "client-1",
      user_id: USER,
      name: "Puzzle",
      status: "on_sale",
      event_date: "2026-12-27",
      venue_name: "Circuit",
      venue_city: "Southampton",
    }],
    creative_lab_event_facts: [{ event_id: EVENT, lineup: ["Luke Dean"], headliners: ["Luke Dean"], allowed_dates: [] }],
    event_ticket_tiers: [],
    creative_lab_captions: [],
  });
}

describe("starting caption", () => {
  it("treats first person as the artist and our as the promoter", () => {
    assert.equal(startingCaptionStyle("I'll see you at Circuit"), "artist_first_person");
    assert.equal(startingCaptionStyle("Luke Dean joins for our 4th Birthday. You in?"), "lineup");
  });

  it("inserts a passing starting caption as a proposed control", async () => {
    const fake = db();
    const result = await recordStartingCaption(fake as unknown as ServiceRoleDb, {
      userId: USER,
      eventId: EVENT,
      artistName: "Luke Dean",
      text: "Luke Dean joins",
      now: new Date("2026-11-06T12:00:00Z"),
    });
    assert.equal(result?.ok, true);
    assert.equal(result?.inserted, true);
    assert.equal(result?.style, "lineup");
    const row = fake.tables.creative_lab_captions[0];
    assert.equal(row.status, "proposed");
    assert.equal(row.primary_text, STARTING_PRIMARY);
    assert.equal(row.text, "Luke Dean joins");

    const again = await recordStartingCaption(fake as unknown as ServiceRoleDb, {
      userId: USER,
      eventId: EVENT,
      artistName: "Luke Dean",
      text: "Luke Dean joins",
      now: new Date("2026-11-06T12:00:00Z"),
    });
    assert.equal(again?.inserted, false);
    assert.equal(fake.tables.creative_lab_captions.length, 1);
  });
});
