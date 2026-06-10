import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveVenue,
  resolveUmbrella,
  buildVenueResolutionMap,
  venueResolutionKey,
  filterEventsForCountryKey,
  isCountryAliasLocation,
  isLondonNeighborhoodLocation,
} from "../venue-resolve.ts";
import type { EventVenueContext, VenueMapping } from "../venue-resolve.ts";

const MAPPINGS: VenueMapping[] = [
  { id: "1", clientId: "c1", sheetLabel: "Brighton", eventCode: "WC26-BRIGHTON", nationLabel: "England" },
  { id: "2", clientId: "c1", sheetLabel: "Manchester", eventCode: "UTB0046-NEW", nationLabel: "England" },
  { id: "3", clientId: "c1", sheetLabel: "Bournemouth", eventCode: "WC26-BOURNEMOUTH", nationLabel: "England" },
  { id: "4", clientId: "c1", sheetLabel: "Scotland", eventCode: "WC26-EDINBURGH", nationLabel: "Scotland" },
  { id: "5", clientId: "c1", sheetLabel: "Glasgow O2", eventCode: "WC26-GLASGOW-O2", nationLabel: "Scotland" },
  { id: "6", clientId: "c1", sheetLabel: "Glasgow SWG3", eventCode: "WC26-GLASGOW-SWG3", nationLabel: "Scotland" },
];

const ENGLISH_MAPPINGS: VenueMapping[] = [
  { id: "b1", clientId: "c1", sheetLabel: "Birmingham", eventCode: "WC26-BIRMINGHAM", nationLabel: "England" },
  { id: "b2", clientId: "c1", sheetLabel: "Bournemouth", eventCode: "WC26-BOURNEMOUTH", nationLabel: "England" },
  { id: "b3", clientId: "c1", sheetLabel: "Brighton", eventCode: "WC26-BRIGHTON", nationLabel: "England" },
  { id: "b4", clientId: "c1", sheetLabel: "Bristol", eventCode: "WC26-BRISTOL", nationLabel: "England" },
  { id: "b5", clientId: "c1", sheetLabel: "Leeds", eventCode: "WC26-LEEDS", nationLabel: "England" },
  { id: "b6", clientId: "c1", sheetLabel: "London Soho", eventCode: "WC26-LONDON-SOHO", nationLabel: "England" },
  { id: "b7", clientId: "c1", sheetLabel: "London Camden", eventCode: "WC26-LONDON-CAMDEN", nationLabel: "England" },
  { id: "b8", clientId: "c1", sheetLabel: "Manchester", eventCode: "WC26-MANCHESTER", nationLabel: "England" },
  { id: "b9", clientId: "c1", sheetLabel: "Margate", eventCode: "WC26-MARGATE", nationLabel: "England" },
  { id: "b10", clientId: "c1", sheetLabel: "Newcastle", eventCode: "WC26-NEWCASTLE", nationLabel: "England" },
  { id: "b11", clientId: "c1", sheetLabel: "Nottingham", eventCode: "WC26-NOTTINGHAM", nationLabel: "England" },
  { id: "s1", clientId: "c1", sheetLabel: "Aberdeen", eventCode: "WC26-ABERDEEN", nationLabel: "Scotland" },
  { id: "s2", clientId: "c1", sheetLabel: "Edinburgh", eventCode: "WC26-EDINBURGH", nationLabel: "Scotland" },
  { id: "s3", clientId: "c1", sheetLabel: "Glasgow O2", eventCode: "WC26-GLASGOW-O2", nationLabel: "Scotland" },
];

