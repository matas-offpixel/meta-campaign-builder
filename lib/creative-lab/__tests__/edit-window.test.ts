import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  VW_LINES,
  WINDOW_RULE,
  applyWindowRequest,
  clock,
  defaultWindow,
  dropFits,
  dropLines,
  isMajor,
  latestMajor,
  mainDropOf,
  nudgedWindow,
  parseStoredDrops,
  refusalOf,
  stepDropIn,
  stepLength,
  timelineTicks,
  windowChip,
  windowState,
  type StoredDrops,
  type WindowChoice,
} from "../edit-window.ts";

const NONE: WindowChoice = { dropS: null, byHand: false, inS: null, outS: null };

/** Candidates as [time, rise dB] or [time, rise dB, the 2 s after against the loudest 2 s dB]; mainS as detection stores it (VW7). */
function drops(durationS: number, candidates: ([number, number] | [number, number, number])[], extra: Partial<Extract<StoredDrops, { status: "ok" }>> = {}): Extract<StoredDrops, { status: "ok" }> {
  const list = candidates.map(([tS, riseDb, afterDb]) => (afterDb == null ? { tS, riseDb } : { tS, riseDb, afterDb }));
  const mainS = mainDropOf({ candidates: list, durationS })?.tS ?? null;
  return { v: 1, status: "ok", assetId: "a", durationS, hasSound: true, lufs: -14, candidates: list, mainS, peaks: [], ...extra };
}

/** The records' XMPL clip 07: 42.0 s, 0:16.4 rising 11 dB, 0:31.2 rising 8 dB. Under VW7 0:31.2 is the main drop. */
const XMPL07 = drops(42, [[16.4, 11], [31.2, 8]]);

describe("VW3 and VW5 words, exactly as the record", () => {
  it("pins every chip in VW3's order", () => {
    assert.deepEqual(Object.values(VW_LINES.chip), ["No sound", "Too short for an edit", "No clear drop", "Drop too soon", "Too little after the drop"]);
  });

  it("pins every sentence with the record's figures", () => {
    assert.equal(VW_LINES.noSound, "This clip has no sound, so there's no drop to build the edit on.");
    assert.equal(VW_LINES.tooShort(12.6), "This clip is 12.6 s long. An edit needs 15 s, with 3 s before the drop and 10 s after it.");
    assert.equal(VW_LINES.noDrop, "No clear drop in this clip's sound, so it can't make a 15–20 s edit. Choose another clip.");
    assert.equal(VW_LINES.tooSoon(1.8), "The main drop is 1.8 s in. An edit needs 3 s before it.");
    assert.equal(VW_LINES.tooLittleAfter(6.2, 24.8), "Only 6.2 s after the main drop at 0:24.8. An edit needs 10 s after it.");
    assert.equal(VW_LINES.dropAction(9), "Use the drop at 0:09.0");
  });

  it("pins the picker's words", () => {
    assert.equal(VW_LINES.heading, "Edit window");
    assert.equal(VW_LINES.summary({ dropS: 16.4, dropInS: 4, lengthS: 16 }, false), "Drop at 0:16.4 · 4.0 s in · 16 s long");
    assert.equal(VW_LINES.summary({ dropS: 16.4, dropInS: 3.5, lengthS: 18 }, true), "Drop at 0:16.4 · 3.5 s in · 18 s long · set by hand");
    assert.equal(VW_LINES.mainDrop({ tS: 16.4, riseDb: 11 }), "Main drop 0:16.4");
    assert.equal(VW_LINES.rises({ tS: 16.4, riseDb: 11 }), "rises 11 dB");
    assert.equal(VW_LINES.otherDrop({ tS: 31.2, riseDb: 8 }), "0:31.2");
    assert.equal(VW_LINES.useThisDrop, "Use this drop");
    assert.equal(VW_LINES.doesntFit, "doesn't fit");
    assert.equal(VW_LINES.dropInAt, "Drop in at");
    assert.equal(VW_LINES.length, "Length");
    assert.equal(VW_LINES.back, "Back to the detected window");
    assert.equal(VW_LINES.dropMarker, "DROP");
  });

  it("writes {m:ss.s}", () => {
    assert.equal(clock(0), "0:00.0");
    assert.equal(clock(9), "0:09.0");
    assert.equal(clock(24.8), "0:24.8");
    assert.equal(clock(61.25), "1:01.3");
    assert.equal(clock(59.96), "1:00.0");
  });
});

