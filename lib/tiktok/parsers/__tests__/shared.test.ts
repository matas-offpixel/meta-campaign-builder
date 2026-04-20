// ─────────────────────────────────────────────────────────────────────────────
// Tests for the shared TikTok parser primitives.
//
// Run with: npm test
// (Node 22.6+ strips TS at runtime via --experimental-strip-types.)
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  TIKTOK_METRIC_COLUMNS,
  buildHeaderIndex,
  detectFileType,
  extractDateRangeFromFilename,
  isMaskedCell,
  isSkippableRow,
  parseCurrencyFromCell,
  parseMetricBlock,
  parseNumberCell,
  parseStatusCell,
} from "../shared.ts";

describe("parseNumberCell", () => {
  it("masks '<5' to null", () => {
    assert.equal(parseNumberCell("<5"), null);
    assert.equal(parseNumberCell("< 5"), null);
  });

  it("returns null for placeholders", () => {
    assert.equal(parseNumberCell("--"), null);
    assert.equal(parseNumberCell(""), null);
    assert.equal(parseNumberCell("N/A"), null);
    assert.equal(parseNumberCell(null), null);
    assert.equal(parseNumberCell(undefined), null);
  });

  it("parses thousands-separated numbers", () => {
    assert.equal(parseNumberCell("1,234.56"), 1234.56);
    assert.equal(parseNumberCell("1,234,567"), 1234567);
  });

  it("parses currency-prefixed cells preserving display scale", () => {
    assert.equal(parseNumberCell("£1.23"), 1.23);
    assert.equal(parseNumberCell("£1,234.56"), 1234.56);
    assert.equal(parseNumberCell("$10"), 10);
  });

  it("parses percent cells preserving display scale (1.23% → 1.23, NOT 0.0123)", () => {
    assert.equal(parseNumberCell("1.23%"), 1.23);
    assert.equal(parseNumberCell("100%"), 100);
  });

  it("passes through actual numbers", () => {
    assert.equal(parseNumberCell(42), 42);
    assert.equal(parseNumberCell(0), 0);
    assert.equal(parseNumberCell(NaN), null);
    assert.equal(parseNumberCell(Infinity), null);
  });

  it("trims whitespace and stray junk", () => {
    assert.equal(parseNumberCell("  3 "), 3);
    assert.equal(parseNumberCell("GBP 1,234.56"), 1234.56);
  });
});

describe("isMaskedCell", () => {
  it("matches '<5' but not other low numbers", () => {
    assert.equal(isMaskedCell("<5"), true);
    assert.equal(isMaskedCell("< 5"), true);
    assert.equal(isMaskedCell("5"), false);
    assert.equal(isMaskedCell("4"), false);
    assert.equal(isMaskedCell(""), false);
    assert.equal(isMaskedCell(null), false);
  });
});

describe("parseCurrencyFromCell", () => {
  it("maps symbols to ISO codes", () => {
    assert.equal(parseCurrencyFromCell("£1.23"), "GBP");
    assert.equal(parseCurrencyFromCell("$10"), "USD");
    assert.equal(parseCurrencyFromCell("€5"), "EUR");
  });

  it("picks ISO codes embedded in cells", () => {
    assert.equal(parseCurrencyFromCell("GBP 1,234.56"), "GBP");
    assert.equal(parseCurrencyFromCell("EUR 5"), "EUR");
  });

  it("defaults to GBP when no currency detected", () => {
    assert.equal(parseCurrencyFromCell("1.23"), "GBP");
    assert.equal(parseCurrencyFromCell(""), "GBP");
    assert.equal(parseCurrencyFromCell(null), "GBP");
  });
});

describe("parseStatusCell", () => {
  it("returns null for '--' and empty", () => {
    assert.equal(parseStatusCell("--"), null);
    assert.equal(parseStatusCell(""), null);
    assert.equal(parseStatusCell(null), null);
  });

  it("trims and collapses whitespace", () => {
    assert.equal(parseStatusCell("  Active  "), "Active");
    assert.equal(parseStatusCell("Not  delivering"), "Not delivering");
  });
});

