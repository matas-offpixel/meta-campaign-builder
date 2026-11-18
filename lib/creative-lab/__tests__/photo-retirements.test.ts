import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PHOTO_RETIREMENTS, photoRetirement, retiredLine } from "../photo-retirements.ts";

describe("press photos retired for an event", () => {
  it("retires Luke Dean's 35 old press photos on P26-BDAY, ruled by Matas on 18 Nov", () => {
    const row = PHOTO_RETIREMENTS[0]!;
    assert.equal(row.assetIds.length, 35);
    assert.equal(new Set(row.assetIds).size, 35);
    for (const id of row.assetIds) assert.ok(photoRetirement("P26-BDAY", id), id);
    assert.equal(photoRetirement("P26-BDAY", "2a5fcf27-10c0-449c-b9e0-4358edf3527c")?.ruledOn, "2026-11-18");
    assert.match(retiredLine(row), /^This photo is retired for P26-BDAY \(Matas, 2026-11-18/);
  });

  it("leaves the name lockups, other events and other photos alone", () => {
    assert.equal(photoRetirement("P26-BDAY", "29c71d59-f941-4661-abf0-16c0aed844ee"), null, "LUKE_DEAN_BLK.png");
    assert.equal(photoRetirement("P26-BDAY", "e0b55973-cd37-4f47-a5bc-e38e7db95e33"), null, "LUKE_DEAN_WHT.png");
    assert.equal(photoRetirement("NX26-LOCKLEAD", "2a5fcf27-10c0-449c-b9e0-4358edf3527c"), null);
    assert.equal(photoRetirement("P26-BDAY", "00000000-0000-0000-0000-000000000000"), null);
  });
});
