import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parseDemographicSheet } from "../demographic.ts";

describe("parseDemographicSheet", () => {
  it("happy path — buckets each (age × gender) row", () => {
    const rows = [
      ["Age", "Gender", "Cost", "Impressions", "CTR (destination)"],
      ["18-24", "Male", "£250", "30,000", "1.10%"],
      ["18-24", "Female", "£200", "25,000", "1.20%"],
      ["25-34", "Female", "£150", "20,000", "0.90%"],
    ];
    const out = parseDemographicSheet(rows);
    assert.equal(out.length, 3);
    assert.equal(out[0].age_bucket, "18-24");
    assert.equal(out[0].gender, "Male");
    assert.equal(out[0].cost, 250);
    assert.equal(out[0].ctr_destination, 1.1);
    assert.equal(out[1].gender, "Female");
    assert.equal(out[2].age_bucket, "25-34");
  });

  it("coerces unknown gender to 'Unknown' and masks impressions", () => {
    const rows = [
      ["Age", "Gender", "Cost", "Impressions"],
      ["13-17", "Other", "£0.50", "<5"],
      ["", "Male", "£0", "0"], // skipped — empty age
    ];
    const out = parseDemographicSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].gender, "Unknown");
    assert.equal(out[0].impressions, null);
    assert.equal(out[0].impressions_raw, "<5");
  });

  it("returns [] when Age + Gender + Audience all missing", () => {
    assert.deepEqual(
      parseDemographicSheet([
        ["Age", "Cost"],
        ["18-24", "£1"],
      ]),
      [],
    );
  });

  it("splits combined 'Audience' cells of the form '<age> - <gender>'", () => {
    const rows = [
      ["Audience", "Cost", "Impressions", "CTR (destination)"],
      ["18-24 - Male", "£250", "30,000", "1.10%"],
      ["18-24 - Female", "£200", "25,000", "1.20%"],
      ["65+ - Female", "£40", "5,000", "0.50%"],
      ["25-34 - Other", "£10", "<5", "0.20%"],
    ];
    const out = parseDemographicSheet(rows);
    assert.equal(out.length, 4);
    assert.equal(out[0].age_bucket, "18-24");
    assert.equal(out[0].gender, "Male");
    assert.equal(out[0].cost, 250);
    assert.equal(out[1].gender, "Female");
    assert.equal(out[2].age_bucket, "65+");
    assert.equal(out[2].gender, "Female");
    assert.equal(out[3].gender, "Unknown"); // unknown variant coerces
    assert.equal(out[3].impressions, null);
    assert.equal(out[3].impressions_raw, "<5");
  });

  it("drops Audience rows that don't carry the ' - ' separator", () => {
    // Mixed export: rows that look like geo labels (no dash) should be
    // silently skipped — the geo parser handles those once detection
    // routes the file correctly.
    const rows = [
      ["Audience", "Cost"],
      ["18-24 - Male", "£10"],
      ["England", "£100"],
      ["Total", "£110"],
    ];
    const out = parseDemographicSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].age_bucket, "18-24");
    assert.equal(out[0].gender, "Male");
  });

  it("prefers Age + Gender columns when both layouts are present", () => {
    const rows = [
      ["Age", "Gender", "Audience", "Cost"],
      ["18-24", "Male", "should-be-ignored", "£10"],
    ];
    const out = parseDemographicSheet(rows);
    assert.equal(out.length, 1);
    assert.equal(out[0].age_bucket, "18-24");
    assert.equal(out[0].gender, "Male");
  });
});