describe("detectFileType", () => {
  it("detects campaign exports", () => {
    assert.equal(
      detectFileType(["Campaign name", "Primary status", "Cost", "Impressions"]),
      "campaign",
    );
  });

  it("detects ad exports (priority over campaign)", () => {
    assert.equal(
      detectFileType(["Ad name", "Primary status", "Cost"]),
      "ad",
    );
  });

  it("detects geo exports by country / region / city", () => {
    assert.equal(detectFileType(["Country", "Cost", "Impressions"]), "geo");
    assert.equal(detectFileType(["Region", "Cost"]), "geo");
    assert.equal(detectFileType(["City", "Cost"]), "geo");
  });

  it("detects demographic exports by Age + Gender", () => {
    assert.equal(
      detectFileType(["Age", "Gender", "Cost", "Impressions"]),
      "demographic",
    );
  });

  it("detects interest exports by Audience or Interest", () => {
    assert.equal(detectFileType(["Audience", "Cost"]), "interest");
    assert.equal(detectFileType(["Interest", "Cost"]), "interest");
  });

  it("detects search-term exports", () => {
    assert.equal(
      detectFileType(["Search term", "Cost", "Impressions"]),
      "search_term",
    );
  });

  it("returns null for unknown headers", () => {
    assert.equal(detectFileType(["Foo", "Bar", "Baz"]), null);
    assert.equal(detectFileType([]), null);
  });

  it("handles non-breaking spaces and case", () => {
    assert.equal(
      detectFileType(["CAMPAIGN\u00a0NAME", "primary status", "cost"]),
      "campaign",
    );
  });
});

describe("extractDateRangeFromFilename", () => {
  it("parses _YYYYMMDD_YYYYMMDD_ filenames", () => {
    assert.deepEqual(
      extractDateRangeFromFilename("Campaign_20260101_20260131_GMT+0.xlsx"),
      { start: "2026-01-01", end: "2026-01-31" },
    );
  });

  it("parses YYYYMMDD-YYYYMMDD filenames", () => {
    assert.deepEqual(
      extractDateRangeFromFilename("export-20251201-20251231.xlsx"),
      { start: "2025-12-01", end: "2025-12-31" },
    );
  });

  it("returns null when no range present", () => {
    assert.equal(extractDateRangeFromFilename("Campaign.xlsx"), null);
    assert.equal(extractDateRangeFromFilename(""), null);
  });

  it("rejects invalid month/day", () => {
    assert.equal(
      extractDateRangeFromFilename("Campaign_20261301_20261232_.xlsx"),
      null,
    );
  });
});

describe("buildHeaderIndex + parseMetricBlock", () => {
  it("maps every metric column by canonical header", () => {
    const headers = TIKTOK_METRIC_COLUMNS.map((c) => c.header);
    const idx = buildHeaderIndex(headers);
    assert.equal(Object.keys(idx).length, TIKTOK_METRIC_COLUMNS.length);
  });

  it("masks impressions cell preserving impressions_raw", () => {
    const headers = ["Impressions", "Cost"];
    const idx = buildHeaderIndex(headers);
    const block = parseMetricBlock(["<5", "1.23"], idx);
    assert.equal(block.impressions, null);
    assert.equal(block.impressions_raw, "<5");
    assert.equal(block.cost, 1.23);
  });

  it("populates fields by index regardless of column order", () => {
    const headers = ["CPM", "Cost", "Impressions"];
    const idx = buildHeaderIndex(headers);
    const block = parseMetricBlock(["10.5", "£100", "1,234"], idx);
    assert.equal(block.cpm, 10.5);
    assert.equal(block.cost, 100);
    assert.equal(block.impressions, 1234);
  });

  it("falls back to null for missing columns", () => {
    const headers = ["Cost"];
    const idx = buildHeaderIndex(headers);
    const block = parseMetricBlock(["£42"], idx);
    assert.equal(block.cost, 42);
    assert.equal(block.cpm, null);
    assert.equal(block.video_views_p100, null);
  });

  it("respects column aliases", () => {
    const headers = ["Spend", "Destination clicks"];
    const idx = buildHeaderIndex(headers);
    const block = parseMetricBlock(["£5", "100"], idx);
    assert.equal(block.cost, 5);
    assert.equal(block.clicks_destination, 100);
  });
});

describe("isSkippableRow", () => {
  it("skips empty / null cells", () => {
    assert.equal(isSkippableRow(""), true);
    assert.equal(isSkippableRow(null), true);
    assert.equal(isSkippableRow(undefined), true);
    assert.equal(isSkippableRow("   "), true);
  });

  it("skips total / summary rows", () => {
    assert.equal(isSkippableRow("Total"), true);
    assert.equal(isSkippableRow("Total of 42 results"), true);
    assert.equal(isSkippableRow("Total of 1 result"), true);
    assert.equal(isSkippableRow("Summary"), true);
    assert.equal(isSkippableRow("Grand Total"), true);
  });

  it("keeps real data rows", () => {
    assert.equal(isSkippableRow("[BB26-RIANBRAZIL]"), false);
    assert.equal(isSkippableRow("United Kingdom"), false);
  });
});
