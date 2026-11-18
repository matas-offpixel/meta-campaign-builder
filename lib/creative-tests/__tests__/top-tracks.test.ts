/**
 * Top tracks (docs/design-record/2026-11-18-creative-lab-top-tracks.html, and
 * issue 2, 2026-11-18-creative-lab-top-tracks-2.html): HK8's and HK13's unit
 * tests. TK13's grid, TK14's drops on synthetic stems, TK15's choice, TK3's
 * window on the grid's bars, TK16's hook, TK17's snippet static; the reel's
 * timeline against the acceptance numbers; TK2's headlines; TK4's order and
 * states; TK5's row; the fit refusals; TK7's head test; TK2's Drive-only
 * refusal. Can't Decide's real-file acceptance is the todo at the end.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { BAR_S, FIXTURE_SNIPPETS_3, FIXTURE_SNIPPETS_5, FIXTURE_TRACKS, fixtureAnalysis, fixtureFeatures } from "../../../scripts/plan-frames/top-tracks-fixtures.ts";
import {
  NO_PHRASE,
  NO_STEADY_BEAT,
  chooseDrop,
  dropRowText,
  findHook,
  hookFromPhrase,
  isWindow,
  mmss,
  planTrack,
  snippetWindow,
  uniformDownbeats,
  type StudioGrid,
} from "../top-tracks/audio-rules.ts";
import { BEAT_UNREAD, dropPickerLine, findBassDrops, referenceLevel, snapToDownbeat, studioGrid, type StudioAnalysis } from "../top-tracks/studio.ts";
import { joinArgs, loudnessOk } from "../top-tracks/ffmpeg.ts";
import { headOnTarget, judgeContrast, placeStill, textClearOfHead, type Rect } from "../top-tracks/layout.ts";
import {
  DEFAULT_OPTIONS,
  canTick,
  endState,
  headline,
  isLayout,
  kitCase,
  layoutReel,
  narrowChip,
  playOrder,
  reelTimeline,
  rowForPlay,
  rowMarkers,
  rowState,
  rungs,
  titleTooLong,
  topTracksFileName,
  withLine,
  wrap,
} from "../top-tracks/reel.ts";

const T1 = FIXTURE_TRACKS[0]!;
const T3 = FIXTURE_TRACKS[2]!;
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (± ${tol})`);
const grid = (first: number, bar: number, dur: number): StudioGrid => ({ steady: true, downbeats: uniformDownbeats(first, bar, dur), barS: bar });

/** A synthetic studio track: 4/4 at `bpm`, the bass at `levelAt(beat time)`. */
function synth(durationS: number, levelAt: (t: number, i: number) => number, bpm = 124): StudioAnalysis {
  const beat = 60 / bpm;
  const beats: number[] = [];
  for (let t = 0.5; t < durationS; t += beat) beats.push(Math.round(t * 1000) / 1000);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  return { durationS, beats, downbeats, bassBeatDb: beats.map((t, i) => levelAt(t, i)) };
}

describe("TK13: the grid", () => {
  it("bars run downbeat to downbeat; steady within ±3 % over the 16 bars around the drop", () => {
    const a = fixtureAnalysis(T1);
    const g = studioGrid(a.downbeats, 144);
    assert.equal(g.steady, true);
    if (g.steady) near(g.barS, BAR_S, 1e-6);
  });

  it("an unsteady grid cuts on seconds, with its line", () => {
    const db = uniformDownbeats(0, BAR_S, 200).map((d, i) => d + (i % 2 ? 0.2 : 0));
    const g = studioGrid(db, 100);
    assert.equal(g.steady, false);
    const w = snippetWindow({ dropS: 100, durationS: 200, grid: g });
    assert.ok(isWindow(w));
    assert.equal(w.cut, "seconds");
    assert.equal(w.startS, 94);
    assert.equal(w.endS, 108);
  });

  it("no downbeats at all: no grid, the seconds cut", () => {
    assert.deepEqual(studioGrid([], 50), { steady: false, reason: "no_grid", spread: null });
  });
});

