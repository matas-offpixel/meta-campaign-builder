import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  composeMatchableExternalLabel,
  composeMatchableInternalLabel,
  datesWithinWindow,
  discoverMatches,
  scoreCandidatesForEvent,
  type ExternalEventForMatching,
  type InternalEventForMatching,
} from "../link-discovery.ts";

function intEv(
  overrides: Partial<InternalEventForMatching> & { id: string; name: string },
): InternalEventForMatching {
  return {
    event_date: null,
    venue_name: null,
    venue_city: null,
    ...overrides,
  };
}

function extEv(
  overrides: Partial<ExternalEventForMatching> & {
    externalEventId: string;
    name: string;
  },
): ExternalEventForMatching {
  return {
    startsAt: null,
    url: null,
    ...overrides,
  };
}

describe("datesWithinWindow", () => {
  it("returns false for nulls / unparseable dates", () => {
    assert.equal(datesWithinWindow(null, "2026-06-01", 3), false);
    assert.equal(datesWithinWindow("2026-06-01", null, 3), false);
    assert.equal(datesWithinWindow("nope", "2026-06-01", 3), false);
  });
  it("returns true for exact same day", () => {
    assert.equal(datesWithinWindow("2026-06-01", "2026-06-01", 3), true);
  });
  it("covers drift up to windowDays but not beyond", () => {
    assert.equal(datesWithinWindow("2026-06-01", "2026-06-04", 3), true);
    assert.equal(datesWithinWindow("2026-06-01", "2026-06-05", 3), false);
  });
});

describe("composeMatchableExternalLabel", () => {
  it("uses name when no venue is provided", () => {
    assert.equal(
      composeMatchableExternalLabel(
        extEv({ externalEventId: "e1", name: "England v Croatia" }),
      ),
      "England v Croatia",
    );
  });
  it("appends venue when present so tokens contribute to the match", () => {
    assert.equal(
      composeMatchableExternalLabel(
        extEv({
          externalEventId: "e1",
          name: "England v Croatia",
          venue: "Brighton Fanpark",
        }),
      ),
      "England v Croatia Brighton Fanpark",
    );
  });
});

describe("composeMatchableInternalLabel", () => {
  it("concatenates name + venue_name + venue_city when all present", () => {
    assert.equal(
      composeMatchableInternalLabel(
        intEv({
          id: "i1",
          name: "England v Croatia",
          venue_name: "Fanpark",
          venue_city: "Brighton",
        }),
      ),
      "England v Croatia Fanpark Brighton",
    );
  });
  it("skips missing / empty venue components", () => {
    assert.equal(
      composeMatchableInternalLabel(
        intEv({ id: "i1", name: "England v Croatia", venue_name: "   " }),
      ),
      "England v Croatia",
    );
  });
});

describe("scoreCandidatesForEvent", () => {
  it("returns no candidates when every external score is below minScore", () => {
    const internal = intEv({ id: "i1", name: "England v Croatia" });
    const externals = [
      extEv({ externalEventId: "e1", name: "Cooking class with Jamie" }),
      extEv({ externalEventId: "e2", name: "Yoga night" }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.equal(candidates.length, 0);
  });

  it("ranks exact name matches at 1.0 confidence", () => {
    const internal = intEv({ id: "i1", name: "England v Croatia" });
    const externals = [
      extEv({ externalEventId: "e1", name: "England v Croatia" }),
      extEv({ externalEventId: "e2", name: "England v Panama" }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.equal(candidates[0]?.externalEventId, "e1");
    assert.equal(candidates[0]?.confidence, 1.0);
  });

  it("matches Eventbrite-style names that append venue context", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      venue_name: "Fanpark",
      venue_city: "Brighton",
    });
    // Eventbrite concats venue into the name, so the same internal
    // event should match an external event whose label is strictly
    // longer.
    const externals = [
      extEv({
        externalEventId: "e1",
        name: "England v Croatia · Brighton Fanpark · World Cup 2026",
      }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.ok(candidates[0]);
    assert.ok(candidates[0].confidence >= 0.5);
  });

  it("applies a date bonus when the external startsAt is within the window", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Panama",
      event_date: "2026-06-14",
    });
    const close = extEv({
      externalEventId: "e1",
      name: "England v Panama",
      startsAt: "2026-06-14T18:00:00Z",
    });
    const far = extEv({
      externalEventId: "e2",
      name: "England v Panama",
      startsAt: "2026-07-01T18:00:00Z",
    });
    const candidates = scoreCandidatesForEvent(internal, [close, far]);
    // Both hit 1.0 on name (exact match) so confidence clamps to 1,
    // but dateMatch differs — the near one is flagged, the far one
    // is not.
    const near = candidates.find((c) => c.externalEventId === "e1");
    const away = candidates.find((c) => c.externalEventId === "e2");
    assert.equal(near?.dateMatch, true);
    assert.equal(away?.dateMatch, false);
  });

  it("respects maxPerEvent", () => {
    const internal = intEv({ id: "i1", name: "England v Croatia" });
    const externals = Array.from({ length: 10 }, (_v, idx) =>
      extEv({
        externalEventId: `e${idx}`,
        name: `England v Croatia #${idx}`,
      }),
    );
    const candidates = scoreCandidatesForEvent(internal, externals, {
      maxPerEvent: 3,
    });
    assert.equal(candidates.length, 3);
  });
});

describe("discoverMatches", () => {
  it("returns one result per internal event, including those with no candidates", () => {
    const internals = [
      intEv({ id: "i1", name: "England v Croatia" }),
      intEv({ id: "i2", name: "Lifetime movie night" }),
    ];
    const externals = [
      extEv({ externalEventId: "e1", name: "England v Croatia" }),
    ];
    const results = discoverMatches(internals, externals);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.eventId, "i1");
    assert.ok(results[0]?.candidates.length >= 1);
    assert.equal(results[1]?.eventId, "i2");
    assert.equal(results[1]?.candidates.length, 0);
  });
});
