import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  nextDuplicateName,
  parseTrailingNumber,
} from "../duplicate-name.ts";

describe("nextDuplicateName — artist / asset / number convention", () => {
  it('"DJ EZ - Artwork Motion 1" → "DJ EZ - Artwork Motion 2"', () => {
    assert.equal(
      nextDuplicateName("DJ EZ - Artwork Motion 1", [
        "DJ EZ - Artwork Motion 1",
      ]),
      "DJ EZ - Artwork Motion 2",
    );
  });

  it("with 1 and 2 present → … Motion 3", () => {
    assert.equal(
      nextDuplicateName("DJ EZ - Artwork Motion 1", [
        "DJ EZ - Artwork Motion 1",
        "DJ EZ - Artwork Motion 2",
      ]),
      "DJ EZ - Artwork Motion 3",
    );
  });

  it('"DJ EZ - Artwork Motion" (no trailing number) → "… Motion 2"', () => {
    assert.equal(
      nextDuplicateName("DJ EZ - Artwork Motion", ["DJ EZ - Artwork Motion"]),
      "DJ EZ - Artwork Motion 2",
    );
  });

  it("duplicating a duplicate does not produce '2 2' or '2 (copy)'", () => {
    const once = nextDuplicateName("DJ EZ - Artwork Motion 1", [
      "DJ EZ - Artwork Motion 1",
    ]);
    assert.equal(once, "DJ EZ - Artwork Motion 2");
    const twice = nextDuplicateName(once, [
      "DJ EZ - Artwork Motion 1",
      once,
    ]);
    assert.equal(twice, "DJ EZ - Artwork Motion 3");
    assert.doesNotMatch(twice, /2 2/);
    assert.doesNotMatch(twice, /\(copy\)/);
  });
});

describe("nextDuplicateName — separator and spacing preserved verbatim", () => {
  it("keeps a single space before the number", () => {
    assert.equal(nextDuplicateName("Motion 1", ["Motion 1"]), "Motion 2");
  });

  it("keeps double spaces", () => {
    assert.equal(nextDuplicateName("Motion  1", ["Motion  1"]), "Motion  2");
  });

  it("does not rewrite a hyphenated number into a space", () => {
    assert.equal(nextDuplicateName("Motion-1", ["Motion-1"]), "Motion-2");
  });

  it("does not rewrite a spaced number into a hyphen", () => {
    assert.equal(nextDuplicateName("Motion 1", ["Motion 1"]), "Motion 2");
    assert.notEqual(nextDuplicateName("Motion 1", ["Motion 1"]), "Motion-2");
  });

  it("does not touch artist / type segments", () => {
    assert.equal(
      nextDuplicateName("DJ EZ - Artwork Motion 1", ["DJ EZ - Artwork Motion 1"]),
      "DJ EZ - Artwork Motion 2",
    );
  });
});

describe("nextDuplicateName — next unused, not simply +1", () => {
  it("fills a gap after the source when a later number is taken", () => {
    // 1 and 3 exist; duplicating 1 should land on unused 2, not skip to 4.
    assert.equal(
      nextDuplicateName("Motion 1", ["Motion 1", "Motion 3"]),
      "Motion 2",
    );
  });

  it("skips a taken +1", () => {
    assert.equal(
      nextDuplicateName("Motion 1", ["Motion 1", "Motion 2", "Motion 4"]),
      "Motion 3",
    );
  });

  it("no-number source skips an existing ' 2'", () => {
    assert.equal(
      nextDuplicateName("Motion", ["Motion", "Motion 2"]),
      "Motion 3",
    );
  });
});

describe("nextDuplicateName — non-counter trailing numbers (years)", () => {
  it("increments years too; no silent year-window heuristic", () => {
    // Deliberate: "Ibiza 2026" → "Ibiza 2027". Wrong-but-editable beats a
    // magnitude cutoff that would one day refuse a real counter.
    assert.equal(
      nextDuplicateName("Ibiza 2026", ["Ibiza 2026"]),
      "Ibiza 2027",
    );
  });
});

describe("parseTrailingNumber", () => {
  it("returns null when there is no trailing number", () => {
    assert.equal(parseTrailingNumber("DJ EZ - Artwork Motion"), null);
  });

  it("captures prefix, separator, and number", () => {
    assert.deepEqual(parseTrailingNumber("DJ EZ - Artwork Motion 1"), {
      prefix: "DJ EZ - Artwork Motion",
      separator: " ",
      number: 1,
    });
  });
});