describe("TK14: drops on the bass stem", () => {
  it("R is the median of the loudest half of the beats", () => {
    assert.equal(referenceLevel([-10, -12, -40, -60, -11, -70]), -11);
  });

  it("finds a break and the return after it, at the downbeat, with the picker's words", () => {
    const a = synth(120, (t) => (t >= 40 && t < 48 ? -70 : -10));
    const r = findBassDrops(a);
    assert.equal(r.drops.length, 1);
    const d = r.drops[0]!;
    assert.ok(a.downbeats.includes(d.tS));
    near(d.tS, 48, BAR_S / 2);
    assert.match(dropPickerLine(d), /^0:4\d\.\d · bass returns after \d bars?$/);
    assert.equal(dropPickerLine({ tS: 127.28, breakBars: 1 }), "2:07.2 · bass returns after 1 bar");
  });

  it("a blip that falls away again fails the 8-beat test", () => {
    const a = synth(120, (t) => (t >= 40 && t < 48 ? -70 : t >= 48 && t < 49.5 ? -10 : t >= 49.5 && t < 60 ? -70 : -10));
    const drops = findBassDrops(a).drops.map((d) => d.tS);
    assert.ok(drops.every((t) => t > 55), `no drop at 48: ${drops}`);
  });

  it("two returns under 4 bars apart are one drop, timed at the first that passes its 8-beat test", () => {
    const bar = 4 * (60 / 124);
    // A break to 48, the bass back for a bar (that return fails its 8 beats), out again for 1.5 bars, then back for good.
    const a = synth(120, (t) => ((t >= 40 && t < 48) || (t >= 48 + bar && t < 48 + 2.5 * bar) ? -70 : -10));
    const r = findBassDrops(a);
    assert.equal(r.drops.length, 1);
    near(r.drops[0]!.tS, 48 + 2.5 * bar, bar / 2);
  });

  it("a track that starts with the bass out: the intro's bass entry is a drop", () => {
    const a = synth(120, (t) => (t < 16 ? -70 : -10));
    const r = findBassDrops(a);
    assert.equal(r.drops.length, 1);
    near(r.drops[0]!.tS, 16, BAR_S / 2);
  });

  it("a half-bar dip isn't a break", () => {
    const a = synth(120, (t) => (t >= 40 && t < 41 ? -70 : -10));
    assert.deepEqual(findBassDrops(a).drops, []);
  });

  it("a dragged marker snaps to the nearest downbeat", () => {
    assert.equal(snapToDownbeat(10.4, [8, 10, 12]), 10);
  });
});

describe("TK3 on the grid: the window", () => {
  const steady = grid(144 - 74 * BAR_S, BAR_S, 192);

  it("no hook: the bars nearest 6 s before (3 bars, 5.8 s) and 8 s after (4 bars, 7.7 s) at 124 BPM", () => {
    const w = snippetWindow({ dropS: 144, durationS: 192, grid: steady });
    assert.ok(isWindow(w));
    near(w.startS, 144 - 3 * BAR_S);
    near(w.lengthS, 13.548);
    assert.equal(w.barsBefore, 3);
    assert.equal(w.barsAfter, 4);
  });

  it("a hook 5 bars back starts the window at its bar: 17.4 s", () => {
    const w = snippetWindow({ dropS: 144, durationS: 192, grid: steady, hookS: 144 - 5 * BAR_S });
    assert.ok(isWindow(w));
    assert.equal(w.barsBefore, 5);
    assert.equal(w.fromHook, true);
    near(w.lengthS, 17.419);
  });

  it("a hook never shortens the lead-up", () => {
    const w = snippetWindow({ dropS: 144, durationS: 192, grid: steady, hookS: 144 - 1 * BAR_S });
    assert.ok(isWindow(w));
    assert.equal(w.barsBefore, 3);
    assert.equal(w.fromHook, false);
  });

  it("under 10 s can't happen on the grid: the 4 s and 6 s floors make every window at least 10 s", () => {
    for (let bpm = 80; bpm <= 180; bpm += 3) {
      const bar = (4 * 60) / bpm;
      for (const room of [6, 7, 8, 9, 12, 30]) {
        const w = snippetWindow({ dropS: 40, durationS: 40 + room, grid: grid(40 - 20 * bar, bar, 40 + room) });
        if (isWindow(w)) assert.ok(w.lengthS >= 10 - 1e-6, `${bpm} BPM, ${room} s room: ${w.lengthS}`);
      }
    }
  });

  it("over 20 s: the end comes in to its 6 s floor in bars, then refuses", () => {
    const bar = 1.7;
    const g = grid(100 - 50 * bar, bar, 200);
    const ok = snippetWindow({ dropS: 100, durationS: 200, grid: g, hookS: 100 - 7 * bar });
    assert.ok(isWindow(ok));
    assert.equal(ok.barsAfter, 4);
    near(ok.lengthS, 18.7);
    assert.deepEqual(snippetWindow({ dropS: 100, durationS: 200, grid: g, hookS: 100 - 9 * bar }), { refused: "over_20" });
  });
});

