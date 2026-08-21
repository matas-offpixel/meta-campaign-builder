import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  tikTokAgeWideningNote,
  tikTokGenderWideningNote,
  tikTokTargetingWideningNotes,
} from "../targeting-warnings.ts";
import { mapTikTokGender } from "../../tiktok/write/mapping.ts";
import { defaultTikTokAudiences } from "../../types/tiktok-draft.ts";

describe("tikTokGenderWideningNote", () => {
  const collapsing: Array<Array<"MALE" | "FEMALE" | "UNKNOWN">> = [
    ["UNKNOWN"],
    ["MALE", "FEMALE"],
    ["MALE", "UNKNOWN"],
    ["FEMALE", "UNKNOWN"],
    ["MALE", "FEMALE", "UNKNOWN"],
  ];

  for (const genders of collapsing) {
    it(`warns for ${genders.join(" + ")}`, () => {
      const mapped = mapTikTokGender(genders);
      assert.equal(mapped.ok && mapped.value, "GENDER_UNLIMITED");
      const note = tikTokGenderWideningNote(genders);
      assert.ok(note, `expected a note for ${genders.join(" + ")}`);
      assert.ok(note?.includes("GENDER_UNLIMITED"));
    });
  }

  it("names the exact selection so the operator reads what is sent", () => {
    assert.equal(
      tikTokGenderWideningNote(["FEMALE", "UNKNOWN"])?.startsWith(
        "Female + Unknown ships as unlimited gender (GENDER_UNLIMITED)",
      ),
      true,
    );
  });

  it("stays quiet for a single targetable gender and for no selection", () => {
    assert.equal(tikTokGenderWideningNote(["MALE"]), null);
    assert.equal(tikTokGenderWideningNote(["FEMALE"]), null);
    assert.equal(tikTokGenderWideningNote([]), null);
  });

  it("does not warn twice for a duplicated chip", () => {
    assert.equal(tikTokGenderWideningNote(["MALE", "MALE"]), null);
  });
});

describe("tikTokAgeWideningNote", () => {
  it("says 18-65 ships as 18-100 and names AGE_55_100", () => {
    const defaults = defaultTikTokAudiences();
    const note = tikTokAgeWideningNote(defaults.ageMin, defaults.ageMax);
    assert.ok(note);
    assert.ok(note?.includes("Age 18–65 ships as 18–100"));
    assert.ok(note?.includes("AGE_55_100"));
  });

  it("warns whenever the bucket edges are wider than the chosen range", () => {
    const note = tikTokAgeWideningNote(20, 30);
    assert.ok(note?.includes("ships as 18–34"));
  });

  it("stays quiet when the range lands exactly on bucket edges", () => {
    assert.equal(tikTokAgeWideningNote(18, 24), null);
    assert.equal(tikTokAgeWideningNote(25, 54), null);
  });

  it("stays quiet when the range cannot be mapped", () => {
    assert.equal(tikTokAgeWideningNote(70, 40), null);
  });
});

describe("tikTokTargetingWideningNotes", () => {
  it("collects the age and gender notes for the default audience", () => {
    const audiences = defaultTikTokAudiences();
    audiences.genders = ["FEMALE", "UNKNOWN"];
    const notes = tikTokTargetingWideningNotes(audiences);
    assert.equal(notes.length, 2);
    assert.ok(notes[0].includes("Age"));
    assert.ok(notes[1].includes("Female + Unknown"));
  });

  it("is empty when nothing widens", () => {
    const audiences = defaultTikTokAudiences();
    audiences.ageMin = 18;
    audiences.ageMax = 24;
    audiences.genders = ["FEMALE"];
    assert.deepEqual(tikTokTargetingWideningNotes(audiences), []);
  });
});
