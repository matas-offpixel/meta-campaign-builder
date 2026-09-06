import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { venueKey } from "../venue-key.ts";

describe("venueKey — audit §6 item 1", () => {
  it("collapses the 4theFans triples that already have spend", () => {
    const triples: Array<{ spellings: string[]; spend: number }> = [
      { spellings: ["Utilita Arena", "Utilita Arena Birmingham"], spend: 1 },
      {
        spellings: ["O2 Academy", "O2 Academy Glasgow", "O2 Academy Leeds", "O2 Academy Islington"],
        spend: 1,
      },
      { spellings: ["Prospect Building", "The Prospect Building"], spend: 1 },
    ];
    for (const group of triples) {
      assert.ok(group.spend > 0, "fixture must carry spend — empty spellings are not the finding");
      const keys = group.spellings.map((name) => venueKey(name));
      assert.equal(
        new Set(keys).size,
        1,
        `duplicate spelling with spend split the ladder: ${group.spellings.join(" / ")} → ${keys.join(" / ")}`,
      );
    }
  });

  it("does not invent a key from a blank name", () => {
    assert.equal(venueKey(null), null);
    assert.equal(venueKey("   "), null);
  });
});
