import assert from "node:assert/strict";
import { test } from "node:test";

import { MONTAGE_VARIANTS, RATIOS, buildRenderFileName, nameBreakParts, parseRenderFileName, rowMeta } from "../file-name.ts";
import { badgeLine, fileRights, montageOwner, ownerLabel } from "../rights.ts";
import { fileNameFor } from "../store.ts";
import { PUZZLE } from "./fixtures.ts";

const promoter = montageOwner([{ owner: "promoter", artistName: null }, { owner: "artist", artistName: "Enzo Siragusa" }], { name: "Puzzle" }, "Enzo Siragusa");
const artistOnly = montageOwner([{ owner: "artist", artistName: "Enzo Siragusa" }, { owner: "artist", artistName: "Enzo Siragusa" }], { name: "Puzzle" }, "Enzo Siragusa");

test("the file name for every version × ratio × owner, as the 25 Nov convention writes it, and read back", () => {
  const want: Record<string, string> = {};
  for (const owner of [promoter, artistOnly]) {
    for (const variant of MONTAGE_VARIANTS) {
      for (const ratio of RATIOS) {
        for (const stage of ["signup", "presale", "on_sale"] as const) {
          const name = fileNameFor({ eventCode: "P26-BDAY", owner, recipe: "montage", variant, stage, round: 1, ratio });
          const parsed = parseRenderFileName(name)!;
          assert.equal(buildRenderFileName(parsed), name);
          want[`${owner.kind}/${variant}/${ratio}/${stage}`] = name;
        }
      }
    }
  }
  assert.equal(Object.keys(want).length, 54);
  assert.equal(want["promoter/teaser/9:16/on_sale"], "P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16.mp4");
  assert.equal(want["promoter/announcement/4:5/on_sale"], "P26-BDAY__promoter-puzzle__montage__announcement__tickets__r1__4x5.mp4");
  assert.equal(want["promoter/no-text/1:1/on_sale"], "P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r1__1x1.mp4");
  assert.equal(want["offpixel/no-text/9:16/signup"], "P26-BDAY__offpixel__montage__no-text__no-cta__r1__9x16.mp4");
  assert.equal(want["offpixel/teaser/1:1/signup"], "P26-BDAY__offpixel__montage__teaser__signup__r1__1x1.mp4");
  assert.equal(want["offpixel/announcement/9:16/presale"], "P26-BDAY__offpixel__montage__announcement__presale__r1__9x16.mp4");
  // The spec's example reads back, artist owner and all.
  assert.deepEqual(parseRenderFileName("ES27-ENZOSIRAGUSA__artist-enzo-siragusa__roll-call__raw-2__signup__r1__9x16.mp4")?.owner, { kind: "artist", slug: "enzo-siragusa" });
  assert.equal(parseRenderFileName("P26-BDAY_enzo-siragusa-2_t1-roll-call_12pm-thursday_9x16.mp4"), null, "the older name isn't read as this one");
});

test("RT2's row line and line breaks come from the name", () => {
  assert.equal(rowMeta("P26-BDAY__promoter-puzzle__montage__teaser__tickets__r1__9x16.mp4"), "Montage (15 s) · Teaser · tickets · 9:16 · round 1");
  assert.equal(rowMeta("P26-BDAY__promoter-puzzle__montage__no-text__no-cta__r2__4x5.mp4"), "Montage (15 s) · No text · No CTA · 4:5 · round 2");
  assert.deepEqual(nameBreakParts("P26-BDAY__offpixel__montage__no-text__no-cta__r1__1x1.mp4"), ["P26-BDAY__", "offpixel__", "montage__", "no-text__", "no-cta__", "r1__", "1x1.mp4"]);
});

test("rights per file: a mixed promoter / artist package is This client only on every file (Filmed by Puzzle)", () => {
  assert.equal(promoter.kind, "promoter");
  assert.equal(ownerLabel(promoter), "Puzzle");
  for (const hasText of [false, true]) {
    const r = fileRights(promoter, hasText, PUZZLE);
    assert.equal(r.shareable, false);
    assert.deepEqual(badgeLine(r, "Puzzle"), { badge: "This client only · Puzzle", why: "Filmed by Puzzle" });
  }
});

test("rights per file: artist material only — No text is Shareable, every version with text stays with the client", () => {
  assert.equal(artistOnly.kind, "offpixel");
  assert.equal(ownerLabel(artistOnly), "Off/Pixel, from Enzo Siragusa’s material");
  assert.deepEqual(badgeLine(fileRights(artistOnly, false, PUZZLE), "Puzzle"), { badge: "Shareable", why: null });
  assert.deepEqual(badgeLine(fileRights(artistOnly, true, PUZZLE), "Puzzle"), { badge: "This client only · Puzzle", why: "Has Puzzle’s branding or artwork" });
  assert.equal(ownerLabel(null), "Set by the clips you pick");
});