const ENGLISH_EVENTS: EventVenueContext[] = [
  { eventCode: "WC26-BIRMINGHAM", venueName: "Arena Birmingham", venueCity: "Birmingham", venueCountry: "GB" },
  { eventCode: "WC26-BOURNEMOUTH", venueName: "Pavilion", venueCity: "Bournemouth", venueCountry: "UK" },
  { eventCode: "WC26-BRIGHTON", venueName: "Brighton Centre", venueCity: "Brighton", venueCountry: "United Kingdom" },
  { eventCode: "WC26-BRISTOL", venueName: "Bristol Venue", venueCity: "Bristol", venueCountry: null },
  { eventCode: "WC26-LEEDS", venueName: "Leeds Arena", venueCity: "Leeds", venueCountry: "GB" },
  { eventCode: "WC26-LONDON-SOHO", venueName: "Soho FanPark", venueCity: "London", venueCountry: "GB" },
  { eventCode: "WC26-LONDON-CAMDEN", venueName: "Camden FanPark", venueCity: "London", venueCountry: "UK" },
  { eventCode: "WC26-MANCHESTER", venueName: "Manchester Venue", venueCity: "Manchester", venueCountry: "GB" },
  { eventCode: "WC26-MARGATE", venueName: "Margate Venue", venueCity: "Margate", venueCountry: null },
  { eventCode: "WC26-NEWCASTLE", venueName: "Newcastle Venue", venueCity: "Newcastle", venueCountry: "GB" },
  { eventCode: "WC26-NOTTINGHAM", venueName: "Nottingham Venue", venueCity: "Nottingham", venueCountry: "GB" },
  { eventCode: "WC26-ABERDEEN", venueName: "Aberdeen Venue", venueCity: "Aberdeen", venueCountry: "Scotland" },
  { eventCode: "WC26-EDINBURGH", venueName: "The Pitt", venueCity: "Edinburgh", venueCountry: null },
  { eventCode: "WC26-GLASGOW-O2", venueName: "O2 Academy Glasgow", venueCity: "Glasgow", venueCountry: "GB" },
];

const GLASGOW_EVENTS: EventVenueContext[] = [
  {
    eventCode: "WC26-GLASGOW-O2",
    venueName: "O2 Academy Glasgow",
    venueCity: "Glasgow",
  },
  {
    eventCode: "WC26-GLASGOW-SWG3",
    venueName: "SWG3",
    venueCity: "Glasgow",
  },
  {
    eventCode: "WC26-EDINBURGH",
    venueName: "The Pitt",
    venueCity: "Edinburgh",
  },
];

function assertSingleVenue(
  result: ReturnType<typeof resolveVenue>,
): asserts result is { isUmbrella: false; eventCode: string } {
  assert.ok(result);
  assert.equal(result.isUmbrella, false);
}

function assertUmbrella(
  result: ReturnType<typeof resolveVenue>,
): asserts result is { isUmbrella: true; eventCodes: string[] } {
  assert.ok(result);
  assert.equal(result.isUmbrella, true);
}

describe("resolveVenue (sheet label fallback)", () => {
  it("matches exact label case-insensitively", () => {
    const result = resolveVenue("Brighton", MAPPINGS);
    assertSingleVenue(result);
    assert.equal(result.eventCode, "WC26-BRIGHTON");
    assert.equal(result.eventMatchAmbiguous, false);
  });

  it("returns null for unknown location", () => {
    assert.equal(resolveVenue("Liverpool", MAPPINGS), null);
  });

  it("returns null for umbrella location", () => {
    assert.equal(resolveVenue("All", MAPPINGS), null);
  });
});

