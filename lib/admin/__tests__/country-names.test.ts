import { test } from "node:test";
import assert from "node:assert/strict";

import { countryName, formatCountry } from "../country-names.ts";

test("countryName resolves common ISO-2 codes", () => {
  assert.equal(countryName("GB"), "United Kingdom");
  assert.equal(countryName("ES"), "Spain");
  assert.equal(countryName("US"), "United States");
});

test("countryName is case-insensitive", () => {
  assert.equal(countryName("gb"), "United Kingdom");
});

test("countryName returns null for null/blank/malformed", () => {
  assert.equal(countryName(null), null);
  assert.equal(countryName(undefined), null);
  assert.equal(countryName(""), null);
  assert.equal(countryName("GBR"), null);
  assert.equal(countryName("1"), null);
});

test("formatCountry appends the code to the name", () => {
  assert.equal(formatCountry("GB"), "United Kingdom (GB)");
  assert.equal(formatCountry("es"), "Spain (ES)");
});

test("formatCountry falls back to the bare (upper) code when name is unknown", () => {
  // A non-ISO2 token never resolves to a name → bare code, no crash.
  assert.equal(formatCountry("gbr"), "GBR");
});

test("formatCountry returns a dash for null/blank geo", () => {
  assert.equal(formatCountry(null), "—");
  assert.equal(formatCountry(""), "—");
  assert.equal(formatCountry("   "), "—");
});
