import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cantRunReason,
  captionCopy,
  failedCheckSentence,
  feedPostClip,
  firstPairings,
  groupClips,
  money,
  roundMatrix,
  verdictChip,
  whatsWorking,
  type ClipForGroup,
  type WorkingAd,
} from "../surface.ts";

const LUKE: ClipForGroup = {
  id: "luke-clip",
  artistName: "Luke Dean",
  clipNo: 1,
  cleared: false,
  renderError: null,
  judged: null,
};

describe("creative lab surface", () => {
  it("puts Luke Dean's uncleared clip in New, and only a refused or over-limit clip in Can't run", () => {
    const enzo: ClipForGroup = { id: "enzo-1", artistId: "enzo", artistName: "Enzo Siragusa", clipNo: 1, cleared: true, renderError: null, judged: null };
    const kept: ClipForGroup = {
      id: "enzo-2",
      artistId: "enzo",
      artistName: "Enzo Siragusa",
      clipNo: 2,
      cleared: true,
      renderError: null,
      judged: { verdict: "winner", cost: 0.42, results: 812, metric: "complete_registration", roundNo: 1 },
    };
    const refused: ClipForGroup = {
      id: "enzo-bad",
      artistId: "enzo",
      artistName: "Enzo Siragusa",
      clipNo: 5,
      cleared: true,
      renderError: "The caption does not fit the frame.",
      judged: null,
    };
    const long: ClipForGroup = { id: "long", artistId: "luke", artistName: "Luke Dean", clipNo: 3, cleared: false, renderError: null, durationSeconds: 45, judged: null };
    const groups = groupClips([kept, enzo, LUKE, refused, long]);
    assert.deepEqual(groups.keeping.map((clip) => clip.id), ["enzo-2"]);
    assert.deepEqual(groups.fresh.map((clip) => clip.id), ["enzo-1", "luke-clip"]);
    assert.deepEqual(groups.cant.map((clip) => clip.id), ["enzo-bad", "long"]);
    assert.equal(cantRunReason(LUKE), null);
    assert.equal(cantRunReason(refused), "The caption does not fit the frame.");
    assert.match(cantRunReason(long) ?? "", /45s/);
    assert.equal(feedPostClip([refused, long, LUKE, enzo], new Set(["enzo"]))?.id, "enzo-1");
    assert.equal(feedPostClip([refused, long], new Set(["enzo"])), null);
  });

  it("renders caption lines as breaks and never a slash", () => {
    const copy = captionCopy(["POV: Enzo Siragusa on one bill / 27 December at Circuit", "Tag who you're bringing"]);
    assert.match(copy, /bill\n27 December/);
    assert.match(copy, /Circuit\nTag who/);
    assert.equal(copy.includes("/"), false);
  });

  it("turns a failed check into one sentence and draws nothing when it passed", () => {
    assert.equal(failedCheckSentence(true, ["Needs an artist and a city they've played."]), null);
    assert.equal(
      failedCheckSentence(false, ["Needs an artist and a city they've played.", "A second problem."]),
      "Needs an artist and a city they've played.",
    );
  });

  it("counts the round matrix after cells are turned off", () => {
    const matrix = roundMatrix({
      clips: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
      captions: [{ id: "a" }, { id: "b" }],
      excluded: new Set(["c3:b"]),
    });
    assert.equal(matrix.cells.length, 6);
    assert.equal(matrix.on, 5);
    assert.equal(matrix.off, 1);
    assert.equal(matrix.line, "5 ads · 3 × 2, 1 left out");
    const narrow = firstPairings(matrix.cells);
    assert.equal(narrow.shown.length, 3);
    assert.equal(narrow.more, 3);
  });

  it("hides what's working until a verdict exists, then compares angles", () => {
    assert.equal(whatsWorking([], { clientName: "Puzzle", eventId: "evt" }), null);
    const quiet: WorkingAd[] = [{
      style: "lineup",
      roundId: "r1",
      eventId: "evt",
      verdict: null,
      cost: 0.4,
      results: 10,
      clipNo: 1,
      artistName: "Enzo Siragusa",
      roundNo: 1,
    }];
    assert.equal(whatsWorking(quiet, { clientName: "Puzzle", eventId: "evt" }), null);
    const ads: WorkingAd[] = [
      { style: "lineup", roundId: "r1", eventId: "evt", verdict: "winner", cost: 0.44, results: 1020, clipNo: 2, artistName: "Enzo Siragusa", roundNo: 1 },
      { style: "pov", roundId: "r1", eventId: "evt", verdict: "loser", cost: 0.64, results: 136, clipNo: 4, artistName: "Enzo Siragusa", roundNo: 1 },
    ];
    const working = whatsWorking(ads, { clientName: "Puzzle", eventId: "evt" });
    assert.equal(working?.angle, "Lineup captions beat POV by 31% on Puzzle");
    assert.equal(working?.clip, "Enzo Siragusa clip #2 is the current winner");
  });

  it("maps stored verdicts onto the chips", () => {
    assert.equal(verdictChip("winner").label, "Winner");
    assert.equal(verdictChip("loser").label, "Loser");
    assert.equal(verdictChip("flagged").label, "cost 1.5× the usual");
    assert.equal(verdictChip(null).label, "Holding");
    assert.equal(verdictChip("thin").label, "Untested");
    assert.equal(verdictChip("untested").label, "Untested");
    assert.equal(money(null), "—");
    assert.equal(money(0), "—");
    assert.equal(money(0.42), "£0.42");
  });
});
