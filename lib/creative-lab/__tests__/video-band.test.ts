import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { captionLayout, profile } from "../../../src/remotion/caption-style/profile.ts";
import type { Piece } from "../artist-card.ts";
import { T1C, T1V_CLAIM, planClipLayout, planVideoClaim, type VideoClaimPlan } from "../t1-video.ts";
import {
  CAPTION_BAND_BOX,
  CAPTION_SAFE_RECT_BAND,
  CAPTION_TOO_LONG,
  VIDEO_BAND,
  VIDEO_RENDER_FORMATS,
  bandChecks,
  bandWord,
  captionBandInsetsPct,
  captionBandSlots,
  captionBoxChecks,
  captionCharEm,
  captionLineInkPx,
  captionSizeInBand,
  isOfferedRender,
  splitOfferedRenders,
  t1BandSlots,
} from "../video-band.ts";

/** The T1 tests' Bootzy-like fake width: 0.35 cap per character. */
const measure = (t: string, cap: number) => t.length * 0.35 * cap;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const piece = (w: number, h: number, cap: number, label: string): Piece => ({ png: Buffer.alloc(0), width: w, height: h, capPx: cap, label });
const one = planVideoClaim("General sale live", measure) as VideoClaimPlan;
const two = planVideoClaim("Final release tickets now on sale everywhere", measure) as VideoClaimPlan;
const roll = planVideoClaim("Early bird, 1st & 2nd release sold out\n3rd release selling fast", measure) as VideoClaimPlan;
const pieces = (claim: VideoClaimPlan | null) => ({ lockup: piece(1290, 388, 0, "lockup"), name: piece(1000, 220, 220, "name"), date: piece(800, 60, 60, "date"), claim });

describe("O96 · the band", () => {
  it("is Feed's 4:5 crop ∩ the Reels / Stories safe area: x 120–960, y 285–1248, type from 353, last baseline 1238", () => {
    assert.deepEqual(VIDEO_BAND, { left: 120, right: 960, top: 285, bottom: 1248, firstInk: 353, lastBaseline: 1238 });
    // Feed's centre 4:5 of the 9:16: (1920 − 1350) / 2 = 285; its top inset 0.05 × 1350 = 67.5 → 353.
    assert.equal((1920 - 1080 * 1.25) / 2, VIDEO_BAND.top);
    assert.equal(Math.round(VIDEO_BAND.top + 0.05 * 1350), VIDEO_BAND.firstInk);
  });

  it("H94: a fixture box at y 278, past x 960, left of 120, a baseline at 1248 and a tail below 1248 fail, naming the slot", () => {
    const checks = bandChecks([
      { slot: "high", box: { left: 405, top: 278, width: 270, height: 81 } },
      { slot: "wide", box: { left: 120, top: 400, width: 850, height: 50 } },
      { slot: "left", box: { left: 100, top: 400, width: 500, height: 50 } },
      { slot: "low line", box: { left: 200, top: 1200, width: 600, height: 48 }, baseline: 1248 },
      { slot: "tail", box: { left: 200, top: 1200, width: 600, height: 52 }, baseline: 1236 },
      { slot: "fine", box: { left: 120, top: 353, width: 840, height: 885 }, baseline: 1238 },
    ]);
    assert.deepEqual(
      checks.map((c) => [c.slot, c.why]),
      [
        ["high", "top 278 above 353"],
        ["wide", "right 970 > 960"],
        ["left", "left 100 < 120"],
        ["low line", "baseline 1248 below 1238"],
        ["tail", "bottom 1252 below 1248"],
        ["fine", null],
      ],
    );
    assert.equal(bandWord(checks.slice(5)), "✓ (1 in the band)");
    assert.match(bandWord(checks), /^✗ high: top 278 above 353; wide: right 970 > 960; /);
  });
});