describe("VW2 · the window", () => {
  it("16 s from 4.0 s before the drop", () => {
    assert.deepEqual(defaultWindow(16.4, 42), { inS: 12.4, outS: 28.4, dropS: 16.4, dropInS: 4, lengthS: 16 });
  });

  it("VW-A, redrawn (VW7): main drop 0:31.2, window 0:27.0–0:42.0, 15 s, the drop 4.2 s in", () => {
    const state = windowState(XMPL07, NONE);
    assert.equal(state.kind, "ok");
    if (state.kind !== "ok") return;
    assert.deepEqual(state.window, { inS: 27, outS: 42, dropS: 31.2, dropInS: 4.2, lengthS: 15 });
    assert.equal(VW_LINES.summary(state.window, state.byHand), "Drop at 0:31.2 · 4.2 s in · 15 s long");
  });

  it("starts at the clip's start when the drop is under 4.0 s in", () => {
    assert.deepEqual(defaultWindow(3.4, 30), { inS: 0, outS: 16, dropS: 3.4, dropInS: 3.4, lengthS: 16 });
  });

  it("shortens to the clip's end, down to 15 s", () => {
    // 16.4 − 4 = 12.4; the clip ends at 27.9, so 15.5 s.
    assert.deepEqual(defaultWindow(16.4, 27.9), { inS: 12.4, outS: 27.9, dropS: 16.4, dropInS: 4, lengthS: 15.5 });
  });

  it("then starts earlier, the drop up to 5.0 s in", () => {
    // 10.4 s after the drop: 15 s ending at the clip's end puts the drop 4.6 s in.
    assert.deepEqual(defaultWindow(16.4, 26.8), { inS: 11.8, outS: 26.8, dropS: 16.4, dropInS: 4.6, lengthS: 15 });
    // Exactly 10 s after: 5.0 s in.
    assert.deepEqual(defaultWindow(20, 30), { inS: 15, outS: 30, dropS: 20, dropInS: 5, lengthS: 15 });
  });

  it("keeps the limits for every drop that fits", () => {
    for (let duration = 15; duration <= 40; duration += 0.7) {
      for (let drop = 0; drop <= duration; drop += 0.3) {
        const w = defaultWindow(drop, duration);
        assert.equal(w != null, dropFits(drop, duration), `${drop} in ${duration}`);
        if (!w) continue;
        assert.ok(w.inS >= 0 && w.outS <= duration + 1e-6);
        assert.ok(w.lengthS >= WINDOW_RULE.minLengthS - 1e-6 && w.lengthS <= WINDOW_RULE.maxLengthS + 1e-6);
        assert.ok(w.dropInS >= 3 - 1e-6 && w.dropInS <= 5 + 1e-6, `${w.dropInS}`);
      }
    }
  });
});

