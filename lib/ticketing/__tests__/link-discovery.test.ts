import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  composeMatchableExternalLabel,
  composeMatchableInternalLabel,
  datesWithinWindow,
  discoverMatches,
  isUmbrellaCampaignEvent,
  opponentLabelForMatching,
  scoreCandidatesForEvent,
  venueScoreForMatching,
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
  it("scores venue aliases from the last comma-separated provider location", () => {
    assert.equal(
      venueScoreForMatching("Shoreditch", "Village Underground, Shoreditch"),
      1,
    );
    assert.equal(
      venueScoreForMatching(
        "Prospect Building Bristol",
        "The Prospect Building, Bristol",
      ),
      1,
    );
  });

  it("extracts opponents for matching, including reversed home-team and knockout labels", () => {
    assert.equal(opponentLabelForMatching("England v Croatia"), "croatia");
    assert.equal(opponentLabelForMatching("Scotland v Brazil"), "brazil");
    assert.equal(opponentLabelForMatching("Croatia v England"), "croatia");
    assert.equal(opponentLabelForMatching("England - Last 32"), "last 32");
    assert.equal(opponentLabelForMatching("England Last 32"), "last 32");
    assert.equal(opponentLabelForMatching("Bristol – England v Panama"), "panama");
  });

  it("does not surface candidates for umbrella campaign-level rows", () => {
    const internal = intEv({
      id: "london-presale",
      name: "WC26 London Presale Campaign",
      event_date: null,
      venue_name: "London FanPark",
      venue_city: "London",
    });
    const externals = [
      extEv({
        externalEventId: "chelsea-final",
        name: "Chelsea FanPark – FA Cup Final",
        startsAt: "2026-05-16",
        venue: "The Steel Yard, London",
      }),
    ];
    assert.equal(isUmbrellaCampaignEvent(internal), true);
    assert.equal(scoreCandidatesForEvent(internal, externals).length, 0);
  });

  it("surfaces low-confidence review candidates without auto-confirming them", () => {
    const internal = intEv({
      id: "tottenham-six-nations",
      name: "Tottenham Six Nations",
      event_date: "2026-03-14",
      venue_name: "Tottenham",
      venue_city: "London",
    });
    const externals = [
      extEv({
        externalEventId: "tottenham-review",
        name: "Tottenham – Rugby",
        startsAt: "2026-03-20",
        venue: "Tottenham, London",
      }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.equal(candidates.length, 1);
    assert.ok((candidates[0]?.confidence ?? 0) >= 0.55);
    assert.ok((candidates[0]?.confidence ?? 1) < 0.65);
    assert.equal(candidates[0]?.autoConfirm, false);
  });

  it("returns no candidates when every external score is below minScore", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      event_date: "2026-06-17",
      venue_name: "Prospect Building",
      venue_city: "Bristol",
    });
    const externals = [
      extEv({ externalEventId: "e1", name: "Cooking class with Jamie" }),
      extEv({ externalEventId: "e2", name: "Yoga night" }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.equal(candidates.length, 0);
  });

  it("auto-confirms only when the venue score is confident", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      event_date: "2026-06-17",
      venue_name: "Prospect Building",
      venue_city: "Bristol",
    });
    const externals = [
      extEv({
        externalEventId: "e1",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "The Prospect Building, Bristol",
      }),
      extEv({
        externalEventId: "e2",
        name: "Brighton – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Central Park, Brighton",
      }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.equal(candidates[0]?.externalEventId, "e1");
    assert.equal(candidates[0]?.autoConfirm, true);
    assert.ok(candidates[0]?.venueScore >= 0.8);
    assert.equal(candidates.some((c) => c.externalEventId === "e2"), false);
  });

  it("matches Eventbrite-style names that prefix venue context", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      event_date: "2026-06-17",
      venue_name: "Fanpark",
      venue_city: "Brighton",
    });
    const externals = [
      extEv({
        externalEventId: "e1",
        name: "Brighton Fanpark – England v Croatia",
        startsAt: "2026-06-17",
      }),
    ];
    const candidates = scoreCandidatesForEvent(internal, externals);
    assert.ok(candidates[0]);
    assert.ok(candidates[0].confidence >= 0.9);
  });

  it("scores date proximity by exact, one day, three days, then zero", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Panama",
      event_date: "2026-06-14",
    });
    const close = extEv({
      externalEventId: "e1",
      name: "London – England v Panama",
      venue: "London",
      startsAt: "2026-06-14T18:00:00Z",
    });
    const far = extEv({
      externalEventId: "e2",
      name: "London – England v Panama",
      venue: "London",
      startsAt: "2026-07-01T18:00:00Z",
    });
    internal.venue_city = "London";
    const candidates = scoreCandidatesForEvent(internal, [close, far]);
    const near = candidates.find((c) => c.externalEventId === "e1");
    const away = candidates.find((c) => c.externalEventId === "e2");
    assert.equal(near?.dateScore, 1);
    assert.equal(away?.dateScore, 0);
  });

  it("respects maxPerEvent", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      event_date: "2026-06-17",
      venue_city: "Bristol",
    });
    const externals = Array.from({ length: 10 }, (_v, idx) =>
      extEv({
        externalEventId: `e${idx}`,
        name: `Bristol – England v Croatia #${idx}`,
        startsAt: `2026-06-${String(10 + idx).padStart(2, "0")}`,
        venue: "Bristol",
      }),
    );
    const candidates = scoreCandidatesForEvent(internal, externals, {
      maxPerEvent: 3,
    });
    assert.equal(candidates.length, 3);
  });

  it("matches Bristol Croatia to event 3276, not same-name events in other venues", () => {
    const internal = intEv({
      id: "wc26-bristol-croatia",
      name: "WC26 Group Stage Croatia",
      event_date: "2026-06-17",
      venue_name: "Prospect Building",
      venue_city: "Bristol",
    });
    const candidates = scoreCandidatesForEvent(internal, [
      extEv({
        externalEventId: "3276",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "The Prospect Building, Bristol",
      }),
      extEv({
        externalEventId: "3277",
        name: "Brighton – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Central Park Brighton",
      }),
      extEv({
        externalEventId: "3278",
        name: "Tottenham – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Tottenham",
      }),
    ]);
    assert.equal(candidates[0]?.externalEventId, "3276");
    assert.equal(candidates[0]?.autoConfirm, true);
  });

  it("uses opponent overlap to separate same-venue Bristol group-stage events", () => {
    const shared = {
      venue_name: "Prospect Building",
      venue_city: "Bristol",
    };
    const externals = [
      extEv({
        externalEventId: "3276",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "The Prospect Building, Bristol",
      }),
      extEv({
        externalEventId: "4180",
        name: "Bristol – England v Panama",
        startsAt: "2026-06-24",
        venue: "The Prospect Building, Bristol",
      }),
      extEv({
        externalEventId: "4181",
        name: "Bristol – England v Ghana",
        startsAt: "2026-06-27",
        venue: "The Prospect Building, Bristol",
      }),
      extEv({
        externalEventId: "4194",
        name: "Bristol – Last 32",
        startsAt: "2026-06-30",
        venue: "The Prospect Building, Bristol",
      }),
    ];

    const croatia = scoreCandidatesForEvent(
      intEv({
        id: "bristol-croatia",
        name: "England v Croatia",
        event_date: "2026-06-17",
        ...shared,
      }),
      externals,
    );
    assert.equal(croatia[0]?.externalEventId, "3276");
    assert.ok((croatia[0]?.confidence ?? 0) > 0.85);
    assert.equal(croatia[0]?.opponentScore, 1);
    assert.equal(croatia[0]?.autoConfirm, true);
    assert.ok(
      croatia
        .filter((candidate) => candidate.externalEventId !== "3276")
        .every((candidate) => !candidate.autoConfirm && candidate.confidence < 0.9),
    );

    const panama = scoreCandidatesForEvent(
      intEv({
        id: "bristol-panama",
        name: "England v Panama",
        event_date: "2026-06-24",
        ...shared,
      }),
      externals,
    );
    assert.equal(panama[0]?.externalEventId, "4180");
    assert.ok((panama[0]?.confidence ?? 0) > 0.85);
    assert.equal(panama[0]?.opponentScore, 1);
    assert.equal(panama[0]?.autoConfirm, true);

    const last32 = scoreCandidatesForEvent(
      intEv({
        id: "bristol-last-32",
        name: "England - Last 32",
        event_date: "2026-06-30",
        ...shared,
      }),
      externals,
    );
    assert.equal(last32[0]?.externalEventId, "4194");
    assert.ok((last32[0]?.confidence ?? 0) > 0.85);
    assert.equal(last32[0]?.opponentScore, 1);
  });

  it("auto-confirms Central Park matches above the lowered threshold", () => {
    const shared = {
      venue_name: "Central Park",
      venue_city: "Brighton",
    };
    const externals = [
      extEv({
        externalEventId: "central-croatia",
        name: "Central Park – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Central Park, Brighton",
      }),
      extEv({
        externalEventId: "central-last-32",
        name: "Central Park – Last 32",
        startsAt: "2026-06-30",
        venue: "Central Park, Brighton",
      }),
    ];

    const croatia = scoreCandidatesForEvent(
      intEv({
        id: "central-croatia",
        name: "England v Croatia",
        event_date: "2026-06-17",
        ...shared,
      }),
      externals,
    );
    assert.equal(croatia[0]?.externalEventId, "central-croatia");
    assert.equal(croatia[0]?.autoConfirm, true);

    const last32 = scoreCandidatesForEvent(
      intEv({
        id: "central-last-32",
        name: "England - Last 32",
        event_date: "2026-06-30",
        ...shared,
      }),
      externals,
    );
    assert.equal(last32[0]?.externalEventId, "central-last-32");
    assert.equal(last32[0]?.autoConfirm, true);
  });

  it("matches stage labels to stage labels instead of wrong opponents", () => {
    const manchester = scoreCandidatesForEvent(
      intEv({
        id: "manchester-last-32",
        name: "England - Last 32",
        event_date: "2026-06-30",
        venue_name: "Depot Mayfield",
        venue_city: "Manchester",
      }),
      [
        extEv({
          externalEventId: "m-ghana",
          name: "Depot Mayfield · Manchester – England v Ghana",
          startsAt: "2026-06-27",
          venue: "Depot Mayfield, Manchester",
        }),
        extEv({
          externalEventId: "m-last-32",
          name: "Depot Mayfield · Manchester – Last 32",
          startsAt: "2026-06-30",
          venue: "Depot Mayfield, Manchester",
        }),
      ],
    );
    assert.equal(manchester[0]?.externalEventId, "m-last-32");
    assert.equal(manchester[0]?.opponentScore, 1);
    assert.equal(manchester[0]?.autoConfirm, true);
    assert.ok(
      manchester
        .filter((candidate) => candidate.externalEventId !== "m-last-32")
        .every((candidate) => !candidate.autoConfirm),
    );

    const bristol = scoreCandidatesForEvent(
      intEv({
        id: "bristol-last-32-regression",
        name: "England - Last 32",
        event_date: "2026-06-30",
        venue_name: "Prospect Building",
        venue_city: "Bristol",
      }),
      [
        extEv({
          externalEventId: "3276",
          name: "Bristol – England v Croatia",
          startsAt: "2026-06-17",
          venue: "The Prospect Building, Bristol",
        }),
        extEv({
          externalEventId: "4194",
          name: "Bristol – Last 32",
          startsAt: "2026-06-30",
          venue: "The Prospect Building, Bristol",
        }),
      ],
    );
    assert.equal(bristol[0]?.externalEventId, "4194");
  });

  it("matches all Shoreditch events when provider venue includes building prefix", () => {
    const shared = {
      venue_name: "Shoreditch",
      venue_city: "London",
    };
    const externals = [
      extEv({
        externalEventId: "4053",
        name: "Shoreditch – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Village Underground, Shoreditch",
      }),
      extEv({
        externalEventId: "4078",
        name: "Shoreditch – England v Ghana",
        startsAt: "2026-06-24",
        venue: "Village Underground, Shoreditch",
      }),
      extEv({
        externalEventId: "4086",
        name: "Shoreditch – England v Panama",
        startsAt: "2026-06-27",
        venue: "Village Underground, Shoreditch",
      }),
      extEv({
        externalEventId: "4094",
        name: "Shoreditch – Last 32",
        startsAt: "2026-06-30",
        venue: "Village Underground, Shoreditch",
      }),
    ];

    const expectations = [
      ["England v Croatia", "2026-06-17", "4053"],
      ["England v Ghana", "2026-06-24", "4078"],
      ["England v Panama", "2026-06-27", "4086"],
      ["England - Last 32", "2026-06-30", "4094"],
    ] as const;

    for (const [name, date, expectedId] of expectations) {
      const candidates = scoreCandidatesForEvent(
        intEv({
          id: `shoreditch-${expectedId}`,
          name,
          event_date: date,
          ...shared,
        }),
        externals,
      );
      assert.equal(candidates[0]?.externalEventId, expectedId);
      assert.ok(
        (candidates[0]?.confidence ?? 0) > 0.85,
        `${name} should score above 85%`,
      );
      assert.equal(candidates[0]?.autoConfirm, true);
    }
  });

  it("matches Edinburgh Scotland v Haiti to event 368, not other Scottish venues", () => {
    const internal = intEv({
      id: "wc26-edinburgh-haiti",
      name: "Scotland v Haiti",
      event_date: "2026-06-13",
      venue_city: "Edinburgh",
    });
    const candidates = scoreCandidatesForEvent(internal, [
      extEv({
        externalEventId: "368",
        name: "Edinburgh – Scotland v Haiti",
        startsAt: "2026-06-13",
        venue: "Edinburgh",
      }),
      extEv({
        externalEventId: "369",
        name: "Aberdeen – Scotland v Haiti",
        startsAt: "2026-06-13",
        venue: "Aberdeen",
      }),
      extEv({
        externalEventId: "370",
        name: "Glasgow – Scotland v Haiti",
        startsAt: "2026-06-13",
        venue: "Glasgow",
      }),
      extEv({
        externalEventId: "371",
        name: "Falkirk – Scotland v Haiti",
        startsAt: "2026-06-13",
        venue: "Falkirk",
      }),
    ]);
    assert.equal(candidates[0]?.externalEventId, "368");
    assert.equal(candidates[0]?.autoConfirm, true);
  });

  it("matches Glasgow Scotland v Brazil to sold-out event 389, not Aberdeen 8866", () => {
    const internal = intEv({
      id: "wc26-glasgow-brazil",
      name: "Scotland v Brazil",
      event_date: "2026-06-24",
      venue_city: "Glasgow",
    });
    const candidates = scoreCandidatesForEvent(internal, [
      extEv({
        externalEventId: "389",
        name: "Glasgow – Scotland v Brazil",
        startsAt: "2026-06-24",
        venue: "Glasgow",
        status: "sold_out",
      }),
      extEv({
        externalEventId: "8866",
        name: "Aberdeen – Scotland v Brazil",
        startsAt: "2026-06-24",
        venue: "Aberdeen",
      }),
    ]);
    assert.equal(candidates[0]?.externalEventId, "389");
    assert.equal(candidates[0]?.autoConfirm, true);
  });

  it("uses capacity as a tie-breaker after score and earliest date", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      event_date: "2026-06-17",
      venue_city: "Bristol",
      capacity: 1000,
    });
    const candidates = scoreCandidatesForEvent(internal, [
      extEv({
        externalEventId: "no-cap-match",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Bristol",
        capacity: 1200,
      }),
      extEv({
        externalEventId: "cap-match",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Bristol",
        capacity: 980,
      }),
    ]);
    assert.equal(candidates[0]?.externalEventId, "cap-match");
    assert.equal(candidates[0]?.capacityMatch, true);
  });

  it("flags unresolved top ties for manual disambiguation", () => {
    const internal = intEv({
      id: "i1",
      name: "England v Croatia",
      event_date: "2026-06-17",
      venue_city: "Bristol",
    });
    const candidates = scoreCandidatesForEvent(internal, [
      extEv({
        externalEventId: "a",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Bristol",
      }),
      extEv({
        externalEventId: "b",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Bristol",
      }),
    ]);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.manualDisambiguationRequired, true);
    assert.equal(candidates[1]?.manualDisambiguationRequired, true);
    assert.equal(candidates[0]?.autoConfirm, false);
  });
});

describe("discoverMatches", () => {
  it("returns one result per internal event, including those with no candidates", () => {
    const internals = [
      intEv({
        id: "i1",
        name: "England v Croatia",
        event_date: "2026-06-17",
        venue_city: "Bristol",
      }),
      intEv({ id: "i2", name: "Lifetime movie night" }),
    ];
    const externals = [
      extEv({
        externalEventId: "e1",
        name: "Bristol – England v Croatia",
        startsAt: "2026-06-17",
        venue: "Bristol",
      }),
    ];
    const results = discoverMatches(internals, externals);
    assert.equal(results.length, 2);
    assert.equal(results[0]?.eventId, "i1");
    assert.ok(results[0]?.candidates.length >= 1);
    assert.equal(results[1]?.eventId, "i2");
    assert.equal(results[1]?.candidates.length, 0);
  });
});