describe("resolveVenue (asset_name tiers)", () => {
  it("Colin Hendry Assets Glasgow narrows to a Glasgow venue with ambiguous flag", () => {
    const result = resolveVenue("Scotland", MAPPINGS, {
      assetName: "Colin Hendry Assets Glasgow",
      events: GLASGOW_EVENTS,
    });
    assertSingleVenue(result);
    assert.ok(
      result.eventCode === "WC26-GLASGOW-O2" || result.eventCode === "WC26-GLASGOW-SWG3",
    );
    assert.equal(result.eventCode, "WC26-GLASGOW-O2");
    assert.equal(result.eventMatchAmbiguous, true);
  });

  it("Colin Hendry Assets O2 Glasgow matches Glasgow-O2 specifically", () => {
    const result = resolveVenue("Scotland", MAPPINGS, {
      assetName: "Colin Hendry Assets O2 Glasgow",
      events: GLASGOW_EVENTS,
    });
    assertSingleVenue(result);
    assert.equal(result.eventCode, "WC26-GLASGOW-O2");
    assert.equal(result.eventMatchAmbiguous, false);
  });

  it("Bournemouth Tickets Loading Bar matches Bournemouth via city in asset_name", () => {
    const events: EventVenueContext[] = [
      { eventCode: "WC26-BOURNEMOUTH", venueName: "Bournemouth Pavilion", venueCity: "Bournemouth" },
      { eventCode: "WC26-EDINBURGH", venueName: "The Pitt", venueCity: "Edinburgh" },
    ];
    const result = resolveVenue("England", MAPPINGS, {
      assetName: "Bournemouth Tickets Loading Bar",
      events,
    });
    assertSingleVenue(result);
    assert.equal(result.eventCode, "WC26-BOURNEMOUTH");
    assert.equal(result.eventMatchAmbiguous, false);
  });

  it("Generic asset_name with Scotland location → country umbrella when events provided", () => {
    const scottishMappings: VenueMapping[] = [
      ...MAPPINGS.filter((m) => m.nationLabel === "Scotland"),
      { id: "7", clientId: "c1", sheetLabel: "Aberdeen", eventCode: "WC26-ABERDEEN", nationLabel: "Scotland" },
    ];
    const scottishEvents: EventVenueContext[] = [
      ...GLASGOW_EVENTS,
      { eventCode: "WC26-ABERDEEN", venueName: "Aberdeen Venue", venueCity: "Aberdeen", venueCountry: "Scotland" },
    ];
    const result = resolveVenue("Scotland", scottishMappings, {
      assetName: "Generic",
      events: scottishEvents,
    });
    assertUmbrella(result);
    assert.deepEqual(result.eventCodes.sort(), [
      "WC26-ABERDEEN",
      "WC26-EDINBURGH",
      "WC26-GLASGOW-O2",
      "WC26-GLASGOW-SWG3",
    ]);
  });

  it("Scotland location without events falls back to sheet label mapping", () => {
    const result = resolveVenue("Scotland", MAPPINGS, { assetName: "Generic" });
    assertSingleVenue(result);
    assert.equal(result.eventCode, "WC26-EDINBURGH");
    assert.equal(result.eventMatchAmbiguous, false);
  });
});

describe("resolveVenue (country-level umbrella)", () => {
  it("Free Beer Assets + location=England → all English city events", () => {
    const result = resolveVenue("England", ENGLISH_MAPPINGS, {
      assetName: "Free Beer Assets",
      events: ENGLISH_EVENTS,
    });
    assertUmbrella(result);
    assert.equal(result.eventCodes.length, 11);
    for (const code of [
      "WC26-BIRMINGHAM",
      "WC26-BOURNEMOUTH",
      "WC26-BRIGHTON",
      "WC26-BRISTOL",
      "WC26-LEEDS",
      "WC26-LONDON-CAMDEN",
      "WC26-LONDON-SOHO",
      "WC26-MANCHESTER",
      "WC26-MARGATE",
      "WC26-NEWCASTLE",
      "WC26-NOTTINGHAM",
    ]) {
      assert.ok(result.eventCodes.includes(code), `missing ${code}`);
    }
    assert.ok(!result.eventCodes.includes("WC26-ABERDEEN"));
    assert.ok(!result.eventCodes.includes("WC26-EDINBURGH"));
    assert.ok(!result.eventCodes.includes("WC26-GLASGOW-O2"));
  });

  it("Selling Points Carousel + location=England → same England umbrella", () => {
    const result = resolveVenue("England", ENGLISH_MAPPINGS, {
      assetName: "Selling Points Carousel",
      events: ENGLISH_EVENTS,
    });
    assertUmbrella(result);
    assert.equal(result.eventCodes.length, 11);
  });

  it("location=Scotland → Aberdeen, Edinburgh, Glasgow only", () => {
    const result = resolveVenue("Scotland", ENGLISH_MAPPINGS, {
      assetName: "Generic Scotland Asset",
      events: ENGLISH_EVENTS,
    });
    assertUmbrella(result);
    assert.deepEqual(result.eventCodes, [
      "WC26-ABERDEEN",
      "WC26-EDINBURGH",
      "WC26-GLASGOW-O2",
    ]);
  });

  it("location=UK → all English + Scottish mapped events", () => {
    const result = resolveVenue("UK", ENGLISH_MAPPINGS, {
      assetName: "UK Wide Asset",
      events: ENGLISH_EVENTS,
    });
    assertUmbrella(result);
    assert.equal(result.eventCodes.length, 14);
  });

  it("detects country alias locations", () => {
    assert.equal(isCountryAliasLocation("England"), true);
    assert.equal(isCountryAliasLocation("great britain"), true);
    assert.equal(isCountryAliasLocation("Brighton"), false);
  });
});

