import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LAUNCH_GUARD_WORDS } from "../words.ts";

/**
 * Every launch.* row and every row of the eight checks in the record's word
 * list (fixtures/words-rc-2026-11-24.tsv, a copy of
 * scratch/campaign-replicate/words-rc-2026-11-24.tsv) is in words.ts with
 * the same text, and words.ts holds nothing else.
 */
const CHECKS = [
  "pixel_not_venue",
  "account_not_venue",
  "other_show_reference",
  "name_code_mismatch",
  "artist_caption_not_approved",
  "link_not_event",
  "page_other_client",
  "venue_not_set",
];

function tsvRows(): Array<{ key: string; words: string }> {
  const text = readFileSync(new URL("./fixtures/words-rc-2026-11-24.tsv", import.meta.url), "utf8");
  const [header, ...lines] = text.split("\n").filter((line) => line.length > 0);
  assert.equal(header, "key\twhere\twords");
  return lines.map((line) => {
    const [key, , words] = line.split("\t");
    return { key: key!, words: words! };
  });
}

describe("launch-guard words", () => {
  const rows = tsvRows();
  const wanted = rows.filter((row) => row.key.startsWith("launch.") || CHECKS.includes(row.key.split(".")[0]!));

  it("the fixture is the 136-row record list", () => {
    assert.equal(rows.length, 136);
  });

  it("every launch.* and check row is in words.ts with the same text", () => {
    assert.ok(wanted.length > 0);
    for (const row of wanted) {
      assert.equal(
        (LAUNCH_GUARD_WORDS as Record<string, string>)[row.key],
        row.words,
        `words.ts ${row.key}`,
      );
    }
  });

  it("words.ts has no key the record doesn't", () => {
    assert.deepEqual(Object.keys(LAUNCH_GUARD_WORDS).sort(), wanted.map((row) => row.key).sort());
  });

  it("each of the eight checks has its key word and sentence", () => {
    for (const check of CHECKS) {
      assert.ok(check in LAUNCH_GUARD_WORDS, check);
      assert.ok(`${check}.key` in LAUNCH_GUARD_WORDS, `${check}.key`);
    }
    for (const key of ["launch.count.fix", "launch.count.check", "launch.count.clean", "launch.button.blocked"]) {
      assert.ok(key in LAUNCH_GUARD_WORDS, key);
    }
  });
});