describe("TK15: which drop", () => {
  it("the last of three, in the last third (track one: 2:24)", () => {
    const a = fixtureAnalysis(T1);
    const drops = findBassDrops(a).drops.map((d) => d.tS);
    assert.equal(drops.length, 3);
    const c = chooseDrop({ drops, durationS: T1.durationS, downbeats: a.downbeats });
    assert.ok("dropS" in c && c.kind === "last");
    near((c as { dropS: number }).dropS, 144, 1e-3);
    assert.equal(dropRowText(c as never), "Drop 2:24 · the last drop");
  });

  it("a last-third drop without room after it falls back to the one before", () => {
    const a = fixtureAnalysis(T1);
    const c = chooseDrop({ drops: [...T1.drops, 189], durationS: T1.durationS, downbeats: a.downbeats });
    assert.ok("dropS" in c && c.kind === "last" && Math.abs(c.dropS - 144) < 1e-3);
  });

  it("no drop in the last third: the latest earlier one (track three: 1:46)", () => {
    const a = fixtureAnalysis(T3);
    const c = chooseDrop({ drops: findBassDrops(a).drops.map((d) => d.tS), durationS: T3.durationS, downbeats: a.downbeats });
    assert.equal(c.kind, "earlier");
    assert.equal(dropRowText(c as never), "Drop 1:46 · an earlier drop (no later drop fits)");
  });

  it("none fitting: the room line; none found: the no-drop line; a failed analysis: TK18's line", () => {
    const a = fixtureAnalysis(T3);
    const tooLate = planTrack({ title: "Track three", features: fixtureFeatures(T3), analysis: { ...a, bassBeatDb: a.beats.map((b) => (b > 175 && b < 182 ? -70 : -10)) } });
    assert.equal(tooLate.ok, false);
    if (!tooLate.ok) assert.equal(tooLate.refusal, "Track three: the drop is too close to the end of the file — move the marker or pick another track.");
    const none = planTrack({ title: "Track two", features: fixtureFeatures(FIXTURE_TRACKS[1]!), analysis: { ...fixtureAnalysis(FIXTURE_TRACKS[1]!), bassBeatDb: fixtureAnalysis(FIXTURE_TRACKS[1]!).beats.map(() => -10) } });
    assert.equal(none.ok, false);
    if (!none.ok) assert.equal(none.refusal, "Track two: no drop found — drag the drop marker to it.");
    const failed = planTrack({ title: "Track two", features: fixtureFeatures(FIXTURE_TRACKS[1]!), analysis: null });
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.refusal, BEAT_UNREAD);
    const dragged = planTrack({ title: "Track two", features: fixtureFeatures(FIXTURE_TRACKS[1]!), analysis: null, marks: { dropS: 160, dropSetBy: "Matas" } });
    assert.ok(dragged.ok);
    if (dragged.ok) {
      assert.equal(dragged.window.cut, "seconds");
      assert.deepEqual(dragged.lines.slice(0, 2), [BEAT_UNREAD, "Drop 2:40 · Drop set by Matas"]);
    }
  });
});

