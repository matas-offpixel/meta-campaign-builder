import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assignOwner,
  captionAllowsClip,
  clipsForStyle,
  emptyFootage,
  featuringLine,
  nextFootageLine,
  objectPronoun,
  ownerFromImport,
  pairingsForClip,
  planUnpair,
  promoterTileLabel,
  quoteChannels,
  quotePairsLine,
  unpairedLine,
} from "../footage-owner.ts";

const luke = "luke";
const enzo = "enzo";

describe("footage owner", () => {
  it("derives the owner from the path a clip arrived on", () => {
    assert.deepEqual(ownerFromImport({ kind: "instagram", handle: "@puzzle", clientHandle: "puzzle", artistId: luke }), { owner: "promoter", artistId: null });
    assert.deepEqual(ownerFromImport({ kind: "instagram", handle: "lukedean", clientHandle: "puzzle", artistId: luke }), { owner: "artist", artistId: luke });
    assert.deepEqual(ownerFromImport({ kind: "artist_clips", artistId: luke }), { owner: "artist", artistId: luke });
    assert.deepEqual(ownerFromImport({ kind: "press_kit", artistId: enzo }), { owner: "artist", artistId: enzo });
    assert.deepEqual(ownerFromImport({ kind: "artist_folder", artistId: luke }), { owner: "artist", artistId: luke });
    assert.deepEqual(ownerFromImport({ kind: "venue_crowd" }), { owner: "promoter", artistId: null });
    assert.deepEqual(ownerFromImport({ kind: "upload", folderKey: "02/venue-crowd", artistId: luke }), { owner: "promoter", artistId: null });
    assert.deepEqual(ownerFromImport({ kind: "upload", folderKey: "02/artist-clips/luke", artistId: luke }), { owner: "artist", artistId: luke });
  });

  it("a hand correction leaves the rights ref and the rights chip", () => {
    const next = assignOwner(
      { rightsRef: "Instagram @lukedean, own feed", rightsChip: "✓ Cleared — artist channels too" },
      { owner: "promoter", artistId: null },
      "matas",
      "2026-11-10T12:00:00Z",
    );
    assert.equal(next.owner, "promoter");
    assert.equal(next.artistId, null);
    assert.equal(next.ownerSetBy, "matas");
    assert.equal(next.ownerSetAt, "2026-11-10T12:00:00Z");
    assert.equal(next.rightsRef, "Instagram @lukedean, own feed");
    assert.equal(next.rightsChip, "✓ Cleared — artist channels too");
  });

  it("never pairs Lineup with an artist clip, or a Luke caption or quote with an Enzo clip", () => {
    const enzoClip = { id: "enzo-1", owner: "artist" as const, artistId: enzo, featuredArtistIds: [] };
    const lukeClip = { id: "luke-1", owner: "artist" as const, artistId: luke, featuredArtistIds: [] };
    const lineup = { id: "line", style: "lineup", artistId: null, status: "proposed" };
    const lukeCaption = { id: "luke-cap", style: "artist", artistId: luke, status: "proposed" };
    const lukeQuote = { id: "luke-quote", style: "quote", mode: "quote", artistId: luke, status: "approved" };
    assert.equal(captionAllowsClip(lineup, enzoClip), false);
    assert.equal(captionAllowsClip(lukeCaption, enzoClip), false);
    assert.equal(captionAllowsClip(lukeQuote, enzoClip), false);
    assert.equal(captionAllowsClip(lukeCaption, lukeClip), true);
    assert.equal(captionAllowsClip(lukeQuote, lukeClip), true);
    for (const mode of ["spread", "best", "each"] as const) {
      assert.equal(mode === "spread" || mode === "best" || mode === "each", true);
      assert.deepEqual(clipsForStyle("lineup", null, [enzoClip, lukeClip]).map((clip) => clip.id), []);
    }
    assert.equal(captionAllowsClip({ id: "old", style: "artist_first_person", status: "approved" }, lukeClip), false);
  });

  it("a Puzzle clip that features Luke pairs with Lineup, Luke's Artist caption and his quote, never Enzo's", () => {
    const clip = {
      id: "puzzle-3",
      owner: "promoter" as const,
      artistId: null,
      featuredArtistIds: [luke],
      channels: ["promoter"],
      rightsRef: "Venue & crowd",
    };
    const captions = [
      { id: "line", style: "lineup", artistId: null, status: "approved", channels: ["promoter"] },
      { id: "luke", style: "artist", artistId: luke, status: "approved", channels: ["promoter", "artist"] },
      { id: "quote", style: "quote", mode: "quote", artistId: luke, status: "approved", channels: null, rights: "artist_too" as const },
      { id: "enzo", style: "artist", artistId: enzo, status: "approved", channels: ["promoter", "artist"] },
      { id: "enzo-quote", style: "quote", mode: "quote", artistId: enzo, status: "approved", channels: null, rights: "artist_too" as const },
    ];
    const pairs = pairingsForClip(clip, captions);
    assert.deepEqual(pairs.map((row) => row.captionId), ["line", "luke", "quote"]);
    assert.deepEqual(pairs.map((row) => row.round), ["promoter", "artist", "artist"]);
    assert.deepEqual(pairs.filter((row) => row.round === "artist").map((row) => row.artistId), [luke, luke]);
    assert.equal(pairs.every((row) => row.channels.length === 1 && row.channels[0] === "promoter"), true);
    assert.equal(clip.rightsRef, "Venue & crowd");
    assert.equal(quoteChannels(null, "artist_too").join(","), "promoter,artist");
    assert.equal(pairs.filter((row) => row.captionId === "line").length, 1);
    assert.equal(pairs.filter((row) => row.captionId === "luke").length, 1);
  });

  it("writes the empty state, the unpaired line, the quote line and the strip", () => {
    const empty = emptyFootage("Puzzle", "puzzle");
    assert.equal(empty.sentence, "No Puzzle footage yet. Lineup, POV and Scarcity need it.");
    assert.equal(empty.action, "Find clips on @puzzle");
    assert.equal(emptyFootage("Puzzle", null).action, "Add Puzzle's Instagram");
    assert.equal(unpairedLine("Lineup", "Puzzle"), "Unpaired — Lineup needs Puzzle footage.");
    assert.equal(nextFootageLine("Puzzle", 20), "Add Puzzle footage — 20 Lineup captions are waiting for it.");
    assert.equal(quotePairsLine("Luke Dean", "Puzzle", "him", 0), "pairs with Luke Dean's clips only");
    assert.equal(quotePairsLine("Luke Dean", "Puzzle", objectPronoun("he/him"), 1), "pairs with Luke Dean's clips and Puzzle clips that feature him");
    assert.equal(featuringLine(1, "Puzzle", "Luke Dean"), "and 1 Puzzle clip that feature Luke Dean");
    assert.equal(featuringLine(2, "Puzzle", "Luke Dean"), "and 2 Puzzle clips that feature Luke Dean");
    assert.equal(promoterTileLabel("Puzzle", 3, ["Luke Dean"]), "Puzzle #3 · Luke Dean");
  });

  it("plans the Puzzle unpair and retires generated first person without deleting", () => {
    const lineup = (id: string, event: string) => ({
      id,
      eventName: event,
      style: "lineup",
      status: "proposed",
      mode: "caption",
      artistId: null,
      clipId: `clip-${id}`,
      clipOwner: "artist" as const,
      clipArtistId: enzo,
      featuredArtistIds: [],
    });
    const plan = planUnpair([
      ...Array.from({ length: 11 }, (_, index) => lineup(`p${index}`, "Puzzle 4th Birthday")),
      lineup("other", "Somewhere else"),
      {
        id: "fp",
        eventName: "Puzzle 4th Birthday",
        style: "artist_first_person",
        status: "proposed",
        generatedBy: "claude-opus-4-6",
        mode: "caption",
        artistId: luke,
        clipId: "clip-fp",
        clipOwner: "artist",
        clipArtistId: luke,
        featuredArtistIds: [],
      },
    ]);
    assert.equal(plan.retireIds.join(","), "fp");
    assert.equal(plan.unpairIds.includes("other"), true);
    assert.equal(plan.puzzleLineup, 11);
  });
});
