/**
 * Unit tests for lib/google-ads/geo-resolve.ts
 *
 * Covers:
 *  1. GEO_TARGET_CONSTANTS_MAP / lookupFallbackGeoConstant — Wales fix,
 *     case normalisation, missing keys
 *  2. resolveGeoLocation (single) — suggest primary, fallback, null
 *  3. resolveGeoLocations (batch) — caching, deduplication
 *  4. Single source of truth: verify geo-suggest.ts is only a re-export barrel
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  GEO_TARGET_CONSTANTS_MAP,
  lookupFallbackGeoConstant,
  resolveGeoLocation,
  resolveGeoLocations,
  type GeoResolution,
} from "../geo-resolve.ts";
import { UK_GEO_TARGET_CONSTANTS } from "../geo-suggest.ts";
import type { GoogleAdsCustomerCredentials } from "../client.ts";

// ─── Fixtures ────────────────────────────────────────────────────────

const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh-token",
  loginCustomerId: "333-703-8088",
};

type SuggestResult = {
  resourceName: string;
  displayName: string;
  countryCode: string | null;
  targetType: string | null;
} | null;

function makeClient(
  responses: Record<string, { resourceName: string; displayName: string } | null>,
  opts: { throws?: boolean } = {},
): { client: { suggestGeoTargetConstants: (...args: unknown[]) => Promise<SuggestResult[]> }; callCount: number } {
  let callCount = 0;
  const client = {
    async suggestGeoTargetConstants(_rt: string, names: string[]): Promise<SuggestResult[]> {
      callCount += 1;
      if (opts.throws) throw new Error("API error");
      return names.map((n) => {
        const hit = responses[n.toLowerCase()] ?? responses[n] ?? null;
        if (!hit) return null;
        return { resourceName: hit.resourceName, displayName: hit.displayName, countryCode: "GB", targetType: "City" };
      });
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, callCount: 0 };
}

// ─── 1. GEO_TARGET_CONSTANTS_MAP / lookupFallbackGeoConstant ─────────

describe("lookupFallbackGeoConstant", () => {
  it("returns London resource name", () => {
    assert.equal(lookupFallbackGeoConstant("london"), "geoTargetConstants/1006886");
  });

  it("is case-insensitive and normalises whitespace", () => {
    assert.equal(lookupFallbackGeoConstant("LONDON"), "geoTargetConstants/1006886");
    assert.equal(lookupFallbackGeoConstant("  south  east  "), "geoTargetConstants/9049069");
  });

  it("Wales fix: Wales maps to 20338 (not 20339/England)", () => {
    const wales = lookupFallbackGeoConstant("wales");
    assert.equal(wales, "geoTargetConstants/20338", "Wales must NOT share England's ID (20339)");
    const england = lookupFallbackGeoConstant("england");
    assert.equal(england, "geoTargetConstants/20339");
    assert.notEqual(wales, england, "Wales and England must have different geoTargetConstant IDs");
  });

  it("Scotland maps to 20337", () => {
    assert.equal(lookupFallbackGeoConstant("scotland"), "geoTargetConstants/20337");
  });

  it("UK aliases all resolve to 2826", () => {
    assert.equal(lookupFallbackGeoConstant("uk"), "geoTargetConstants/2826");
    assert.equal(lookupFallbackGeoConstant("United Kingdom"), "geoTargetConstants/2826");
    assert.equal(lookupFallbackGeoConstant("great britain"), "geoTargetConstants/2826");
  });

  it("returns null for unknown locations", () => {
    assert.equal(lookupFallbackGeoConstant("atlantis"), null);
  });

  it("geo-suggest.ts re-export: UK_GEO_TARGET_CONSTANTS is identical to GEO_TARGET_CONSTANTS_MAP", () => {
    assert.strictEqual(
      UK_GEO_TARGET_CONSTANTS,
      GEO_TARGET_CONSTANTS_MAP,
      "geo-suggest.ts must be a re-export barrel, not an independent copy",
    );
  });
});

// ─── 2. resolveGeoLocation (single) ──────────────────────────────────

describe("resolveGeoLocation", () => {
  it("resolves via suggest API (primary path) and populates countryCode + targetType", async () => {
    const { client } = makeClient({
      london: { resourceName: "geoTargetConstants/1006886", displayName: "London, England, United Kingdom" },
    });
    const result = await resolveGeoLocation("london", client as never, CREDS);
    assert.ok(result, "should resolve");
    assert.equal(result!.resourceName, "geoTargetConstants/1006886");
    assert.equal(result!.canonicalName, "London, England, United Kingdom");
    assert.equal(result!.countryCode, "GB");
    assert.equal(result!.targetType, "City");
    assert.equal(result!.source, "suggest");
  });

  it("falls back to hardcoded map when suggest returns null", async () => {
    const { client } = makeClient({ london: null });
    const result = await resolveGeoLocation("london", client as never, CREDS);
    assert.ok(result);
    assert.equal(result!.resourceName, "geoTargetConstants/1006886");
    assert.equal(result!.source, "fallback");
  });

  it("falls back to hardcoded map when suggest throws", async () => {
    const { client } = makeClient({}, { throws: true });
    const result = await resolveGeoLocation("london", client as never, CREDS);
    assert.ok(result);
    assert.equal(result!.resourceName, "geoTargetConstants/1006886");
    assert.equal(result!.source, "fallback");
  });

  it("returns null for unresolvable locations", async () => {
    const { client } = makeClient({ atlantis: null });
    const result = await resolveGeoLocation("atlantis", client as never, CREDS);
    assert.equal(result, null);
  });

  it("returns null for empty string", async () => {
    const { client } = makeClient({});
    const result = await resolveGeoLocation("   ", client as never, CREDS);
    assert.equal(result, null);
  });
});

// ─── 3. resolveGeoLocations (batch) ─────────────────────────────────

describe("resolveGeoLocations", () => {
  it("resolves batch via suggest and returns GeoResolution with canonicalName", async () => {
    const { client } = makeClient({
      london: { resourceName: "geoTargetConstants/1006886", displayName: "London, England, United Kingdom" },
    });
    const cache = new Map<string, GeoResolution | null>();
    const results = await resolveGeoLocations(["london"], client as never, CREDS, cache);
    assert.equal(results[0]?.resourceName, "geoTargetConstants/1006886");
    assert.equal(results[0]?.canonicalName, "London, England, United Kingdom");
    assert.equal(results[0]?.source, "suggest");
  });

  it("uses session cache — does not re-query the same location twice", async () => {
    let suggestCalled = 0;
    const client = {
      async suggestGeoTargetConstants(_rt: string, names: string[]) {
        suggestCalled += 1;
        return names.map(() => ({
          resourceName: "geoTargetConstants/1006886",
          displayName: "London",
          countryCode: "GB",
          targetType: "City",
        }));
      },
    };
    const cache = new Map<string, GeoResolution | null>();
    await resolveGeoLocations(["london"], client as never, CREDS, cache);
    await resolveGeoLocations(["london"], client as never, CREDS, cache);
    assert.equal(suggestCalled, 1, "suggest API called only once for the same location");
  });

  it("returns null for unresolvable locations", async () => {
    const { client } = makeClient({ atlantis: null });
    const cache = new Map<string, GeoResolution | null>();
    const results = await resolveGeoLocations(["atlantis"], client as never, CREDS, cache);
    assert.equal(results[0], null);
  });
});