describe("TK16: the hook on the grid", () => {
  it("the last place the phrase plays before the drop (track one: HOOK · 2:14, 5 bars before 2:24)", () => {
    const a = fixtureAnalysis(T1);
    const h = findHook(fixtureFeatures(T1), 144, studioGrid(a.downbeats, 144), T1.drops);
    assert.equal(h.kind, "hook");
    if (h.kind === "hook") {
      near(h.hookS, 144 - 5 * BAR_S, 1e-3);
      assert.equal(h.phrase.bars, 2);
      assert.equal(h.phrase.places.length, 3);
    }
    const plan = planTrack({ title: "Track one", features: fixtureFeatures(T1), analysis: a });
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.deepEqual(plan.lines, ["Drop 2:24 · the last drop", "HOOK · 2:14", "2:14–2:31 · 17.4 s · 9 bars"]);
      near(plan.window.startS, 134.323);
      near(plan.window.endS, 151.742);
    }
  });

  it("a place too far back is left off; no phrase says so (track three: 1:40–1:53, 13.5 s)", () => {
    const db = uniformDownbeats(0, BAR_S, 192);
    assert.equal(hookFromPhrase({ bars: 2, places: [db[5]!, db[60]!] }, 144, db).kind, "too_far");
    const plan = planTrack({ title: "Track three", features: fixtureFeatures(T3), analysis: fixtureAnalysis(T3) });
    assert.ok(plan.ok);
    if (plan.ok) assert.deepEqual(plan.lines, ["Drop 1:46 · an earlier drop (no later drop fits)", NO_PHRASE, "1:40–1:53 · 13.5 s · 7 bars"]);
  });

  it("operator marks: a placed hook too far back gets the 20 s refusal; set-by lines; the drop snaps to a downbeat", () => {
    const a = fixtureAnalysis(T1);
    const far = planTrack({ title: "Track one", features: fixtureFeatures(T1), analysis: a, marks: { hookS: 144 - 10 * BAR_S, hookSetBy: "Matas" } });
    assert.equal(far.ok, false);
    if (!far.ok) assert.equal(far.refusal, "Track one: from the hook to 6 s after the drop is over 20 s — move the hook marker.");
    const set = planTrack({ title: "Track one", features: fixtureFeatures(T1), analysis: a, marks: { dropS: 107.4, dropSetBy: "Matas", hookS: null, hookSetBy: "Matas" } });
    assert.ok(set.ok);
    if (set.ok) {
      assert.ok(a.downbeats.some((d) => Math.abs(d - set.window.dropS) < 1e-6));
      assert.deepEqual(set.lines.slice(0, 2), ["Drop 1:47 · Drop set by Matas", "Hook set by Matas"]);
    }
  });

  it("an unsteady grid reads its line and finds no phrase", () => {
    const a = fixtureAnalysis(T3);
    const plan = planTrack({ title: "X", features: fixtureFeatures(T3), analysis: { ...a, downbeats: a.downbeats.map((d, i) => d + (i % 2 ? 0.25 : 0)) } });
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.ok(plan.lines.includes(NO_STEADY_BEAT));
      assert.equal(plan.window.cut, "seconds");
    }
  });
});

describe("TK3: the join and its loudness", () => {
  it("starts each snippet 0.75 s before the one before ends, mixed without normalising", () => {
    const args = joinArgs(["a.m4a", "b.m4a"], [0, 12.798], "out.m4a");
    const fc = args[args.indexOf("-filter_complex") + 1]!;
    assert.match(fc, /adelay=12798\|12798/);
    assert.match(fc, /amix=inputs=2:duration=longest:dropout_transition=0:normalize=0/);
    assert.ok(args.includes("256k"));
  });

  it("checks −14 LUFS ± 1 with peaks no higher than −1 dBTP", () => {
    assert.equal(loudnessOk({ lufs: -14.6, truePeakDb: -1.2 }), true);
    assert.equal(loudnessOk({ lufs: -12.9, truePeakDb: -1.2 }), false);
    assert.equal(loudnessOk({ lufs: -14, truePeakDb: -0.8 }), false);
  });
});

describe("Acceptance: the reel's timeline", () => {
  it("five tracks: 68.6 s, drops at 5.81 … 60.87, rows at 0 … 51.19, the end card from 65.61", () => {
    const tl = reelTimeline(FIXTURE_SNIPPETS_5, "date");
    near(tl.totalS, 68.6, 0.05);
    [5.81, 18.6, 31.4, 44.2, 60.87].forEach((d, i) => near(tl.dropsS[i]!, d, 0.01));
    [0, 12.8, 25.6, 38.39, 51.19].forEach((r, i) => near(tl.startsS[i]!, r, 0.01));
    near(tl.endFromS, 65.61, 0.01);
  });

  it("three tracks: 43.0 s with drops at 5.81, 18.60 and 35.27", () => {
    const tl = reelTimeline(FIXTURE_SNIPPETS_3, "date");
    near(tl.totalS, 43.0, 0.05);
    [5.81, 18.6, 35.27].forEach((d, i) => near(tl.dropsS[i]!, d, 0.01));
  });

  it("the no-CTA end holds for 2.5 s", () => {
    near(reelTimeline(FIXTURE_SNIPPETS_5, "nocta").endFromS, 66.11, 0.01);
  });
});

