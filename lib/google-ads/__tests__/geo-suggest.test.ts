/**
 * Unit tests for lib/google-ads/geo-suggest.ts
 *
 * Covers:
 *  1. lookupFallbackGeoConstant — key normalisation + map lookup
 *  2. resolveGeoLocations — suggest API primary path (mocked),
 *     fallback path when suggest returns null, and unresolvable strings
 *  3. buildGeoCriterionOp — payload shape with and without bidModifier
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  lookupFallbackGeoConstant,
  resolveGeoLocations,
} from "../geo-suggest.ts";
import { buildGeoCriterionOp } from "../campaign-writer.ts";
import type { GoogleAdsCustomerCredentials } from "../client.ts";

// ─── Fixtures ────────────────────────────────────────────────────────

const CREDS: GoogleAdsCustomerCredentials = {
  customerId: "793-280-0197",
  refreshToken: "refresh-token",
  loginCustomerId: "333-703-8088",
};

// ─── 1. lookupFallbackGeoConstant ────────────────────────────────────

describe("lookupFallbackGeoConstant", () => {
  it("returns the London resource name (exact, lowercase)", () => {
    const result = lookupFallbackGeoConstant("london");
    assert.equal(result, "geoTargetConstants/1006886");
  });

  it("is case-insensitive", () => {
    assert.equal(lookupFallbackGeoConstant("London"), "geoTargetConstants/1006886");
    assert.equal(lookupFallbackGeoConstant("LONDON"), "geoTargetConstants/1006886");
  });

  it("normalises extra whitespace", () => {
    assert.equal(lookupFallbackGeoConstant(" south east "), "geoTargetConstants/9049069");
  });

  it("matches 'uk' alias for United Kingdom", () => {
    assert.equal(lookupFallbackGeoConstant("uk"), "geoTargetConstants/2826");
    assert.equal(lookupFallbackGeoConstant("United Kingdom"), "geoTargetConstants/2826");
  });

  it("returns null for an unknown location", () => {
    assert.equal(lookupFallbackGeoConstant("atlantis"), null);
  });
});

// ─── 2. resolveGeoLocations ──────────────────────────────────────────

function makeFakeClientWithSuggest(
  responses: Record<string, { resourceName: string; displayName: string } | null>,
) {
  return {
    async suggestGeoTargetConstants(
      _refreshToken: string,
      names: string[],
    ): Promise<Array<{ resourceName: string; displayName: string } | null>> {
      return names.map((n) => responses[n.toLowerCase()] ?? responses[n] ?? null);
    },
    // Satisfy GoogleAdsClient interface for the writer's usage.
    async mutate() { return { results: [] }; },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("resolveGeoLocations — suggest API primary path", () => {
  it("resolves 'london' via the suggest response", async () => {
    const client = makeFakeClientWithSuggest({
      london: { resourceName: "geoTargetConstants/1006886", displayName: "London, England" },
    });
    const cache = new Map();
    const results = await resolveGeoLocations(["london"], client, CREDS, cache);
    assert.equal(results.length, 1);
    assert.equal(results[0]?.resourceName, "geoTargetConstants/1006886");
    assert.equal(results[0]?.source, "suggest");
  });

  it("falls back to map when suggest returns null for that name", async () => {
    const client = makeFakeClientWithSuggest({
      // suggest returns null for 'london' — unusual but possible
      london: null,
    });
    const cache = new Map();
    const results = await resolveGeoLocations(["london"], client, CREDS, cache);
    assert.equal(results[0]?.resourceName, "geoTargetConstants/1006886");
    assert.equal(results[0]?.source, "fallback");
  });

  it("returns null for strings unresolvable by both suggest and fallback map", async () => {
    const client = makeFakeClientWithSuggest({ atlantis: null });
    const cache = new Map();
    const results = await resolveGeoLocations(["atlantis"], client, CREDS, cache);
    assert.equal(results[0], null);
  });

  it("uses the session cache — does not re-query the same location twice", async () => {
    let callCount = 0;
    const client = {
      async suggestGeoTargetConstants(_rt: string, names: string[]) {
        callCount += 1;
        return names.map(() => ({
          resourceName: "geoTargetConstants/1006886",
          displayName: "London",
        }));
      },
      async mutate() { return { results: [] }; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const cache = new Map();
    await resolveGeoLocations(["london"], client, CREDS, cache);
    await resolveGeoLocations(["london"], client, CREDS, cache);
    assert.equal(callCount, 1, "suggest API called only once for the same location");
  });

  it("deduplicates names before calling the API (same name in two campaigns)", async () => {
    let receivedNames: string[] = [];
    const client = {
      async suggestGeoTargetConstants(_rt: string, names: string[]) {
        receivedNames = names;
        return names.map(() => ({
          resourceName: "geoTargetConstants/1006886",
          displayName: "London",
        }));
      },
      async mutate() { return { results: [] }; },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const cache = new Map();
    // Two "london" entries — deduplicated in pushGoogleSearchPlan, but this
    // also works from the cache if the first call populated it.
    await resolveGeoLocations(["london", "london"], client, CREDS, cache);
    // Second "london" was already in cache after the first iteration.
    assert.equal(receivedNames.length, 1);
  });
});

// ─── 3. buildGeoCriterionOp ──────────────────────────────────────────

describe("buildGeoCriterionOp", () => {
  const CAMPAIGN = "customers/7932800197/campaigns/123";
  const GEO = "geoTargetConstants/1006886";

  it("builds a create op with location and bidModifier when pct is non-null", () => {
    const op = buildGeoCriterionOp(CAMPAIGN, GEO, 20);
    assert.deepEqual(op, {
      create: {
        campaign: CAMPAIGN,
        location: { geoTargetConstant: GEO },
        bidModifier: 1.2,
      },
    });
  });

  it("+20% → bidModifier 1.20, -10% → bidModifier 0.90", () => {
    assert.equal((buildGeoCriterionOp(CAMPAIGN, GEO, 20).create as Record<string, unknown>).bidModifier, 1.2);
    assert.equal((buildGeoCriterionOp(CAMPAIGN, GEO, -10).create as Record<string, unknown>).bidModifier, 0.9);
  });

  it("omits bidModifier when pct is null", () => {
    const op = buildGeoCriterionOp(CAMPAIGN, GEO, null);
    assert.ok(!("bidModifier" in (op.create as Record<string, unknown>)));
  });

  it("omits bidModifier when pct is undefined", () => {
    const op = buildGeoCriterionOp(CAMPAIGN, GEO, undefined);
    assert.ok(!("bidModifier" in (op.create as Record<string, unknown>)));
  });
});
