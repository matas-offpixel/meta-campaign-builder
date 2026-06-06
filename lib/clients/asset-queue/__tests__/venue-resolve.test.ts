import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveVenue,
  resolveUmbrella,
  buildVenueResolutionMap,
  venueResolutionKey,
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

describe("resolveVenue (sheet label fallback)", () => {
  it("matches exact label case-insensitively", () => {
    const result = resolveVenue("Brighton", MAPPINGS);
    assert.ok(result);
    assert.equal(result!.eventCode, "WC26-BRIGHTON");
    assert.equal(result!.eventMatchAmbiguous, false);
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
    assert.ok(result);
    assert.ok(
      result!.eventCode === "WC26-GLASGOW-O2" || result!.eventCode === "WC26-GLASGOW-SWG3",
    );
    assert.equal(result!.eventCode, "WC26-GLASGOW-O2");
    assert.equal(result!.eventMatchAmbiguous, true);
  });

  it("Colin Hendry Assets O2 Glasgow matches Glasgow-O2 specifically", () => {
    const result = resolveVenue("Scotland", MAPPINGS, {
      assetName: "Colin Hendry Assets O2 Glasgow",
      events: GLASGOW_EVENTS,
    });
    assert.ok(result);
    assert.equal(result!.eventCode, "WC26-GLASGOW-O2");
    assert.equal(result!.eventMatchAmbiguous, false);
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
    assert.ok(result);
    assert.equal(result!.eventCode, "WC26-BOURNEMOUTH");
    assert.equal(result!.eventMatchAmbiguous, false);
  });

  it("Generic asset_name falls back to sheet location mapping", () => {
    const result = resolveVenue("Scotland", MAPPINGS, {
      assetName: "Generic",
      events: GLASGOW_EVENTS,
    });
    assert.ok(result);
    assert.equal(result!.eventCode, "WC26-EDINBURGH");
    assert.equal(result!.eventMatchAmbiguous, false);
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
    if (!result!.isUmbrella) {
      assert.equal(result!.eventCode, "WC26-GLASGOW-O2");
      assert.equal(result!.eventMatchAmbiguous, true);
    }
  });
});