describe("VW3 · refusals, in order", () => {
  it("no sound comes first, whatever else", () => {
    const r = refusalOf(drops(8, [], { hasSound: false }));
    assert.equal(r?.chip, "No sound");
    assert.equal(r?.sentence, VW_LINES.noSound);
  });

  it("VW-B: 12.6 s is too short", () => {
    const r = refusalOf(drops(12.6, [[5, 9]]));
    assert.equal(r?.chip, "Too short for an edit");
    assert.equal(r?.sentence, "This clip is 12.6 s long. An edit needs 15 s, with 3 s before the drop and 10 s after it.");
    assert.equal(r?.useDrop, null);
  });

  it("no candidate is no clear drop", () => {
    const r = refusalOf(drops(30, []));
    assert.equal(r?.chip, "No clear drop");
    assert.equal(r?.sentence, VW_LINES.noDrop);
  });

  it("a failed check refuses the clip with VW3's no-drop words", () => {
    const r = refusalOf({ v: 1, status: "failed", assetId: null, error: "ffmpeg: boom" });
    assert.equal(r?.chip, "No clear drop");
    assert.equal(windowChip(windowState({ v: 1, status: "failed", assetId: null, error: "x" }, NONE)), "No clear drop");
  });

  it("VW-B: a drop at 1.8 s is too soon, and offers the one at 9.0 s", () => {
    const r = refusalOf(drops(30, [[1.8, 12], [9, 8]]));
    assert.equal(r?.chip, "Drop too soon");
    assert.equal(r?.sentence, "The main drop is 1.8 s in. An edit needs 3 s before it.");
    assert.deepEqual(r?.useDrop, { tS: 9, riseDb: 8 });
    assert.equal(VW_LINES.dropAction(r!.useDrop!.tS), "Use the drop at 0:09.0");
  });

  it("VW-B: 6.2 s after a drop at 24.8 s, and no other fits", () => {
    const r = refusalOf(drops(31, [[24.8, 10], [1, 4]]));
    assert.equal(r?.chip, "Too little after the drop");
    assert.equal(r?.sentence, "Only 6.2 s after the main drop at 0:24.8. An edit needs 10 s after it.");
    assert.equal(r?.useDrop, null);
  });

  it("VW8: offers the latest candidate that fits, not the largest rise", () => {
    // 0:02.0 is the only major (8 and 15 are over 3 dB under its rise, and quiet after), and it's too soon.
    const r = refusalOf(drops(40, [[2, 14, 0], [8, 7, -8], [15, 6.5, -9]]));
    assert.equal(r?.chip, "Drop too soon");
    assert.equal(r?.useDrop?.tS, 15);
  });

  it("the chip goes once the other drop is used", () => {
    const d = drops(30, [[1.8, 12], [9, 8]]);
    assert.equal(windowChip(windowState(d, NONE)), "Drop too soon");
    const used = applyWindowRequest(d, { action: "useDrop", dropS: 9 });
    assert.ok(used.ok);
    if (!used.ok) return;
    assert.deepEqual(used.columns, { window_drop_s: 9, window_by_hand: true, in_s: 5, out_s: 21 });
    const state = windowState(d, { dropS: used.columns.window_drop_s, byHand: true, inS: used.columns.in_s, outS: used.columns.out_s });
    assert.equal(windowChip(state), null);
    assert.equal(state.kind === "ok" && VW_LINES.summary(state.window, state.byHand), "Drop at 0:09.0 · 4.0 s in · 16 s long · set by hand");
  });

  it("an unchecked clip is pending, not refused", () => {
    assert.deepEqual(windowState(null, NONE), { kind: "pending" });
    assert.equal(windowChip(windowState(null, NONE)), null);
  });
});

describe("VW4 · the nudge", () => {
  it("steps the drop 3.0–5.0 s in 0.1 s, and stops at the limits", () => {
    const w = defaultWindow(16.4, 42)!;
    assert.equal(stepDropIn(w, 1, 42)?.dropInS, 4.1);
    assert.equal(stepDropIn(w, -1, 42)?.dropInS, 3.9);
    let at = w;
    for (let i = 0; i < 10; i += 1) at = stepDropIn(at, 1, 42)!;
    assert.equal(at.dropInS, 5);
    assert.equal(stepDropIn(at, 1, 42), null);
    assert.equal(nudgedWindow(16.4, 2.9, 16, 42), null);
  });

  it("steps the length 15–20 s in 1 s, never past the clip's end", () => {
    const w = defaultWindow(16.4, 42)!;
    assert.equal(stepLength(w, 1, 42)?.lengthS, 17);
    assert.equal(stepLength(w, -1, 42)?.lengthS, 15);
    assert.equal(stepLength(stepLength(w, -1, 42)!, -1, 42), null);
    assert.equal(nudgedWindow(16.4, 4, 21, 42), null);
    // The drop at 20 s in a 30 s clip: 5.0 s in and 15 s is the only window.
    const tight = defaultWindow(20, 30)!;
    assert.equal(stepLength(tight, 1, 30), null);
    assert.equal(stepDropIn(tight, 1, 30), null);
  });

  it("never takes a drop the sound doesn't show", () => {
    const r = applyWindowRequest(XMPL07, { action: "nudge", dropS: 20, dropInS: 4, lengthS: 16 });
    assert.deepEqual(r, { ok: false, error: "That drop isn't one this clip's sound shows." });
  });

  it("refuses a window outside the limits", () => {
    assert.equal(applyWindowRequest(XMPL07, { action: "nudge", dropS: 16.4, dropInS: 5.5, lengthS: 16 }).ok, false);
    assert.equal(applyWindowRequest(XMPL07, { action: "nudge", dropS: 16.4, dropInS: 4, lengthS: 14 }).ok, false);
    assert.equal(applyWindowRequest(drops(30, [[1.8, 12], [9, 8]]), { action: "useDrop", dropS: 1.8 }).ok, false);
  });

  it("a nudge is set by hand; back to the detected window resets all three", () => {
    const nudged = applyWindowRequest(XMPL07, { action: "nudge", dropS: 16.4, dropInS: 3.5, lengthS: 18 });
    assert.deepEqual(nudged, { ok: true, columns: { window_drop_s: 16.4, window_by_hand: true, in_s: 12.9, out_s: 30.9 } });
    const state = windowState(XMPL07, { dropS: 16.4, byHand: true, inS: 12.9, outS: 30.9 });
    assert.equal(state.kind === "ok" && VW_LINES.summary(state.window, state.byHand), "Drop at 0:16.4 · 3.5 s in · 18 s long · set by hand");
    // A nudge on the main drop also stores its drop (VW9: a later re-rule never moves a hand-set window).
    assert.deepEqual(applyWindowRequest(XMPL07, { action: "nudge", dropS: 31.2, dropInS: 4.5, lengthS: 15 }), { ok: true, columns: { window_drop_s: 31.2, window_by_hand: true, in_s: 26.7, out_s: 41.7 } });
    assert.deepEqual(applyWindowRequest(XMPL07, { action: "reset" }), { ok: true, columns: { window_drop_s: null, window_by_hand: false, in_s: 27, out_s: 42 } });
  });

  it("a stored window outside the limits falls back to the drop's default", () => {
    const state = windowState(XMPL07, { dropS: null, byHand: false, inS: 0, outS: 30 });
    assert.equal(state.kind === "ok" && state.window.inS, 27);
  });
});

