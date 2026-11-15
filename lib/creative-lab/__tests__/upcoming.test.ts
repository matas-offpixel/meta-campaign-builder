import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ServiceRoleDb } from "../load.ts";
import { loadUpcomingLineups, londonDay, nextThreeNames } from "../upcoming.ts";
import { fakeDb } from "./fake-db.ts";

describe("upcoming lineups", () => {
  it("keeps a show on its London day and drops it the day after", async () => {
    assert.equal(londonDay(new Date("2026-11-07T23:30:00Z")), "2026-11-07");
    assert.equal(londonDay(new Date("2026-11-08T00:30:00Z")), "2026-11-08");
    const db = fakeDb({
      events: [
        { id: "tonight", client_id: "client", name: "Tonight", event_date: "2026-11-07" },
        { id: "later", client_id: "client", name: "Later", event_date: "2026-12-27" },
        { id: "past", client_id: "client", name: "Past", event_date: "2026-11-06" },
        { id: "empty", client_id: "client", name: "No lineup", event_date: "2026-11-09" },
        { id: "other", client_id: "someone-else", name: "Other", event_date: "2026-11-09" },
      ],
      creative_lab_event_facts: [
        { event_id: "tonight", lineup: ["Schak", "Resident"], headliners: ["Schak"] },
        { event_id: "later", lineup: ["East End Dubs", "Friend"], headliners: ["East End Dubs"] },
        { event_id: "past", lineup: ["Azyr"], headliners: ["Azyr"] },
        { event_id: "empty", lineup: ["Secret"], headliners: [] },
        { event_id: "other", lineup: ["Folamour"], headliners: ["Folamour"] },
      ],
    });
    const onTheNight = await loadUpcomingLineups(db as unknown as ServiceRoleDb, "client", "2026-11-07");
    assert.deepEqual(onTheNight.map((show) => show.eventId), ["tonight", "later"]);
    const dayAfter = await loadUpcomingLineups(db as unknown as ServiceRoleDb, "client", "2026-11-08");
    assert.deepEqual(dayAfter.map((show) => show.eventId), ["later"]);
    assert.deepEqual(nextThreeNames(onTheNight), ["Schak", "East End Dubs"]);
    assert.equal(onTheNight.some((show) => show.lineup.includes("Resident") && show.headliners.includes("Resident")), false);
  });
});
