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

function drops(durationS: number, candidates: [number, number][], extra: Partial<Extract<StoredDrops, { status: "ok" }>> = {}): Extract<StoredDrops, { status: "ok" }> {
  const list = candidates.map(([tS, riseDb]) => ({ tS, riseDb }));
  const top = list.length ? Math.max(...list.map((c) => c.riseDb)) : null;
  const main = top == null ? null : list.filter((c) => c.riseDb >= top - 1).sort((a, b) => a.tS - b.tS)[0]!.tS;
  return { v: 1, status: "ok", assetId: "a", durationS, hasSound: true, lufs: -14, candidates: list, mainS: main, peaks: [], ...extra };
}

/** The record's XMPL clip 07: 42.0 s, main drop 16.4 s rising 11 dB, another at 31.2 s rising 8 dB. */
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
  it("VW-A: 16 s from 4.0 s before the main drop", () => {
    assert.deepEqual(defaultWindow(16.4, 42), { inS: 12.4, outS: 28.4, dropS: 16.4, dropInS: 4, lengthS: 16 });
    const state = windowState(XMPL07, NONE);
    assert.equal(state.kind, "ok");
    if (state.kind !== "ok") return;
    assert.equal(VW_LINES.summary(state.window, state.byHand), "Drop at 0:16.4 · 4.0 s in · 16 s long");
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

  it("offers the fitting drop with the largest rise", () => {
    const r = refusalOf(drops(40, [[2, 14], [8, 6.5], [15, 7]]));
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
    assert.deepEqual(nudged, { ok: true, columns: { window_drop_s: null, window_by_hand: true, in_s: 12.9, out_s: 30.9 } });
    const state = windowState(XMPL07, { dropS: null, byHand: true, inS: 12.9, outS: 30.9 });
    assert.equal(state.kind === "ok" && VW_LINES.summary(state.window, state.byHand), "Drop at 0:16.4 · 3.5 s in · 18 s long · set by hand");
    assert.deepEqual(applyWindowRequest(XMPL07, { action: "reset" }), { ok: true, columns: { window_drop_s: null, window_by_hand: false, in_s: 12.4, out_s: 28.4 } });
  });

  it("a stored window outside the limits falls back to the drop's default", () => {
    const state = windowState(XMPL07, { dropS: null, byHand: false, inS: 0, outS: 30 });
    assert.equal(state.kind === "ok" && state.window.inS, 12.4);
  });
});

describe("VW5 · the picker's view", () => {
  it("VW-A's drop lines: the main drop in use, the other offered", () => {
    const lines = dropLines(windowState(XMPL07, NONE));
    assert.deepEqual(lines.map((l) => [l.label, l.rises, l.inUse, l.fits]), [
      ["Main drop 0:16.4", "rises 11 dB", true, true],
      ["0:31.2", "rises 8 dB", false, true],
    ]);
  });

  it("marks a drop that can't fit", () => {
    const lines = dropLines(windowState(drops(31, [[24.8, 10], [1, 4]]), NONE));
    assert.deepEqual(lines.map((l) => [l.label, l.fits, l.inUse]), [["Main drop 0:24.8", false, false], ["0:01.0", false, false]]);
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