describe("H95 · O97 T1 on a clip, moved slots", () => {
  it("the data note: lockup ink top 353 ± 0.005 H, name cap top 469, A date cap top 632, claim baseline 1238", () => {
    const a = planClipLayout(pieces(one), "9:16", "A");
    const tol = 0.005 * 1920;
    assert.ok(Math.abs(a.boxes.lockup!.top - 353) <= tol);
    close(a.boxes.lockup!.top, 353);
    close(a.pieces.name.at.top, 469);
    close(a.pieces.date.at.top, 632);
    close(a.claim.at(-1)!.capTop + a.claim.at(-1)!.capPx, 1238);
    close(T1V_CLAIM.bottom * 1920, 1238);
    // The block moved 75 px as one: the old O54 slots plus 75, its spacing unchanged.
    close(T1C.nameCapTop * 1920 - T1C.lockupTop * 1920, (0.205 - 0.145) * 1920, 1);
    close(T1C.dateCapTopA * 1920 - T1C.lockupTop * 1920, (0.29 - 0.145) * 1920, 1);
  });

  it("A's top block is 0.184–0.359 H; B's is 0.184–0.314 H and its date sits 0.015 H above the claim, 10 px up with it", () => {
    const a = planClipLayout(pieces(one), "9:16", "A");
    close(a.boxes.top.top / 1920, 0.184, 1e-3);
    assert.ok((a.boxes.top.top + a.boxes.top.height) / 1920 <= 0.359 + 5e-4);
    const b = planClipLayout(pieces(one), "9:16", "B");
    assert.ok((b.boxes.top.top + b.boxes.top.height) / 1920 <= 0.314 + 5e-4);
    close(b.pieces.date.at.top + b.pieces.date.at.height, b.claim[0]!.capTop - 0.015 * 1920);
  });

  it("H94: T1 A and T1 B pass the band with one-line, two-line and roll-call claims", () => {
    for (const claim of [one, two, roll]) {
      for (const arr of ["A", "B"] as const) {
        const checks = bandChecks(t1BandSlots(planClipLayout(pieces(claim), "9:16", arr)));
        assert.ok(checks.every((c) => c.ok), `${arr} ${claim.lines.map((l) => l.text).join(" / ")}: ${bandWord(checks)}`);
      }
    }
  });

  it("the band is the 9:16's: a 4:5 layout is refused", () => {
    assert.throws(() => t1BandSlots(planClipLayout(pieces(one), "4:5", "A")), /9:16/);
  });
});