describe("TK2: the headline", () => {
  it("is Matas's four strings, exact, with the typographic apostrophe", () => {
    assert.equal(headline("ranked", "Luke Dean", 5), "Top Luke Dean tracks ranked 1–5");
    assert.equal(headline("forever", "Luke Dean", 5), "Luke Dean tracks that changed music forever");
    assert.equal(headline("level", "Luke Dean", 5), "What’s your Luke Dean level?");
    assert.equal(headline("cant-live", "Luke Dean", 3), "Luke Dean tracks we can’t live without");
    assert.equal(kitCase(headline("level", "Luke Dean", 5), "upper"), "WHAT’S YOUR LUKE DEAN LEVEL?");
    assert.equal(narrowChip("forever", "Luke Dean", 5), "… changed music forever");
  });

  it("never breaks the artist's name", () => {
    const measure = (t: string, cap: number) => t.length * cap * 0.5;
    const lines = wrap("WHAT’S YOUR LUKE DEAN LEVEL?", 46, 470, 2, measure, "LUKE DEAN");
    assert.ok(lines);
    assert.ok(lines!.some((l) => l.includes("LUKE DEAN")));
  });

  it("names the file by S14 with the framing slug", () => {
    assert.equal(topTracksFileName({ eventCode: "P26-BDAY", artistSlug: "luke-dean", framing: "ranked", tracks: 5, end: "date", stage: "on-sale", roundNo: 1 }), "P26-BDAY_luke-dean_top-tracks-ranked-5tracks-cta-on-sale_r1_9x16.mp4");
    assert.equal(topTracksFileName({ eventCode: "P26-BDAY", artistSlug: "luke-dean", framing: "cant-live", tracks: 3, end: "nocta", stage: "on-sale", roundNo: 1, draft: true }), "P26-BDAY_luke-dean_top-tracks-cant-live-3tracks-nocta-on-sale_r1_draft_9x16.mp4");
  });
});

describe("TK4: order, reveal and the playing row", () => {
  it("Ranked counts down from the bottom; the rest fill top-down", () => {
    assert.deepEqual(rowForPlay("ranked", 5), [4, 3, 2, 1, 0]);
    assert.deepEqual(rowForPlay("level", 3), [0, 1, 2]);
    assert.deepEqual(playOrder("ranked", ["a", "b", "c"]), ["c", "b", "a"]);
    assert.deepEqual(rowMarkers("ranked", 3, "joke"), ["1", "2", "3"]);
    assert.deepEqual(rowMarkers("forever", 3, "joke"), [null, null, null]);
  });

  it("has both ladders", () => {
    assert.deepEqual(rungs(5, "joke"), ["10%", "50%", "100%", "500%", "1000%"]);
    assert.deepEqual(rungs(4, "joke"), ["10%", "50%", "100%", "1000%"]);
    assert.deepEqual(rungs(3, "joke"), ["10%", "100%", "1000%"]);
    assert.deepEqual(rungs(5, "plain"), ["20%", "40%", "60%", "80%", "100%"]);
    assert.deepEqual(rungs(4, "plain"), ["25%", "50%", "75%", "100%"]);
    assert.deepEqual(rungs(3, "plain"), ["33%", "67%", "100%"]);
  });

  it("reveals at track start, or lights the marker first and shows the title on the drop", () => {
    const tl = reelTimeline(FIXTURE_SNIPPETS_5, "date");
    const atStart = rowState(13.1, 1, tl, "start");
    assert.equal(atStart.playing, true);
    assert.equal(atStart.titleOpacity, 1);
    const onDrop = rowState(13.1, 1, tl, "drop");
    assert.equal(onDrop.playing, true);
    assert.equal(onDrop.markerOpacity, 1);
    assert.equal(onDrop.titleOpacity, 0);
    assert.equal(rowState(13.1, 0, tl, "start").markerOpacity, 0.7);
    assert.equal(rowState(13.1, 4, tl, "start").markerOpacity, 0.4);
    assert.equal(rowState(tl.startsS[1]! + 0.125, 1, tl, "start").slidePx, 12);
  });

  it("the date end fades the list over 0.4 s; the no-CTA end holds it", () => {
    const tl = reelTimeline(FIXTURE_SNIPPETS_5, "date");
    const e = endState(tl.endFromS + 0.2, tl, "date");
    near(e.listOpacity, 0.5, 1e-6);
    near(e.endCardOpacity, 0.5, 1e-6);
    assert.equal(endState(67, reelTimeline(FIXTURE_SNIPPETS_5, "nocta"), "nocta").hold, true);
  });
});

