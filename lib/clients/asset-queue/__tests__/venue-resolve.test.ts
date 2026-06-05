import { resolveVenue, buildVenueResolutionMap } from "../venue-resolve";
import type { VenueMapping } from "../venue-resolve";

const MAPPINGS: VenueMapping[] = [
  { id: "1", clientId: "c1", sheetLabel: "Brighton", eventCode: "WC26-BRIGHTON", nationLabel: "England" },
  { id: "2", clientId: "c1", sheetLabel: "Manchester", eventCode: "UTB0046-NEW", nationLabel: "England" },
  { id: "3", clientId: "c1", sheetLabel: "Edinburgh", eventCode: "WC26-EDINBURGH", nationLabel: "Scotland" },
];

describe("resolveVenue", () => {
  it("matches exact label (case-sensitive input, case-insensitive comparison)", () => {
    const result = resolveVenue("Brighton", MAPPINGS);
    expect(result).not.toBeNull();
    expect(result!.eventCode).toBe("WC26-BRIGHTON");
  });

  it("matches case-insensitively", () => {
    expect(resolveVenue("BRIGHTON", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
    expect(resolveVenue("brighton", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
    expect(resolveVenue("Brighton", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
  });

  it("returns null for unknown location", () => {
    expect(resolveVenue("Liverpool", MAPPINGS)).toBeNull();
  });

  it("returns null for 'All' location", () => {
    expect(resolveVenue("All", MAPPINGS)).toBeNull();
    expect(resolveVenue("all", MAPPINGS)).toBeNull();
    expect(resolveVenue("ALL", MAPPINGS)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(resolveVenue("", MAPPINGS)).toBeNull();
  });

  it("ignores leading/trailing whitespace in location", () => {
    expect(resolveVenue("  Brighton  ", MAPPINGS)?.eventCode).toBe("WC26-BRIGHTON");
  });

  it("returns correct mappingId", () => {
    const result = resolveVenue("Manchester", MAPPINGS);
    expect(result?.mappingId).toBe("2");
  });
});

describe("buildVenueResolutionMap", () => {
  it("builds a map with resolved and unresolved entries", () => {
    const locations = ["Brighton", "Manchester", "Liverpool", "All"];
    const map = buildVenueResolutionMap(locations, MAPPINGS);
    expect(map.get("Brighton")?.eventCode).toBe("WC26-BRIGHTON");
    expect(map.get("Manchester")?.eventCode).toBe("UTB0046-NEW");
    expect(map.get("Liverpool")).toBeNull();
    expect(map.get("All")).toBeNull();
  });

  it("deduplicates repeated locations (only resolves once)", () => {
    const locations = ["Brighton", "Brighton", "Brighton"];
    const map = buildVenueResolutionMap(locations, MAPPINGS);
    expect(map.size).toBe(1);
  });
});
