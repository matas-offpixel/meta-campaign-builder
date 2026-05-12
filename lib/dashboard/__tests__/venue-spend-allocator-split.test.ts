import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  equalSplitMonetaryAmounts,
  extractKocVenuePrefix,
  isKocVenueFixtureCode,
  isWc26OpponentAllocatorEventCode,
} from "../venue-equal-split.ts";

describe("isWc26OpponentAllocatorEventCode", () => {
  it("is true for WC26-* prefixes only", () => {
    assert.equal(isWc26OpponentAllocatorEventCode("WC26-BRIGHTON"), true);
    assert.equal(isWc26OpponentAllocatorEventCode("  WC26-LONDON-KENTISH  "), true);
    // Non-WC26 codes — these drive the non-event_date-scoped sibling query path
    assert.equal(isWc26OpponentAllocatorEventCode("4TF26-ARSENAL-CL-FL"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("4TF-TITLERUNIN-LONDON"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("4TF26-ARSENAL-CL-DUBLIN"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("4TF26-ARSENAL-CL-SF"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("4TF26-PALACE-FINAL"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("LEEDS26-FACUP"), false);
    assert.equal(isWc26OpponentAllocatorEventCode("BB26-KAYODE"), false);
  });
});

/**
 * KOC allocator routing regression tests.
 *
 * KOC event_codes are WC26-KOC-{VENUE}-{T1}-{T2} (5 parts) in the DB.
 * Meta campaigns are tagged at venue level ([WC26-KOC-BRIXTON] — 3 parts),
 * so isKocVenueFixtureCode must fire for ANY WC26-KOC-* code, regardless
 * of depth. The allocator uses equal-split, not the opponent path, for all KOC.
 */
describe("isKocVenueFixtureCode", () => {
  it("returns true for 5-part KOC fixture event_codes", () => {
    assert.equal(isKocVenueFixtureCode("WC26-KOC-BRIXTON-ENG-CRO"), true);
    assert.equal(isKocVenueFixtureCode("WC26-KOC-HACKNEY-FRA-SEN"), true);
    assert.equal(isKocVenueFixtureCode("WC26-KOC-SOHO-SCO-BRA"), true);
    assert.equal(isKocVenueFixtureCode("  wc26-koc-brixton-aus-usa  "), true);
  });

  it("also returns true for 3-part venue prefix codes (campaign bracket level)", () => {
    // Meta campaigns use [WC26-KOC-BRIXTON] — these must also be detected
    assert.equal(isKocVenueFixtureCode("WC26-KOC-BRIXTON"), true);
    assert.equal(isKocVenueFixtureCode("WC26-KOC-HACKNEY"), true);
  });

  it("returns false for non-KOC WC26 codes", () => {
    assert.equal(isKocVenueFixtureCode("WC26-BRIGHTON"), false);
    assert.equal(isKocVenueFixtureCode("WC26-GLASGOW-HAMPDEN-ENG-SCO"), false);
  });

  it("returns false for non-WC26 codes", () => {
    assert.equal(isKocVenueFixtureCode("4TF26-PALACE-FINAL"), false);
    assert.equal(isKocVenueFixtureCode("LEEDS26-FACUP"), false);
  });
});

describe("extractKocVenuePrefix", () => {
  it("strips fixture suffix to 3-part venue code", () => {
    assert.equal(extractKocVenuePrefix("WC26-KOC-BRIXTON-ENG-CRO"), "WC26-KOC-BRIXTON");
    assert.equal(extractKocVenuePrefix("WC26-KOC-HACKNEY-FRA-SEN"), "WC26-KOC-HACKNEY");
    assert.equal(extractKocVenuePrefix("WC26-KOC-SOHO-SCO-BRA"), "WC26-KOC-SOHO");
    assert.equal(extractKocVenuePrefix("wc26-koc-brixton-eng-gha"), "WC26-KOC-BRIXTON");
  });

  it("Brixton has 5 fixtures → spend ÷ 5 per allocation", () => {
    const prefix = extractKocVenuePrefix("WC26-KOC-BRIXTON-ENG-CRO");
    assert.equal(prefix, "WC26-KOC-BRIXTON");
    const totalSpend = 5000;
    const shares = equalSplitMonetaryAmounts(totalSpend, 5);
    assert.equal(shares.length, 5);
    assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - totalSpend) < 0.02);
    for (const s of shares) {
      assert.ok(s >= 999 && s <= 1001, `share ${s} should be ~1000`);
    }
  });

  it("Hackney has 6 fixtures → spend ÷ 6 per allocation", () => {
    const prefix = extractKocVenuePrefix("WC26-KOC-HACKNEY-FRA-SEN");
    assert.equal(prefix, "WC26-KOC-HACKNEY");
    const totalSpend = 6000;
    const shares = equalSplitMonetaryAmounts(totalSpend, 6);
    assert.equal(shares.length, 6);
    assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - totalSpend) < 0.02);
    for (const s of shares) {
      assert.ok(s >= 999 && s <= 1001, `share ${s} should be ~1000`);
    }
  });

  it("Soho has 5 fixtures → spend ÷ 5 per allocation", () => {
    const prefix = extractKocVenuePrefix("WC26-KOC-SOHO-FRA-SEN");
    assert.equal(prefix, "WC26-KOC-SOHO");
    const totalSpend = 5000;
    const shares = equalSplitMonetaryAmounts(totalSpend, 5);
    assert.equal(shares.length, 5);
    assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - totalSpend) < 0.02);
  });
});

describe("equalSplitMonetaryAmounts", () => {
  it("splits evenly with remainder on last index", () => {
    const parts = equalSplitMonetaryAmounts(100, 3);
    assert.equal(parts.length, 3);
    assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) - 100) < 0.02);
  });

  it("3-way £5,000 TITLERUNIN split: each fixture gets ~£1,666.67", () => {
    const parts = equalSplitMonetaryAmounts(5000, 3);
    assert.equal(parts.length, 3);
    assert.ok(Math.abs(parts.reduce((a, b) => a + b, 0) - 5000) < 0.02);
    // Each part is ~1666.67; last absorbs rounding
    for (const p of parts) {
      assert.ok(p >= 1666 && p <= 1668, `part ${p} out of range`);
    }
  });

  it("handles singleton total", () => {
    assert.deepEqual(equalSplitMonetaryAmounts(219.16, 1), [219.16]);
  });

  it("handles two-way split", () => {
    const parts = equalSplitMonetaryAmounts(219.16, 2);
    assert.equal(parts.length, 2);
    assert.ok(Math.abs(parts[0] + parts[1] - 219.16) < 0.02);
  });
});
