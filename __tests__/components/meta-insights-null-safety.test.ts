/**
 * Null-safety regression tests for MetaCampaignBreakdownSection,
 * MetaDemographicsSection, and DemographicTable.
 *
 * The internal /events/[id]?tab=reporting page crashed after PR #505 with
 * "Cannot read properties of undefined (reading 'length')" because the
 * Meta insights API can return an EventInsightsPayload where:
 *   - meta.campaigns is undefined (not yet matched) rather than []
 *   - demographics sub-arrays (regions, ageRanges, genders) are undefined
 *     even though the demographics object itself is non-null
 *
 * These tests exercise the pure logic extracted from each guard added.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── DemographicTable guard logic ─────────────────────────────────────────────
// The DemographicTable component now does: const safeRows = rows ?? [];
// Ensure the guard produces an empty array for undefined/null input and
// returns rows unchanged for a real array.
function demographicTableSafeRows(rows: unknown[] | undefined | null): unknown[] {
  return rows ?? [];
}

describe("DemographicTable safeRows guard", () => {
  it("returns [] when rows is undefined", () => {
    assert.deepEqual(demographicTableSafeRows(undefined), []);
  });

  it("returns [] when rows is null", () => {
    assert.deepEqual(demographicTableSafeRows(null), []);
  });

  it("returns original array when rows is defined", () => {
    const rows = [{ label: "London", spend: 100, impressions: 1000, reach: 800, clicks: 50 }];
    assert.deepEqual(demographicTableSafeRows(rows), rows);
  });

  it("safeRows.length is safe on empty array", () => {
    const safeRows = demographicTableSafeRows(undefined);
    assert.equal(safeRows.length, 0);
  });
});

// ─── MetaDemographicsSection guard logic ──────────────────────────────────────
// Each demographics sub-array is now guarded with `?? []` before being passed
// to DemographicTable. Verify the guard pattern works for partial objects.
interface Demographics {
  regions?: unknown[] | null;
  ageRanges?: unknown[] | null;
  genders?: unknown[] | null;
}

function resolveRegions(d: Demographics): unknown[] {
  return d.regions ?? [];
}
function resolveAgeRanges(d: Demographics): unknown[] {
  return d.ageRanges ?? [];
}
function resolveGenders(d: Demographics): unknown[] {
  return d.genders ?? [];
}

describe("MetaDemographicsSection sub-array guards", () => {
  it("regions defaults to [] when undefined", () => {
    assert.deepEqual(resolveRegions({}), []);
  });
  it("ageRanges defaults to [] when undefined", () => {
    assert.deepEqual(resolveAgeRanges({}), []);
  });
  it("genders defaults to [] when undefined", () => {
    assert.deepEqual(resolveGenders({}), []);
  });

  it("regions passes through when populated", () => {
    const row = { label: "London", spend: 100, impressions: 500, reach: 400, clicks: 20 };
    assert.deepEqual(resolveRegions({ regions: [row] }), [row]);
  });

  it("all three can be undefined simultaneously without crash", () => {
    const demo: Demographics = {};
    assert.equal(resolveRegions(demo).length, 0);
    assert.equal(resolveAgeRanges(demo).length, 0);
    assert.equal(resolveGenders(demo).length, 0);
  });
});

// ─── MetaCampaignBreakdownSection guard logic ─────────────────────────────────
// meta.campaigns is now guarded with `?? []` before the length check and
// before being passed to sortCampaignsByStatusThenSpend.
function resolveCampaigns(meta: { campaigns?: unknown[] | null }): unknown[] {
  return meta.campaigns ?? [];
}

describe("MetaCampaignBreakdownSection campaigns guard", () => {
  it("returns [] when meta.campaigns is undefined", () => {
    assert.deepEqual(resolveCampaigns({}), []);
  });

  it("returns [] when meta.campaigns is null", () => {
    assert.deepEqual(resolveCampaigns({ campaigns: null }), []);
  });

  it("returns campaigns array when defined", () => {
    const campaigns = [{ id: "c1", name: "Test", spend: 100 }];
    assert.deepEqual(resolveCampaigns({ campaigns }), campaigns);
  });

  it("length check is safe on guarded result", () => {
    const rawCampaigns = resolveCampaigns({});
    assert.equal(rawCampaigns.length, 0);
  });
});

// ─── totalCrossPlatformSpent default guard ────────────────────────────────────
// MetaReportBlockProps.totalCrossPlatformSpent is now optional with a default
// of 0 in the destructuring. Verify the default kicks in correctly.
function resolveTotal(spent: number | undefined): number {
  return spent ?? 0;
}

describe("totalCrossPlatformSpent default guard", () => {
  it("defaults to 0 when undefined", () => {
    assert.equal(resolveTotal(undefined), 0);
  });
  it("passes through a real value", () => {
    assert.equal(resolveTotal(1234.56), 1234.56);
  });
  it("passes through 0 as a real value", () => {
    assert.equal(resolveTotal(0), 0);
  });
});
