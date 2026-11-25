import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { ageWidenedLine, createdAdSetRow } from "../adset-row.ts";
import { LAUNCH_GUARD_WORDS } from "../words.ts";

/**
 * launch.adset.age_widened (#1387, ruled 25 Nov): the note on the
 * "Ad set created · Advantage+ age" row, shown only when step 2 of the
 * Advantage+ age order went out.
 */

const RULED = "Meta wouldn’t take ages {min}–{max} as a suggestion, so this ad set reaches everyone aged {control}–65+.";

describe("launch.adset.age_widened", () => {
  it("is the record list's row, word for word (curly apostrophe)", () => {
    const tsv = readFileSync(new URL("./fixtures/words-rc-2026-11-24.tsv", import.meta.url), "utf8");
    const row = tsv.split("\n").find((l) => l.startsWith("launch.adset.age_widened\t"));
    assert.ok(row, "the row is in the list");
    assert.equal(row!.split("\t")[2], RULED);
    assert.equal(LAUNCH_GUARD_WORDS["launch.adset.age_widened"], RULED);
    assert.ok(RULED.includes("’"));
  });

  it("step 1 (the suggestion went out): no line, the row stays a success", () => {
    const row = {};
    assert.equal(ageWidenedLine(row), null);
    assert.deepEqual(createdAdSetRow(row, true), { status: "success" });
  });

  it("step 2 (Meta refused the suggestion): the filled line, as a warning", () => {
    const row = { ageSuggestionDropped: "meta_refused" as const, ageWidened: { min: 18, max: 45, control: 18 } };
    assert.deepEqual(createdAdSetRow(row, true), {
      status: "warning",
      detail: "Meta wouldn’t take ages 18–45 as a suggestion, so this ad set reaches everyone aged 18–65+.",
    });
  });

  it("step 2 up front (objective): the same line; a capped control fills {control}", () => {
    const row = { ageSuggestionDropped: "objective" as const, ageWidened: { min: 30, max: 45, control: 25 } };
    assert.equal(ageWidenedLine(row), "Meta wouldn’t take ages 30–45 as a suggestion, so this ad set reaches everyone aged 25–65+.");
  });

  it("step 2 with a salvage note: the line, then the note; multi-campaign rows keep showing no note", () => {
    const row = {
      note: "Launched without 1 unavailable audience across 1 salvage pass (x).",
      ageSuggestionDropped: "meta_refused" as const,
      ageWidened: { min: 18, max: 45, control: 18 },
    };
    assert.equal(
      createdAdSetRow(row, true).detail,
      "Meta wouldn’t take ages 18–45 as a suggestion, so this ad set reaches everyone aged 18–65+. Launched without 1 unavailable audience across 1 salvage pass (x).",
    );
    assert.equal(createdAdSetRow(row, false).detail, "Meta wouldn’t take ages 18–45 as a suggestion, so this ad set reaches everyone aged 18–65+.");
  });

  it("a note alone keeps today's warning row", () => {
    assert.deepEqual(createdAdSetRow({ note: "n" }, true), { status: "warning", detail: "n" });
    assert.deepEqual(createdAdSetRow({ note: "n" }, false), { status: "success" });
  });
});
