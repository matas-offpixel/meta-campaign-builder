/**
 * Top tracks (docs/design-record/2026-11-18-creative-lab-top-tracks.html):
 * HK8's unit tests. TK3's window, the drop choice and the hook on the
 * record's fixture; the bass-stem fallback's top 2; the reel's timeline
 * against the acceptance numbers; TK2's headlines; TK4's order and states;
 * TK5's row; the fit refusals; TK7's head test; TK2's Drive-only refusal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BAR_S, FIXTURE_SNIPPETS_3, FIXTURE_SNIPPETS_5, FIXTURE_TRACKS, fixtureFeatures, fixtureKicks } from "../../../scripts/plan-frames/top-tracks-fixtures.ts";
import { findDrops, findKicks, type TrackFeatures } from "../top-tracks/analysis.ts";
import {
  NO_PHRASE,
  NO_STEADY_BEAT,
  barGrid,
  barsNear,
  chooseDrop,
  dropRowText,
  findHook,
  hookFromPhrase,
  isWindow,
  mmss,
  planTrack,
  snippetWindow,
  type BarGrid,
} from "../top-tracks/audio-rules.ts";
import { bassStemTop2, detectorCandidates, rankOnBassStem, type Stems } from "../top-tracks/bass-stem.ts";
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
const steady: BarGrid = { steady: true, beatS: BAR_S / 4, barS: BAR_S, gaps: 16 };
const near = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b} (± ${tol})`);

describe("TK3: the window", () => {
  it("no hook: the bars nearest 6 s before (3 bars, 5.8 s) and 8 s after (4 bars, 7.7 s) at 124 BPM", () => {
    assert.equal(barsNear(BAR_S, { target: 6, min: 4, max: 8 }), 3);
    assert.equal(barsNear(BAR_S, { target: 8, min: 6, max: 10 }), 4);
    const w = snippetWindow({ dropS: 106, durationS: 185, grid: steady });
    assert.ok(isWindow(w));
    near(w.startS, 106 - 3 * BAR_S);
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
        const w = snippetWindow({ dropS: 40, durationS: 40 + room, grid: { steady: true, beatS: bar / 4, barS: bar, gaps: 16 } });
        if (isWindow(w)) assert.ok(w.lengthS >= 10 - 1e-6, `${bpm} BPM, ${room} s room: ${w.lengthS}`);
      }
    }
  });

  it("over 20 s: the end comes in to its 6 s floor in bars, then refuses", () => {
    const bar = 1.7; // 141 BPM: 5 bars after (8.5 s) by default, floor 4 bars (6.8 s)
    const grid: BarGrid = { steady: true, beatS: bar / 4, barS: bar, gaps: 16 };
    const ok = snippetWindow({ dropS: 100, durationS: 200, grid, hookS: 100 - 7 * bar });
    assert.ok(isWindow(ok));
    assert.equal(ok.barsAfter, 4);
    near(ok.lengthS, 18.7);
    const refused = snippetWindow({ dropS: 100, durationS: 200, grid, hookS: 100 - 9 * bar });
    assert.deepEqual(refused, { refused: "over_20" });
  });

  it("no steady beat: 6.0 s before and 8.0 s after, in seconds", () => {
    const g = barGrid([1, 1.3, 1.9, 2.0, 2.8, 3.1, 4.0], 5);
    assert.equal(g.steady, false);
    const w = snippetWindow({ dropS: 100, durationS: 200, grid: g });
    assert.ok(isWindow(w));
    assert.equal(w.cut, "seconds");
    assert.equal(w.startS, 94);
    assert.equal(w.endS, 108);
  });

  it("reads a steady grid off steady kicks (124 BPM)", () => {
    const g = barGrid(fixtureKicks(T1), 144);
    assert.equal(g.steady, true);
    if (g.steady) near(g.barS, BAR_S, 0.002);
  });
});

describe("TK3: which drop", () => {
  it("the last of three, in the last third (track one: 2:24)", () => {
    const c = chooseDrop({ drops: T1.drops.map((tS) => ({ tS })), durationS: T1.durationS, kicks: fixtureKicks(T1) });
    assert.equal(c.kind, "last");
    assert.ok("dropS" in c && c.dropS === 144);
    assert.equal(dropRowText(c as never), "Drop 2:24 · the last drop");
  });

  it("a last-third drop without room after it falls back to the one before", () => {
    const kicks = fixtureKicks(T1);
    const c = chooseDrop({ drops: [...T1.drops, 189].map((tS) => ({ tS })), durationS: T1.durationS, kicks });
    assert.ok("dropS" in c && c.dropS === 144 && c.kind === "last");
  });

  it("no drop in the last third: the last before it, an earlier drop, not an error (track three: 1:46)", () => {
    const c = chooseDrop({ drops: T3.drops.map((tS) => ({ tS })), durationS: T3.durationS, kicks: fixtureKicks(T3) });
    assert.equal(c.kind, "earlier");
    assert.ok("dropS" in c && c.dropS === 106);
    assert.equal(dropRowText(c as never), "Drop 1:46 · an earlier drop (no later drop fits)");
  });

  it("none qualifying: the room line, naming the side", () => {
    const c = chooseDrop({ drops: [{ tS: 2 }, { tS: 183 }], durationS: 185, kicks: fixtureKicks(T3) });
    assert.equal(c.kind, "no_room");
    const plan = planTrack({ title: "Track three", features: fixtureFeatures(T3), kicks: fixtureKicks(T3), drops: [{ tS: 2 }, { tS: 183 }] });
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.equal(plan.refusal, "Track three: the drop is too close to the end of the file — move the marker or pick another track.");
  });

  it("VW14 finding none falls back to the bass-stem top 2: the later that qualifies, the last third first", () => {
    const kicks = fixtureKicks(T1);
    const c = chooseDrop({ drops: [], durationS: T1.durationS, kicks, bassStemTop2: [62.712, 144] });
    assert.equal(c.kind, "bass_stem");
    assert.ok("dropS" in c && c.dropS === 144);
    assert.equal(dropRowText(c as never), "Drop 2:24 · the last drop · found on the bass stem");
    const early = chooseDrop({ drops: [], durationS: T1.durationS, kicks, bassStemTop2: [62.712, 190] });
    assert.equal(dropRowText(early as never), "Drop 1:02 · an earlier drop (no later drop fits) · found on the bass stem");
  });

  it("no drop found anywhere, and no bass stem: the no-drop line", () => {
    const plan = planTrack({ title: "Track two", features: fixtureFeatures(FIXTURE_TRACKS[1]!), kicks: [], drops: [], bassStemTop2: null });
    assert.equal(plan.ok, false);
    if (!plan.ok) assert.equal(plan.refusal, "Track two: no drop found — drag the drop marker to it.");
  });
});

describe("TK3: the hook", () => {
  it("the last place the phrase plays before the drop (track one: HOOK · 2:14, 5 bars before 2:24)", () => {
    const h = findHook(fixtureFeatures(T1), 144, steady, T1.drops);
    assert.equal(h.kind, "hook");
    if (h.kind === "hook") {
      near(h.hookS, 144 - 5 * BAR_S);
      assert.equal(h.phrase.bars, 2);
      assert.equal(h.phrase.places.length, 3);
    }
    const plan = planTrack({ title: "Track one", features: fixtureFeatures(T1), kicks: fixtureKicks(T1), drops: T1.drops.map((tS) => ({ tS })) });
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.deepEqual(plan.lines, ["Drop 2:24 · the last drop", "HOOK · 2:14", "2:14–2:31 · 17.4 s · 9 bars"]);
      near(plan.window.startS, 134.323);
      near(plan.window.endS, 151.742);
    }
  });

  it("a place too far back is left off", () => {
    const h = hookFromPhrase({ bars: 2, places: [10, 120] }, 144, BAR_S);
    assert.equal(h.kind, "too_far");
    const plan = planTrack({ title: "Track one", features: fixtureFeatures(T1), kicks: fixtureKicks(T1), drops: T1.drops.map((tS) => ({ tS })), marks: {} });
    assert.ok(plan.ok);
  });

  it("no phrase: no hook, and the line says so (track three: 1:40–1:53, 13.5 s)", () => {
    const plan = planTrack({ title: "Track three", features: fixtureFeatures(T3), kicks: fixtureKicks(T3), drops: T3.drops.map((tS) => ({ tS })) });
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.deepEqual(plan.lines, ["Drop 1:46 · an earlier drop (no later drop fits)", NO_PHRASE, "1:40–1:53 · 13.5 s · 7 bars"]);
      near(plan.window.startS, 100.194);
    }
  });

  it("operator marks: a placed hook too far back gets the 20 s refusal; set-by lines", () => {
    const far = planTrack({ title: "Track one", features: fixtureFeatures(T1), kicks: fixtureKicks(T1), drops: T1.drops.map((tS) => ({ tS })), marks: { hookS: 144 - 10 * BAR_S, hookSetBy: "Matas" } });
    assert.equal(far.ok, false);
    if (!far.ok) assert.equal(far.refusal, "Track one: from the hook to 6 s after the drop is over 20 s — move the hook marker.");
    const set = planTrack({ title: "Track one", features: fixtureFeatures(T1), kicks: fixtureKicks(T1), drops: T1.drops.map((tS) => ({ tS })), marks: { dropS: 107.226, dropSetBy: "Matas", hookS: null, hookSetBy: "Matas" } });
    assert.ok(set.ok);
    if (set.ok) assert.deepEqual(set.lines.slice(0, 2), ["Drop 1:47 · Drop set by Matas", "Hook set by Matas"]);
  });

  it("an unsteady beat cuts on seconds and says so", () => {
    const plan = planTrack({ title: "X", features: fixtureFeatures(T3), kicks: [100, 100.1, 100.5, 101.6, 101.7, 103, 105.5], drops: [{ tS: 106 }] });
    assert.ok(plan.ok);
    if (plan.ok) {
      assert.ok(plan.lines.includes(NO_STEADY_BEAT));
      assert.equal(plan.window.cut, "seconds");
    }
  });
});

describe("TK3: VW14 on a track", () => {
  /** Hand-built measures at a 10 ms hop: kicks as flux spikes, the bass and kick band quiet until 24 s, the mids flat but for two falls. */
  function features(): TrackFeatures {
    const hopS = 0.01;
    const n = 4000;
    const kickFlux = new Float64Array(n).fill(0.1);
    const kickBandDb = new Float64Array(n).fill(-20);
    const midsDb = new Float64Array(n).fill(-10);
    const bassPower = new Float64Array(n).fill(1e-4);
    const kicks: number[] = [];
    for (let t = 1; t < 20; t += 0.48) kicks.push(t);
    for (let t = 20; t < 24 - 1e-9; t += 0.23) kicks.push(t);
    for (let t = 24; t < 40; t += 0.48) kicks.push(t);
    for (const t of kicks) kickFlux[Math.round(t / hopS)] = 10;
    for (let i = 2400; i < n; i += 1) {
      bassPower[i] = 1;
      kickBandDb[i] = 0;
    }
    // A mids fall at 10 (quiet: doesn't land loud), at 26.4 (inside 4 s of 24: the same drop) and at 33.6 (a second drop, timed at the first kick whose 1 s takes it in).
    for (let i = 1000; i < 1100; i += 1) midsDb[i] = -14;
    for (let i = 2640; i < 2800; i += 1) midsDb[i] = -14;
    for (let i = 3360; i < 3500; i += 1) midsDb[i] = -14;
    return { hopS, durationS: n * hopS, kickFlux, kickBandDb, midsDb, bassPower, chroma: new Float32Array(n * 12) };
  }

  it("times a roll giving way to the beat at the first beat kick, and merges kicks within 4 s", () => {
    const f = features();
    const kicks = findKicks(f);
    assert.ok(kicks.length > 60);
    const drops = findDrops(f, kicks);
    assert.deepEqual(
      drops.map((d) => [d.tS, d.test]),
      [
        [24, "roll"],
        [33.12, "mids"],
      ],
    );
  });

  it("a breakdown where the kicks stop isn't a drop", () => {
    const f = features();
    assert.deepEqual(findDrops(f, findKicks(f).filter((t) => t < 20)), []);
  });
});