describe("resolveVenue (London neighborhoods)", () => {
  it("SBE Presenter videos + Shepards Bush → London events", () => {
    const result = resolveVenue("Shepards Bush", ENGLISH_MAPPINGS, {
      assetName: "SBE Presenter videos",
      events: ENGLISH_EVENTS,
    });
    assert.ok(result);
    if (result.isUmbrella) {
      assert.deepEqual(result.eventCodes, ["WC26-LONDON-CAMDEN", "WC26-LONDON-SOHO"]);
    } else {
      assert.ok(result.eventCode.startsWith("WC26-LONDON"));
    }
  });

  it("detects London neighborhood labels", () => {
    assert.equal(isLondonNeighborhoodLocation("Shepards Bush"), true);
    assert.equal(isLondonNeighborhoodLocation("Shepherd's Bush"), true);
    assert.equal(isLondonNeighborhoodLocation("England"), false);
  });
});

describe("filterEventsForCountryKey", () => {
  it("excludes Scottish cities from England filter", () => {
    const matched = filterEventsForCountryKey("england", ENGLISH_EVENTS, ENGLISH_MAPPINGS);
    const codes = matched.map((e) => e.eventCode);
    assert.ok(!codes.includes("WC26-GLASGOW-O2"));
    assert.ok(codes.includes("WC26-LONDON-SOHO"));
  });
});

describe("resolveUmbrella", () => {
  it("returns Scotland event codes for nation=Scotland", () => {
    const result = resolveUmbrella("Scotland", MAPPINGS);
    assert.ok(result);
    assert.equal(result!.isUmbrella, true);
    assert.ok(result!.eventCodes.includes("WC26-EDINBURGH"));
    assert.ok(result!.eventCodes.includes("WC26-GLASGOW-O2"));
  });
});

describe("buildVenueResolutionMap", () => {
  it("uses asset-aware keys when asset_name is present", () => {
    const rows = [
      {
        location: "Scotland",
        nation: "Scotland",
        assetName: "Colin Hendry Assets Glasgow",
      },
    ];
    const map = buildVenueResolutionMap(rows, MAPPINGS, GLASGOW_EVENTS);
    const key = `${venueResolutionKey("Scotland", "Scotland")}::colin hendry assets glasgow`;
    const result = map.get(key);
    assert.ok(result);
    assert.equal(result!.isUmbrella, false);
    if (result && !result.isUmbrella) {
      assert.equal(result.eventCode, "WC26-GLASGOW-O2");
      assert.equal(result.eventMatchAmbiguous, true);
    }
  });

  it("stores England umbrella in map for country location", () => {
    const rows = [{ location: "England", nation: "England", assetName: "Free Beer Assets" }];
    const map = buildVenueResolutionMap(rows, ENGLISH_MAPPINGS, ENGLISH_EVENTS);
    const key = `${venueResolutionKey("England", "England")}::free beer assets`;
    const result = map.get(key);
    assert.ok(result);
    assert.equal(result!.isUmbrella, true);
    if (result && result.isUmbrella) {
      assert.equal(result.eventCodes.length, 11);
    }
  });
});
