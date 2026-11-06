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
  it("follows the artist's voice, not the wording", () => {
    assert.equal(startingCaptionStyle(true), "artist_first_person");
    assert.equal(startingCaptionStyle(false), "lineup");
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

  it("stores a Page-backed starting caption as the artist's voice", async () => {
    const fake = db();
    fake.tables.creative_lab_event_facts[0].lineup = ["Enzo Siragusa"];
    fake.tables.creative_lab_event_facts[0].headliners = ["Enzo Siragusa"];
    fake.tables.events.push({
      id: "past-1",
      client_id: "client-1",
      name: "Puzzle",
      event_date: "2025-12-27",
      venue_name: "Engine Rooms",
      venue_city: "Southampton",
    });
    fake.tables.creative_lab_event_facts.push({
      event_id: "past-1",
      lineup: ["Enzo Siragusa"],
      headliners: ["Enzo Siragusa"],
      allowed_dates: [],
    });
    const text = "Back in Southampton on 27th December to close out the year w/ Puzzle.";
    const result = await recordStartingCaption(fake as unknown as ServiceRoleDb, {
      userId: USER,
      eventId: EVENT,
      artistName: "Enzo Siragusa",
      text,
      metaPageId: "page-enzo",
      now: new Date("2026-11-06T12:00:00Z"),
    });
    assert.equal(result?.style, "artist_first_person");
    assert.equal(result?.ok, true, result?.errors.map((error) => error.detail).join("; "));
    assert.equal(fake.tables.creative_lab_captions[0].style, "artist_first_person");
  });
});
