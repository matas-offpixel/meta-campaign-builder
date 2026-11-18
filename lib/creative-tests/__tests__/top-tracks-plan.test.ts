/**
 * TK11 (docs/design-record/2026-11-18-creative-lab-top-tracks.html): the
 * Top tracks test plan — the rounds' ads, the ad set's name and end, the
 * day-4 call with TF2's floors and CT7's " · narrow", and the winner as the
 * show's defaults.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_OPTIONS } from "../top-tracks/reel.ts";
import { TK11, callRound, defaultsAfterCall, nextRound, round1Base, roundTitle, roundVariants, topTracksAdSetName, topTracksEndTime } from "../top-tracks/test-plan.ts";
import { KIND_NAME, testName } from "../words.ts";

describe("TK11: the rounds", () => {
  it("round 1 is the four headlines on Spotify's top 3, everything else held", () => {
    const v = roundVariants(1, round1Base(), "Luke Dean");
    assert.deepEqual(v.map((x) => x.label), ["Top Luke Dean tracks ranked 1–3", "What’s your Luke Dean level?", "Luke Dean tracks that changed music forever", "Luke Dean tracks we can’t live without"]);
    assert.ok(v.every((x) => x.options.tracks === 3 && x.options.background === "press" && x.options.rowsAppear === "start" && x.options.end === "date"));
  });

  it("round 2 is round 1's winner at top 3, 4 and 5; round 3 is rows at start against on the drop", () => {
    const winner = { ...round1Base(), framing: "level" as const };
    assert.deepEqual(roundVariants(2, winner, "Luke Dean").map((x) => [x.label, x.options.tracks, x.options.framing]), [["Spotify's top 3", 3, "level"], ["Spotify's top 4", 4, "level"], ["Spotify's top 5", 5, "level"]]);
    assert.deepEqual(roundVariants(3, { ...winner, tracks: 4 }, "Luke Dean").map((x) => x.options.rowsAppear), ["start", "drop"]);
    assert.equal(roundTitle(2), "Round 2 · Track count");
    assert.equal(nextRound(3), null);
  });

  it("names its ad set by TT10 with the kind Top tracks, ends at 23:59 London on day 4, and goes in ACTIVE", () => {
    const nov18 = new Date("2026-11-18T12:00:00Z");
    assert.equal(topTracksAdSetName("P26-BDAY", nov18), "P26-BDAY · Tests · Top tracks · 18 Nov");
    assert.equal(topTracksAdSetName("P26-BDAY", nov18, ["P26-BDAY · Tests · Top tracks · 18 Nov"]), "P26-BDAY · Tests · Top tracks · 18 Nov · 2");
    assert.equal(topTracksEndTime(nov18), "2026-11-22T23:59:00+0000");
    assert.equal(TK11.status, "ACTIVE");
    assert.equal(testName(1, "top_tracks"), "Test 1 · Top tracks");
    assert.equal(KIND_NAME.top_tracks, "Top tracks");
  });
});

describe("TK11: the day-4 call", () => {
  const v = (id: string, spend: number, results: number) => ({ id, label: id, spend, results });

  it("waits for day 4", () => {
    assert.equal(callRound([v("a", 20, 5), v("b", 20, 1)], 72).state, "running");
  });

  it("the judged variant with the lowest cost per result wins; within 15 % of the next is narrow", () => {
    const clear = callRound([v("a", 30, 10), v("b", 30, 6), v("c", 2, 3)], 96);
    assert.equal(clear.state, "ready_to_call");
    if (clear.state === "ready_to_call") {
      assert.equal(clear.winnerId, "a");
      assert.equal(clear.narrow, false);
    }
    const narrow = callRound([v("a", 30, 10), v("b", 30, 9)], 100);
    assert.ok(narrow.state === "ready_to_call" && narrow.narrow && narrow.winnerLine === "a · narrow");
  });

  it("needs 3 results and 10 % of the spend to be judged; with none judged, no clear winner", () => {
    const tiny = callRound([v("a", 95, 2), v("b", 5, 4)], 96);
    assert.deepEqual(tiny, { state: "no_clear_winner", text: "No clear winner by day 4" });
  });

  it("the winner's settings become the show's defaults", () => {
    assert.deepEqual(defaultsAfterCall(DEFAULT_OPTIONS, { ...DEFAULT_OPTIONS, framing: "forever", tracks: 4 }), { ...DEFAULT_OPTIONS, framing: "forever", tracks: 4 });
  });
});