describe("TK5 / TK6: a row and the fit", () => {
  const measure = (t: string, cap: number) => t.length * cap * 0.42;

  it("names other artists on a second line, unless the title already does", () => {
    assert.equal(withLine("Track three", ["Luke Dean", "Guest Artist"], "Luke Dean"), "with Guest Artist");
    assert.equal(withLine("X", ["Luke Dean", "A", "B", "C"], "Luke Dean"), "with A, B & C");
    assert.equal(withLine("X (feat. A)", ["Luke Dean", "A"], "Luke Dean"), null);
    assert.equal(withLine("X", ["Luke Dean"], "Luke Dean"), null);
  });

  it("lays the list out in a 480 px column ending on or above 1238", () => {
    const rows = FIXTURE_TRACKS.map((t, i) => ({ title: kitCase(t.title, "upper"), withText: withLine(t.title, t.artists, "Luke Dean"), marker: String(i + 1) }));
    const l = layoutReel({ headline: kitCase(headline("ranked", "Luke Dean", 5), "upper"), artist: "LUKE DEAN", rows, list: "left", measure, markerKind: "number" });
    assert.ok(isLayout(l));
    if (isLayout(l)) {
      assert.equal(l.headline[0]!.capTop, 353);
      for (const r of l.rows) for (const line of [...r.title, ...r.withLine]) assert.ok(line.capTop + line.capPx <= 1238 + 1e-6 && line.left + line.width <= 600 + 1e-6);
      assert.equal(l.bar.left, 120);
    }
  });

  it("refuses a title too long for the list", () => {
    const rows = [{ title: "A".repeat(80), withText: null, marker: "1" }, { title: "B", withText: null, marker: "2" }, { title: "C", withText: null, marker: "3" }];
    const l = layoutReel({ headline: "TOP X TRACKS RANKED 1–3", artist: "X", rows, list: "right", measure, markerKind: "number" });
    assert.deepEqual(l, { refused: "title", title: "A".repeat(80) });
    assert.equal(titleTooLong("Track four (Club Mix)"), "'Track four (Club Mix)' is too long for the list — pick another track.");
  });
});

describe("TK7: no text on a face", () => {
  it("fails the head test for a list on the head's side", () => {
    const head: Rect = { left: 200, top: 600, width: 260, height: 320 };
    const listBoxes: Rect[] = [{ left: 120, top: 700, width: 400, height: 40 }];
    assert.equal(textClearOfHead(listBoxes, head), false);
    assert.equal(textClearOfHead(listBoxes, { ...head, left: 680 }), true);
    assert.equal(headOnTarget(0.74 * 1080, "left"), true);
    assert.equal(headOnTarget(0.5 * 1080, "left"), false);
  });

  it("places a still with the head at 0.74 W and the eyes at 0.40 H, or refuses", () => {
    const placed = placeStill({ width: 3000, height: 4000 }, { box: { left: 1500, top: 1600, width: 500, height: 600 }, eyesY: 1800 }, "left");
    assert.ok(!("refused" in placed));
    const narrow = placeStill({ width: 1080, height: 1920 }, { box: { left: 0, top: 600, width: 260, height: 300 }, eyesY: 700 }, "left");
    assert.deepEqual(narrow, { refused: "cant_clear", side: "left" });
  });
});

