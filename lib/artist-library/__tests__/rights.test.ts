import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { badgeWords, captionRights, clientAdRights, clipRights, libraryDropRights, renderRights, rightsProblem, usableOn } from "../rights.ts";

const PUZZLE = "c-puzzle";
const ELECTRIC = "c-electric";

describe("rights (AL1; Matas, 25 Nov)", () => {
  it("promoter footage is never shareable", () => {
    const r = clipRights("promoter", PUZZLE);
    assert.deepEqual(r, { ownerKind: "promoter", shareable: false, heldReason: "filmed", clientId: PUZZLE });
    assert.equal(clipRights(null, PUZZLE).shareable, false, "a clip with no owner is not assumed to be the artist's");
    assert.equal(rightsProblem({ ownerKind: "promoter", shareable: true, heldReason: null, clientId: PUZZLE }), "promoter material can't be shareable");
  });

  it("a render is shareable only when every clip in it is artist-owned", () => {
    assert.equal(renderRights(["artist", "artist"], PUZZLE).shareable, true);
    const mixed = renderRights(["artist", "promoter"], PUZZLE);
    assert.deepEqual(mixed, { ownerKind: "offpixel", shareable: false, heldReason: "footage", clientId: PUZZLE });
    assert.equal(renderRights(["artist", null], PUZZLE).shareable, false, "an unknown owner keeps it with the client");
    assert.equal(renderRights([], PUZZLE).shareable, false, "a render with no known clip isn't shareable");
  });

  it("a client's own ad stays with the client; a library drop is the artist's", () => {
    assert.equal(clientAdRights("static", ELECTRIC).heldReason, "branding");
    assert.equal(clientAdRights("clip", ELECTRIC).heldReason, "filmed");
    assert.equal(libraryDropRights().shareable, true);
    assert.equal(captionRights(true, PUZZLE).heldReason, "names");
    assert.equal(captionRights(false, PUZZLE).shareable, true);
  });

  it("another client's held file is never usable; the owner's own is", () => {
    const puzzleClip = clipRights("promoter", PUZZLE);
    assert.equal(usableOn(puzzleClip, ELECTRIC), false);
    assert.equal(usableOn(puzzleClip, null), false, "no event: shareable only");
    assert.equal(usableOn(puzzleClip, PUZZLE), true);
    assert.equal(usableOn(renderRights(["artist"], PUZZLE), ELECTRIC), true);
  });

  it("the badge and its reason, operator and client words", () => {
    assert.deepEqual(badgeWords(renderRights(["artist", "promoter"], PUZZLE), "Puzzle"), { badge: "This client only · Puzzle", why: "Uses Puzzle’s footage" });
    assert.deepEqual(badgeWords(clipRights("promoter", ELECTRIC), "Electric Brixton"), { badge: "This client only · Electric Brixton", why: "Filmed by Electric Brixton" });
    assert.deepEqual(badgeWords(clipRights("artist", PUZZLE), "Puzzle"), { badge: "Shareable", why: null });
    assert.deepEqual(badgeWords(clipRights("promoter", PUZZLE), "Puzzle", "client"), { badge: "This client only", why: "Filmed by the promoter" });
  });

  it("migration 269's CHECKs say the same", () => {
    const sql = readFileSync(new URL("../../../supabase/migrations/269_artist_assets.sql", import.meta.url), "utf8");
    assert.match(sql, /check \(not \(owner_kind = 'promoter' and shareable\)\)/);
    assert.match(sql, /check \(shareable = \(held_reason is null\)\)/);
    assert.match(sql, /check \(shareable or source_client_id is not null\)/);
  });
});