describe("VW5 · the picker's view", () => {
  it("VW-A's drop lines (VW7): the main drop 0:31.2 first and in use, 0:16.4 offered", () => {
    const lines = dropLines(windowState(XMPL07, NONE));
    assert.deepEqual(lines.map((l) => [l.label, l.rises, l.inUse, l.fits]), [
      ["Main drop 0:31.2", "rises 8 dB", true, true],
      ["0:16.4", "rises 11 dB", false, true],
    ]);
  });

  it("VW8: every candidate is listed, major and minor, main first then time order; one that can't fit says so", () => {
    const lines = dropLines(windowState(drops(44, [[4, 12, -7], [12, 7, -8], [20, 10, 0], [38, 11, -1]]), NONE));
    assert.deepEqual(lines.map((l) => [l.label, l.fits, l.inUse]), [
      ["Main drop 0:20.0", true, true],
      ["0:04.0", true, false],
      ["0:12.0", true, false],
      ["0:38.0", false, false],
    ]);
    const refused = dropLines(windowState(drops(31, [[24.8, 10], [1, 6]]), NONE));
    assert.deepEqual(refused.map((l) => [l.label, l.fits]), [["0:01.0", false], ["0:24.8", false]]);
  });

  it("the timeline: every 10 s and the end; every 20 s on a phone", () => {
    assert.deepEqual(timelineTicks(42, false), ["0:00", "0:10", "0:20", "0:30", "0:42"]);
    assert.deepEqual(timelineTicks(42, true), ["0:00", "0:20", "0:42"]);
  });
});

describe("the stored drops", () => {
  it("reads what detection writes, and nothing else", () => {
    assert.equal(parseStoredDrops(null), null);
    assert.equal(parseStoredDrops({ v: 2 }), null);
    assert.deepEqual(parseStoredDrops(JSON.parse(JSON.stringify(XMPL07))), XMPL07);
    assert.deepEqual(parseStoredDrops({ v: 1, status: "failed", assetId: "x", error: "e" }), { v: 1, status: "failed", assetId: "x", error: "e" });
  });
});

/**
 * P26-BDAY clips 27 and 30, from the Luke Dean session's real transient lists
 * (17 Nov 2026; times and rises as measured, no audio committed). The lists
 * give each candidate's rise (score: the 2 s after over the 4 s before, under
 * 150 Hz) but not every after-level: VW7's acceptance gives 27's 0:29.78 as
 * the clip's loudest point (0 dB). The others are run at both extremes, so
 * the result never rests on a figure the lists don't have.
 */
