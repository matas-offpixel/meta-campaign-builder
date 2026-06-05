import { resolveVenue, resolveUmbrella, buildVenueResolutionMap, venueResolutionKey } from "../venue-resolve";
import type { VenueMapping } from "../venue-resolve";

const MAPPINGS: VenueMapping[] = [
  { id: "1", clientId: "c1", sheetLabel: "Brighton", eventCode: "WC26-BRIGHTON", nationLabel: "England" },
  { id: "2", clientId: "c1", sheetLabel: "Manchester", eventCode: "UTB0046-NEW", nationLabel: "England" },
  { id: "3", clientId: "c1", sheetLabel: "Edinburgh", eventCode: "WC26-EDINBURGH", nationLabel: "Scotland" },
  { id: "4", clientId: "c1", sheetLabel: "Glasgow", eventCode: "WC26-GLASGOW", nationLabel: "Scotland" },
];

// ─── resolveVenue ─────────────────────────────────────────────────────────────

describe("resolveVenue", () => {
  it("matches exact label (case-sensitive input, case-insensitive comparison)", () => {
    const result = resolveVenue("Brighton", MAPPINGS);
    expect(result).not.toBeNull();
    expect(result!.isUmbrella).toBe(false);
    expect(result!.eventCode).toBe("WC26-BRIGHTON");
  });

  it("matches case-insensitively", () => {
    expect(resolveVenue("BRIGHTON", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
    expect(resolveVenue("brighton", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
  });

  it("returns null for unknown location", () => {
    expect(resolveVenue("Liverpool", MAPPINGS)).toBeNull();
  });

  it("returns null for 'All' location (umbrella is handled separately)", () => {
    expect(resolveVenue("All", MAPPINGS)).toBeNull();
    expect(resolveVenue("all", MAPPINGS)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveVenue("", MAPPINGS)).toBeNull();
  });

  it("ignores leading/trailing whitespace", () => {
    expect(resolveVenue("  Brighton  ", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
  });

  it("returns correct mappingId", () => {
    const result = resolveVenue("Manchester", MAPPINGS);
    expect(result?.mappingId).toBe("2");
  });
});

// ─── resolveUmbrella ─────────────────────────────────────────────────────────

describe("resolveUmbrella", () => {
  it("returns all England event codes when nation=England", () => {
    const result = resolveUmbrella("England", MAPPINGS);
    expect(result).not.toBeNull();
    expect(result!.isUmbrella).toBe(true);
    expect(result!.eventCodes).toContain("WC26-BRIGHTON");
    expect(result!.eventCodes).toContain("UTB0046-NEW");
    expect(result!.eventCodes).not.toContain("WC26-EDINBURGH");
  });

  it("returns all Scotland event codes when nation=Scotland", () => {
    const result = resolveUmbrella("Scotland", MAPPINGS);
    expect(result!.eventCodes).toContain("WC26-EDINBURGH");
    expect(result!.eventCodes).toContain("WC26-GLASGOW");
    expect(result!.eventCodes).not.toContain("WC26-BRIGHTON");
  });

  it("returns ALL event codes when nation=All", () => {
    const result = resolveUmbrella("All", MAPPINGS);
    expect(result!.eventCodes).toHaveLength(4);
  });

  it("is case-insensitive for nation", () => {
    const r1 = resolveUmbrella("england", MAPPINGS);
    const r2 = resolveUmbrella("England", MAPPINGS);
    expect(r1!.eventCodes).toEqual(r2!.eventCodes);
  });

  it("returns null when no mappings match the nation", () => {
    expect(resolveUmbrella("Wales", MAPPINGS)).toBeNull();
  });

  it("deduplicates event codes", () => {
    const duped: VenueMapping[] = [
      ...MAPPINGS,
      { id: "5", clientId: "c1", sheetLabel: "London", eventCode: "WC26-BRIGHTON", nationLabel: "England" },
    ];
    const result = resolveUmbrella("England", duped);
    const codes = result!.eventCodes;
    expect(new Set(codes).size).toBe(codes.length); // no duplicates
  });

  it("returns sorted event codes", () => {
    const result = resolveUmbrella("England", MAPPINGS);
    const codes = result!.eventCodes;
    expect(codes).toEqual([...codes].sort());
  });

  it("builds a human-readable label", () => {
    expect(resolveUmbrella("England", MAPPINGS)?.label).toBe("All England venues");
    expect(resolveUmbrella("All", MAPPINGS)?.label).toBe("All venues");
  });
});

// ─── buildVenueResolutionMap ──────────────────────────────────────────────────

describe("buildVenueResolutionMap", () => {
  it("resolves specific venues to ResolvedVenue", () => {
    const pairs = [{ location: "Brighton", nation: "England" }];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    const key = venueResolutionKey("Brighton", "England");
    const result = map.get(key);
    expect(result).not.toBeNull();
    expect(result!.isUmbrella).toBe(false);
    if (!result!.isUmbrella) {
      expect(result!.eventCode).toBe("WC26-BRIGHTON");
    }
  });

  it("resolves All+England to UmbrellaResolution", () => {
    const pairs = [{ location: "All", nation: "England" }];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    const key = venueResolutionKey("All", "England");
    const result = map.get(key);
    expect(result!.isUmbrella).toBe(true);
    if (result!.isUmbrella) {
      expect(result!.eventCodes).toContain("WC26-BRIGHTON");
      expect(result!.eventCodes).toContain("UTB0046-NEW");
      expect(result!.eventCodes).not.toContain("WC26-EDINBURGH");
    }
  });

  it("resolves All+Scotland to UmbrellaResolution with Scottish events only", () => {
    const pairs = [{ location: "All", nation: "Scotland" }];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    const key = venueResolutionKey("All", "Scotland");
    const result = map.get(key);
    expect(result!.isUmbrella).toBe(true);
    if (result!.isUmbrella) {
      expect(result!.eventCodes).not.toContain("WC26-BRIGHTON");
    }
  });

  it("resolves All+All to all mappings regardless of nation", () => {
    const pairs = [{ location: "All", nation: "All" }];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    const key = venueResolutionKey("All", "All");
    const result = map.get(key);
    expect(result!.isUmbrella).toBe(true);
    if (result!.isUmbrella) {
      expect(result!.eventCodes).toHaveLength(4);
    }
  });

  it("handles mixed pairs — some umbrella, some specific, some unknown", () => {
    const pairs = [
      { location: "Brighton", nation: "England" },
      { location: "All", nation: "England" },
      { location: "Liverpool", nation: "England" }, // no mapping
    ];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    expect(map.get(venueResolutionKey("Brighton", "England"))?.isUmbrella).toBe(false);
    expect(map.get(venueResolutionKey("All", "England"))?.isUmbrella).toBe(true);
    expect(map.get(venueResolutionKey("Liverpool", "England"))).toBeNull();
  });

  it("deduplicates repeated pairs", () => {
    const pairs = [
      { location: "Brighton", nation: "England" },
      { location: "Brighton", nation: "England" },
    ];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    expect(map.size).toBe(1);
  });

  it("treats All+England and All+Scotland as different keys", () => {
    const pairs = [
      { location: "All", nation: "England" },
      { location: "All", nation: "Scotland" },
    ];
    const map = buildVenueResolutionMap(pairs, MAPPINGS);
    expect(map.size).toBe(2);
    const eng = map.get(venueResolutionKey("All", "England"))!;
    const sco = map.get(venueResolutionKey("All", "Scotland"))!;
    expect(eng.isUmbrella && sco.isUmbrella).toBe(true);
    if (eng.isUmbrella && sco.isUmbrella) {
      expect(eng.eventCodes).not.toEqual(sco.eventCodes);
    }
  });
});
