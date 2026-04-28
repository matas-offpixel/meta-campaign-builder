// ─────────────────────────────────────────────────────────────────────────────
// Tests for the weekly-ticket-tracker xlsx parser. Exercises the shape-
// detection, date parsing, and column-group inference without touching
// the file system (we synthesize minimal workbook objects).
//
// Run with: npm test
// ─────────────────────────────────────────────────────────────────────────────

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";

import {
  parseTicketingWorkbook,
  parseWeekLabel,
} from "../parse-ticketing-xlsx.ts";

function sheetFromRows(rows: Array<Array<string | number | null>>): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

function workbook(
  sheets: Record<string, Array<Array<string | number | null>>>,
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), name);
  }
  return wb;
}

describe("parseWeekLabel", () => {
  it("accepts ordinal short-month forms with reference year", () => {
    assert.equal(parseWeekLabel("23rd Feb", 2026), "2026-02-23");
    assert.equal(parseWeekLabel("2nd March", 2026), "2026-03-02");
    assert.equal(parseWeekLabel("6 April", 2026), "2026-04-06");
  });
  it("accepts full-month with explicit year", () => {
    assert.equal(parseWeekLabel("23rd February 2026", 2020), "2026-02-23");
  });
  it("accepts W/C prefix", () => {
    assert.equal(parseWeekLabel("W/C 23rd Feb", 2026), "2026-02-23");
  });
  it("accepts UK dd/mm/yyyy", () => {
    assert.equal(parseWeekLabel("23/02/2026", 2020), "2026-02-23");
    assert.equal(parseWeekLabel("23/02/26", 2020), "2026-02-23");
  });
  it("accepts ISO YYYY-MM-DD", () => {
    assert.equal(parseWeekLabel("2026-02-23", 2020), "2026-02-23");
  });
  it("returns null on garbage", () => {
    assert.equal(parseWeekLabel("payday", 2026), null);
    assert.equal(parseWeekLabel("", 2026), null);
  });
});

describe("parseTicketingWorkbook", () => {
  it("parses the J2 Bridge Tracker-style sheet (2 cols per event)", () => {
    // Mirrors the real j2-bridge-ticket-tracker.xlsx structure — Total +
    // Increase per event. Validates column-group detection against the
    // typical operator format.
    const wb = workbook({
      "J2 Bridge": [
        [
          "Key Dates",
          "W/C",
          "J2 x Fabric",
          null,
          "J2 Melodic",
          null,
          "Weekly Sold",
        ],
        [null, null, "Total", "Increase", "Total", "Increase", "Total"],
        [null, "9th Feb", "863", "863", "211", "211", "1,074"],
        [null, "16th Feb", "973", "110", "220", "9", "1,193"],
        [null, "23rd Feb", "1,035", "62", "235", "15", "1,270"],
      ],
    });

    const result = parseTicketingWorkbook(wb, { referenceYear: 2026 });

    assert.equal(result.errors.length, 0);
    assert.equal(result.sheets.length, 1);
    assert.deepEqual(result.sheets[0].eventsDetected.sort(), [
      "J2 Melodic",
      "J2 x Fabric",
      "Weekly Sold",
    ]);
    // 3 events × 3 weeks = 9 snapshots.
    assert.equal(result.snapshots.length, 9);

    // Spot-check one event's weekly progression.
    const fabric = result.snapshots
      .filter((s) => s.eventLabel === "J2 x Fabric")
      .sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
    assert.deepEqual(
      fabric.map((s) => [s.snapshotAt, s.ticketsSold, s.weeklyIncrease]),
      [
        ["2026-02-09", 863, 863],
        ["2026-02-16", 973, 110],
        ["2026-02-23", 1035, 62],
      ],
    );
  });

  it("ignores events with no metric header (empty Total column)", () => {
    const wb = workbook({
      "Sheet1": [
        ["", "W/C", "Event A", null],
        [null, null, "Total", "Increase"],
        [null, "23rd Feb", "100", "100"],
      ],
    });
    const result = parseTicketingWorkbook(wb, { referenceYear: 2026 });
    assert.equal(result.snapshots.length, 1);
    assert.deepEqual(result.errors, []);
  });

  it("skips blank-cell snapshot rows without erroring", () => {
    const wb = workbook({
      "Sheet1": [
        ["", "W/C", "Event A"],
        [null, null, "Total"],
        [null, "23rd Feb", "100"],
        [null, "2nd March", ""],
        [null, "9th March", "120"],
      ],
    });
    const result = parseTicketingWorkbook(wb, { referenceYear: 2026 });
    assert.equal(result.snapshots.length, 2);
    assert.equal(result.errors.length, 0);
  });

  it("reports unparseable dates but keeps going", () => {
    const wb = workbook({
      "Sheet1": [
        ["", "W/C", "Event A"],
        [null, null, "Total"],
        [null, "payday", "100"],
        [null, "2nd March", "120"],
      ],
    });
    const result = parseTicketingWorkbook(wb, { referenceYear: 2026 });
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].kind, "unparseable_date");
    assert.equal(result.errors[0].raw, "payday");
  });

  it("reports non-numeric ticket cells but keeps going", () => {
    const wb = workbook({
      "Sheet1": [
        ["", "W/C", "Event A"],
        [null, null, "Total"],
        [null, "23rd Feb", "abc"],
        [null, "2nd March", "120"],
      ],
    });
    const result = parseTicketingWorkbook(wb, { referenceYear: 2026 });
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.errors[0].kind, "non_numeric_tickets");
  });

  it("flags a sheet with no metric header", () => {
    const wb = workbook({
      "Sheet1": [
        ["a", "b", "c"],
        ["d", "e", "f"],
        ["g", "h", "i"],
      ],
    });
    const result = parseTicketingWorkbook(wb, { referenceYear: 2026 });
    assert.equal(result.snapshots.length, 0);
    assert.equal(result.errors[0].kind, "missing_metric_header");
  });
});