describe("TK3: the bass-stem ranking", () => {
  it("ranks the place the bass lands first, and returns its top 2", () => {
    const frameS = 0.05;
    const n = Math.round(120 / frameS);
    const bass = new Float64Array(n).fill(-60);
    const drums = new Float64Array(n).fill(-40);
    for (let i = Math.round(80 / frameS); i < n; i += 1) bass[i] = -10;
    for (let i = Math.round(40 / frameS); i < Math.round(44 / frameS); i += 1) bass[i] = -30;
    const stems: Stems = { frameS, bassDb: bass, drumsDb: drums };
    const ranked = rankOnBassStem([40, 60, 80], stems, []);
    assert.equal(ranked[0]!.tS, 80);
    assert.deepEqual(bassStemTop2([40, 60, 80], stems, []), [80, 40]);
  });

  it("lists every place CT4's detector would call a drop", () => {
    const frameS = 0.05;
    const low = new Float64Array(Math.round(120 / frameS)).fill(0.001);
    for (let i = Math.round(50 / frameS); i < Math.round(60 / frameS); i += 1) low[i] = 0.5;
    for (let i = Math.round(90 / frameS); i < low.length; i += 1) low[i] = 0.5;
    const c = detectorCandidates(low, frameS);
    assert.equal(c.length, 2);
    near(c[0]!, 50, 0.5);
    near(c[1]!, 90, 0.5);
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