describe("H97 · O99 the UGC caption box", () => {
  it("is x 120–944 (824 px), centred on the measured 0.493 W, inside x 120", () => {
    assert.deepEqual(CAPTION_BAND_BOX, { left: 120, right: 944, width: 824 });
    close((CAPTION_BAND_BOX.left + CAPTION_BAND_BOX.right) / 2 / 1080, profile.horizontalCenterPctOfWidth, 5e-4);
    assert.deepEqual(captionBandInsetsPct(), { left: 11.111, right: 12.593 });
    // The old box (84 % on 0.493 W) is x 79–986: out of the band on both sides.
    assert.ok(0.493 * 1080 - 0.42 * 1080 < 120 && 0.493 * 1080 + 0.42 * 1080 > 960);
  });

  it("the safeRect the profile takes becomes the band (v1.json still holds the old 4:5, y 0.1458–0.8541)", () => {
    close(CAPTION_SAFE_RECT_BAND.x * 1080, 120);
    close(CAPTION_SAFE_RECT_BAND.y * 1920, 285);
    close((CAPTION_SAFE_RECT_BAND.x + CAPTION_SAFE_RECT_BAND.w) * 1080, 960);
    close((CAPTION_SAFE_RECT_BAND.y + CAPTION_SAFE_RECT_BAND.h) * 1920, 1248);
    assert.deepEqual(profile.safeRect["9:16"], { x: 0, y: 0.1458, w: 1, h: 0.7083 });
  });

  it("lines are measured on TikTok Sans advances at wdth 120 / wght 400 / opsz 36, plus the stroke on both ends", () => {
    const table = JSON.parse(readFileSync(join(process.cwd(), "lib/creative-lab/caption-advances.json"), "utf8"));
    assert.deepEqual(table.axes, { opsz: 36, slnt: 0, wdth: 120, wght: 400 });
    const quote = JSON.parse(readFileSync(join(process.cwd(), "src/remotion/caption-style/quote-advances.json"), "utf8"));
    // wdth 120 is wider than the quote's wdth 100 for every Latin capital.
    for (let cp = 65; cp <= 90; cp += 1) assert.ok(table.advances[cp] > quote.weights["400"][cp], String.fromCodePoint(cp));
    close(captionCharEm("A"), 0.758);
    assert.equal(captionCharEm("🔥"), 1);
    const fontPx = profile.fontSizePctOfWidth * 1080;
    close(captionLineInkPx("A"), 0.758 * fontPx + 2 * profile.strokeWidthPctOfFontSize * fontPx);
  });

  it("a caption line of 824 px renders inside x 120–944; one wider goes long, or is refused with the existing words", () => {
    // Build a line that measures just under 824 px at the default size.
    let text = "";
    while (captionLineInkPx(`${text}n`) <= 824) text += "n";
    const w = captionLineInkPx(text);
    assert.ok(w <= 824 && w > 824 - captionLineInkPx("n") + captionLineInkPx(""), String(w));
    const layout = captionLayout(1080, 1920, "9:16", 0.5);
    const slots = captionBandSlots([text], "default", layout.centerY);
    assert.deepEqual(captionBoxChecks(slots).map((c) => c.ok), [true]);
    assert.ok(slots[0]!.box.left >= 120 - 0.5 && slots[0]!.box.left + slots[0]!.box.width <= 944 + 0.5);
    // One character more: too wide for the box at the default size.
    const wider = `${text}nn`;
    assert.equal(captionBoxChecks(captionBandSlots([wider], "default", layout.centerY))[0]!.ok, false);
    assert.deepEqual(captionSizeInBand({ default: [wider], long: [wider] }), { ok: true, size: "long", widestPx: captionLineInkPx(wider, "long") });
    const tooWide = "W".repeat(24);
    const refused = captionSizeInBand({ default: [tooWide], long: [tooWide] });
    assert.deepEqual([refused.ok, refused.ok ? null : refused.line], [false, CAPTION_TOO_LONG]);
    assert.equal(CAPTION_TOO_LONG, "This caption is too long — shorten it.");
    // A caption the character check already sent long stays long.
    assert.equal((captionSizeInBand({ default: ["short"], long: ["short"] }, "long") as { size: string }).size, "long");
  });

  it("H94: the default caption (4 lines) and the long one (5) pass the band at the measured centre", () => {
    const layout = captionLayout(1080, 1920, "9:16", 0.5);
    const four = ["TONIGHT WE DANCE AT", "the whole room sang", "Luke Dean b2b Locky", "one more for Puzzle"];
    assert.ok(captionBoxChecks(captionBandSlots(four, "default", layout.centerY)).every((c) => c.ok));
    const long = captionLayout(1080, 1920, "9:16", 0.5, "long");
    const five = ["the whole room sang every word", "Luke Dean b2b Locky at", "Puzzle's fourth birthday", "one more for Southampton", "see you on the floor"];
    const checks = captionBoxChecks(captionBandSlots(five, "long", long.centerY));
    assert.ok(checks.every((c) => c.ok), bandWord(checks));
  });
});

describe("H93 · O95 / O102 one 9:16", () => {
  it("T1 clip, T2 clip and caption renders make 9:16 only", () => {
    assert.deepEqual(VIDEO_RENDER_FORMATS, ["9:16"]);
  });

  it("an existing 4:5 or 1:1 video row is kept but not offered; 9:16 video and statics are offered; no row is dropped", () => {
    const rows = [
      { id: "a", kind: "video", aspect: "9:16" },
      { id: "b", kind: "video", aspect: "4:5" },
      { id: "c", kind: "video", aspect: "1:1" },
      { id: "d", kind: null, aspect: "4:5" },
      { id: "e", kind: "static", aspect: "4:5" },
      { id: "f", kind: undefined, aspect: "9:16" },
    ];
    const { offered, kept } = splitOfferedRenders(rows);
    assert.deepEqual(offered.map((r) => r.id), ["a", "e", "f"]);
    assert.deepEqual(kept.map((r) => r.id), ["b", "c", "d"]);
    assert.equal(offered.length + kept.length, rows.length);
    assert.equal(isOfferedRender({ kind: "video", aspect: "1:1" }), false);
  });

  it("a round of 2 clips × 3 captions makes 6 render rows, all 9:16", () => {
    const made = ["c1", "c2"].flatMap((clip) => ["x", "y", "z"].flatMap((cap) => VIDEO_RENDER_FORMATS.map((aspect) => ({ clip, cap, kind: "video", aspect }))));
    assert.equal(made.length, 6);
    assert.ok(made.every(isOfferedRender));
  });
});