describe("VW7 · the main drop: P26-BDAY acceptance", () => {
  for (const unknown of [-20, 0]) {
    it(`clip 27 (46.76 s) → 0:29.78, not the 15.06 s first kick (15.06's after-level ${unknown} dB)`, () => {
      const clip27 = drops(46.76, [[15.06, 17.8, unknown], [29.78, 12.4, 0]]);
      assert.equal(isMajor(clip27.candidates[0]!, clip27.candidates), true, "the first kick is major by its rise");
      assert.equal(isMajor(clip27.candidates[1]!, clip27.candidates), true, "the drop is major by its level");
      assert.equal(mainDropOf(clip27)?.tS, 29.78);
      const state = windowState(clip27, NONE);
      assert.equal(state.kind, "ok");
      if (state.kind !== "ok") return;
      assert.deepEqual(state.window, { inS: 25.78, outS: 41.78, dropS: 29.78, dropInS: 4, lengthS: 16 });
      // The Luke Dean session's hand cut r4 starts at 25.8 s with the landing 3.98 s in: the same drop.
      assert.ok(Math.abs(state.window.inS - 25.8) <= 0.05);
    });

    it(`clip 30 (27.54 s) → 0:11.48 within 50 ms of the approved r3, not the 2.22 s opening (2.22's after-level ${unknown} dB)`, () => {
      const clip30 = drops(27.54, [[2.22, 10, unknown], [11.48, 17.1, 0]]);
      assert.equal(isMajor(clip30.candidates[1]!, clip30.candidates), true);
      const main = mainDropOf(clip30)!;
      assert.ok(Math.abs(main.tS - 11.48) <= 0.05, `${main.tS}`);
      assert.equal(windowChip(windowState(clip30, NONE)), null);
    });
  }

  it("VW-C: a minor fill never becomes the main drop; the last major that fits wins over a larger earlier one; a latest major with under 10 s after is skipped", () => {
    // The record's schematic 44.0 s track.
    const track = drops(44, [[4, 12, -7], [12, 7, -8], [20, 10, 0], [38, 11, -1]]);
    assert.deepEqual(track.candidates.map((c) => isMajor(c, track.candidates)), [true, false, true, true]);
    assert.equal(mainDropOf(track)?.tS, 20);
    const state = windowState(track, NONE);
    assert.equal(state.kind === "ok" && `${state.window.inS}–${state.window.outS}`, "16–32");
    // Take the drop away: the minor fill at 12 s still isn't chosen; the earlier major is.
    assert.equal(mainDropOf(drops(44, [[4, 12, -7], [12, 7, -8], [38, 11, -1]]))?.tS, 4);
  });

  it("one major candidate is used alone", () => {
    assert.equal(mainDropOf(drops(30, [[10, 9, 0]]))?.tS, 10);
    assert.equal(mainDropOf(drops(30, [[6, 7, -9], [10, 12, 0], [18, 6, -10]]))?.tS, 10);
  });

  it("3 s before and 10 s after are the edges: exactly fits, a step less doesn't", () => {
    assert.equal(mainDropOf(drops(20, [[3, 10, 0]]))?.tS, 3);
    assert.equal(mainDropOf(drops(20, [[2.95, 10, 0]])), null);
    assert.equal(mainDropOf(drops(25, [[15, 10, 0]]))?.tS, 15);
    assert.equal(mainDropOf(drops(25, [[15.05, 10, 0]])), null);
    // The last major that fits wins even when a later major sits a step past the edge.
    assert.equal(mainDropOf(drops(25, [[6, 10, 0], [15.05, 10, 0]]))?.tS, 6);
  });

  it("the margins are 3 dB, inclusive", () => {
    const list = [{ tS: 5, riseDb: 12 }, { tS: 15, riseDb: 9 }, { tS: 25, riseDb: 8.9, afterDb: -3 }, { tS: 35, riseDb: 8.9, afterDb: -3.1 }];
    assert.deepEqual(list.map((c) => isMajor(c, list)), [true, true, true, false]);
  });

  it("no major fits: VW3 refuses naming the latest major candidate, in VW3's words", () => {
    // Latest major 0:24.0 with 6.0 s after: "Too little after the drop", offering the latest that fits (the minor 0:10.0).
    const late = refusalOf(drops(30, [[1, 12, 0], [10, 6, -9], [24, 11, -1]]));
    assert.equal(latestMajor(drops(30, [[1, 12, 0], [10, 6, -9], [24, 11, -1]]))?.tS, 24);
    assert.equal(late?.chip, "Too little after the drop");
    assert.equal(late?.sentence, "Only 6.0 s after the main drop at 0:24.0. An edit needs 10 s after it.");
    assert.equal(late?.useDrop?.tS, 10);
    // Latest major 0:02.0 with 28.0 s after but under 3 s before: "Drop too soon".
    const soon = refusalOf(drops(30, [[2, 12, 0], [9, 8, -6]]));
    assert.equal(soon?.chip, "Drop too soon");
    assert.equal(soon?.sentence, "The main drop is 2.0 s in. An edit needs 3 s before it.");
    assert.equal(soon?.useDrop?.tS, 9);
  });
});
