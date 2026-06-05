/**
 * lib/customer-audience/__tests__/csv-parse.test.ts
 *
 * Tests for the CSV parsing utilities.
 * Runs under Node's built-in test runner (node:test).
 *
 * parseCsv uses Papaparse + File API — full integration tests require a
 * browser/jsdom. This file tests the environment-agnostic helpers:
 * autoDetectColumns and validateFiles.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoDetectColumns,
  validateFiles,
  MAX_FILES,
  MAX_FILE_SIZE_BYTES,
} from "../csv-parse.ts";

// ─── File stub (Node 18+ has File globally) ───────────────────────────────────

function makeFile(name: string, sizeBytes: number): File {
  const content = "a".repeat(sizeBytes);
  return new File([content], name, { type: "text/csv" });
}

// ─── autoDetectColumns ────────────────────────────────────────────────────────

describe("autoDetectColumns", () => {
  it("detects 'email' header", () => {
    const map = autoDetectColumns(["Email", "Name"]);
    assert.equal(map["Email"], "email");
    assert.equal(map["Name"], "skip");
  });

  it("detects 'phone' header", () => {
    const map = autoDetectColumns(["phone", "city"]);
    assert.equal(map["phone"], "phone");
    assert.equal(map["city"], "skip");
  });

  it("detects 'mobile' as phone", () => {
    const map = autoDetectColumns(["Mobile"]);
    assert.equal(map["Mobile"], "phone");
  });

  it("detects 'e-mail' as email", () => {
    const map = autoDetectColumns(["e-mail"]);
    assert.equal(map["e-mail"], "email");
  });

  it("handles empty header list", () => {
    assert.deepEqual(autoDetectColumns([]), {});
  });

  it("handles columns with partial matches", () => {
    const map = autoDetectColumns(["customer_email", "mobile_number"]);
    assert.equal(map["customer_email"], "email");
    assert.equal(map["mobile_number"], "phone");
  });

  it("defaults unrecognised columns to skip", () => {
    const map = autoDetectColumns(["first_name", "dob"]);
    assert.equal(map["first_name"], "skip");
    assert.equal(map["dob"], "skip");
  });
});

// ─── validateFiles ────────────────────────────────────────────────────────────

describe("validateFiles", () => {
  it("passes a valid single CSV file", () => {
    const files = [makeFile("customers.csv", 500)];
    assert.deepEqual(validateFiles(files), []);
  });

  it("passes multiple valid CSV files up to MAX_FILES", () => {
    const files = Array.from({ length: MAX_FILES }, (_, i) =>
      makeFile(`file${i}.csv`, 100),
    );
    assert.deepEqual(validateFiles(files), []);
  });

  it("rejects more than MAX_FILES files", () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, i) =>
      makeFile(`file${i}.csv`, 100),
    );
    const errors = validateFiles(files);
    assert.ok(errors.some((e) => e.includes("Maximum")));
  });

  it("rejects non-CSV files", () => {
    const files = [makeFile("data.xlsx", 100)];
    const errors = validateFiles(files);
    assert.ok(errors.some((e) => e.includes(".xlsx")));
  });

  it("rejects files exceeding 50 MB", () => {
    const files = [makeFile("huge.csv", MAX_FILE_SIZE_BYTES + 1)];
    const errors = validateFiles(files);
    assert.ok(errors.some((e) => e.includes("exceeds 50 MB")));
  });

  it("returns multiple errors for multiple issues", () => {
    const files = [
      makeFile("bad.xlsx", 100),
      makeFile("toobig.csv", MAX_FILE_SIZE_BYTES + 1),
    ];
    const errors = validateFiles(files);
    assert.ok(errors.length >= 2);
  });
});
