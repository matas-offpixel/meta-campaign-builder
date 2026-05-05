import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  searchTicketingEvents,
  type SearchableTicketingEvent,
} from "../event-search.ts";

function ev(
  overrides: Partial<SearchableTicketingEvent> & {
    externalEventId: string;
    externalEventName: string;
  },
): SearchableTicketingEvent {
  return {
    externalEventStartsAt: null,
    externalEventUrl: null,
    externalVenue: null,
    externalCapacity: null,
    connectionId: "conn-1",
    connectionProvider: "fourthefans",
    ...overrides,
  };
}

describe("searchTicketingEvents", () => {
  const events = [
    ev({
      externalEventId: "4012",
      externalEventName: "Tottenham England v Croatia",
      externalVenue: "Unknown provider venue",
      externalEventStartsAt: "2026-06-17",
    }),
    ev({
      externalEventId: "4206",
      externalEventName: "Tottenham England v Ghana",
      externalVenue: "Club360",
      externalEventStartsAt: "2026-06-24",
    }),
    ev({
      externalEventId: "4218",
      externalEventName: "Tottenham England v Panama",
      externalVenue: "Club360",
      externalEventStartsAt: "2026-06-27",
    }),
    ev({
      externalEventId: "4239",
      externalEventName: "Tottenham Last 32",
      externalVenue: "Club360",
      externalEventStartsAt: "2026-06-30",
    }),
    ev({
      externalEventId: "3276",
      externalEventName: "Bristol England v Croatia",
      externalVenue: "The Prospect Building, Bristol",
      externalEventStartsAt: "2026-06-17",
    }),
  ];

  it("finds Tottenham events by venue/name tokens", () => {
    const results = searchTicketingEvents(events, "Tottenham", 10);
    assert.deepEqual(
      results.map((result) => result.externalEventId).sort(),
      ["4012", "4206", "4218", "4239"],
    );
  });

  it("finds a pasted 4thefans event id directly", () => {
    const results = searchTicketingEvents(events, "4218", 10);
    assert.equal(results[0]?.externalEventId, "4218");
  });

  it("finds already auto-matched venues by name and venue", () => {
    const results = searchTicketingEvents(events, "Bristol Croatia", 10);
    assert.equal(results[0]?.externalEventId, "3276");
  });

  it("limits results to the requested count", () => {
    const results = searchTicketingEvents(events, "Tottenham", 2);
    assert.equal(results.length, 2);
  });

  it("boosts candidates that match the local venue", () => {
    const results = searchTicketingEvents(
      [
        ev({
          externalEventId: "wrong-venue",
          externalEventName: "England v Panama",
          externalVenue: "O2 Academy Birmingham",
        }),
        ev({
          externalEventId: "right-venue",
          externalEventName: "England v Panama",
          externalVenue: "Depot Mayfield",
        }),
      ],
      "england v panama",
      10,
      "Depot Mayfield",
    );
    assert.equal(results[0]?.externalEventId, "right-venue");
  });
});