describe("TK8: contrast", () => {
  it("steps the side band until both states pass, and sends the accent white when it misses 3:1", () => {
    assert.deepEqual(judgeContrast([0.4, 0.03, 0.01], 0.239), { step: 1, accentWhite: false });
    assert.deepEqual(judgeContrast([0.05, 0.05, 0.05], 0.12), { step: 0, accentWhite: true });
    assert.deepEqual(judgeContrast([0.9, 0.9, 0.9], 0.2), { refused: true });
  });
});

describe("TK2 / TK10: picking", () => {
  it("refuses a Drive-only track under Ranked and Level", () => {
    assert.deepEqual(canTick("ranked", { spotifyRank: null }), { ok: false, line: "Not on Spotify's top tracks, so it can't be ranked" });
    assert.deepEqual(canTick("level", { spotifyRank: null }), { ok: false, line: "Not on Spotify's top tracks, so it can't be ranked" });
    assert.deepEqual(canTick("forever", { spotifyRank: null }), { ok: true });
    assert.deepEqual(canTick("ranked", { spotifyRank: 4 }), { ok: true });
  });

  it("defaults as TK10 lists them", () => {
    assert.deepEqual(DEFAULT_OPTIONS, { framing: "ranked", tracks: 5, rowsAppear: "start", ladder: "joke", end: "date", endCard: "column", list: "left", background: "press" });
    assert.equal(mmss(127.5), "2:07");
  });
});

describe("TK17: the snippet static takes TK14's drops and TK15's choice", () => {
  it("fits CT1's window (from 4 s before, 16 s), not Top tracks'", async () => {
    const { snippetStaticFits, snippetDropFrom } = await import("../audio-intake.ts");
    assert.equal(snippetStaticFits(150, 192), true);
    assert.equal(snippetStaticFits(181, 192), false);
    assert.equal(snippetStaticFits(3, 192), false);
    const r = snippetDropFrom(fixtureAnalysis(T1));
    assert.equal(r.choice, "last");
    near(r.dropS!, 144, 1e-3);
    assert.equal((r.stored as { v: number }).v, 2);
  });

  it("a file with no break leaves the marker for the operator and keeps what was found", async () => {
    const { snippetDropFrom } = await import("../audio-intake.ts");
    const a = fixtureAnalysis(T1);
    const r = snippetDropFrom({ ...a, bassBeatDb: a.beats.map(() => -10) });
    assert.equal(r.dropS, null);
    assert.deepEqual((r.stored as { drops: unknown[] }).drops, []);
  });
});

describe("Acceptance (issue 2): Can't Decide on its real analysis", () => {
  const a = JSON.parse(readFileSync(join(process.cwd(), "lib/creative-tests/__tests__/fixtures/cant-decide-analysis.json"), "utf8")) as StudioAnalysis;

  it("reads Beat This!'s grid at about 130 BPM, steady around the payoff", () => {
    const g = studioGrid(a.downbeats, 127.28);
    assert.ok(g.steady);
    if (g.steady) near(60 * 4 / g.barS, 130.4, 0.5);
  });

  it("finds the bass return after the 2:04 break among its drops", () => {
    assert.ok(findBassDrops(a).drops.some((d) => d.tS >= 126.75 && d.tS <= 128.0));
  });

  it(
    "uses the bass return after the 2:04 break, between 2:06.75 and 2:08.0",
    { todo: "TK15 picks 2:34.98, after a 1-bar fill that meets TK14's break rule (reported on #1338 for design's re-rule; not tuned)" },
    () => {
      const drops = findBassDrops(a).drops.map((d) => d.tS);
      const c = chooseDrop({ drops, durationS: a.durationS, downbeats: a.downbeats });
      assert.ok("dropS" in c && c.dropS >= 126.75 && c.dropS <= 128.0, `chose ${"dropS" in c ? c.dropS : c.kind}`);
    },
  );

  it("lists its drops; more than 4 is reported (TK14's acceptance)", () => {
    const r = findBassDrops(a);
    assert.deepEqual(r.drops.map((d) => d.tS), [7.3, 22.06, 66.36, 127.28, 154.98]);
  });

  it("is quiet about mmss: 2:07", () => assert.equal(mmss(127.5), "2:07"));
});
