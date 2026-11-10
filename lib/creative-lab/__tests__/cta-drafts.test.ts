import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLAIM_FACE_BAND, CLAIM_LIMITS, NO_CLAIM_LIMITS, bandExtensionCandidates, bandPlacementOk, claimBoxRect, contrastRatio, lowContrastAgainst, redInkBox, redLineVerdict, subjectVerdict } from "../artist-card-claim.ts";
import { RECT_45, relativeLuminance } from "../artist-card.ts";
import { NotExportableError, SAMPLE_ROLL_CALL, WATERMARK, approvedClaim, assertExportable, watermarkFor, type WarningRow } from "../claim-approval.ts";
import { CARD_CLAIM, inKitCase, planCardClaim, type CardClaimPlan } from "../claim-slot.ts";
import { DEFAULT_GRADIENT_SHADOW, bandAlphaAt, renderGradientShadow } from "../overlay-gradient.ts";

/** A fake measure: Bootzy-like width, 0.35 cap per character. */
const measure = (text: string, cap: number) => text.length * 0.35 * cap;

describe("O23 claim slot on the artist card", () => {
  it("two lines: kit red 48 px from y 1413, 22 px gap, white 76 px from y 1483, last line on 1559", () => {
    const p = planCardClaim(SAMPLE_ROLL_CALL, measure) as CardClaimPlan;
    assert.equal(p.kind, "two-line");
    assert.deepEqual(p.lines.map((l) => [l.color, l.capPx, l.capTop]), [
      ["red", 48, 1413],
      ["white", 76, 1483],
    ]);
    assert.equal(p.lines[1]!.capTop + p.lines[1]!.capPx, 1559);
    assert.equal(p.lines[1]!.capTop - (p.lines[0]!.capTop + p.lines[0]!.capPx), 22);
    assert.equal(p.k, 1);
    // 31 px under the 0.72 H chin.
    assert.equal(Math.round(p.blockTop - CARD_CLAIM.chinMax * 1920), 31);
  });

  it("one line: FINAL {n} TICKETS red 122 px from y 1437; any other one-line claim white 105 px from y 1454", () => {
    const red = planCardClaim("FINAL 50 TICKETS", measure) as CardClaimPlan;
    assert.deepEqual([red.kind, red.lines[0]!.color, red.lines[0]!.capPx, red.lines[0]!.capTop], ["final-tickets", "red", 122, 1437]);
    const white = planCardClaim("SELL OUT IMMINENT", measure) as CardClaimPlan;
    assert.deepEqual([white.kind, white.lines[0]!.color, white.lines[0]!.capPx, white.lines[0]!.capTop], ["one-line", "white", 105, 1454]);
  });

  it("words verbatim, shown in the kit's case: capitals for Puzzle, the approved words kept exactly; the fit measured on the capitals", () => {
    const seen: string[] = [];
    const p = planCardClaim("General sale live · selling fast", (t, cap) => {
      seen.push(t);
      return measure(t, cap);
    }) as CardClaimPlan;
    assert.equal(p.lines[0]!.text, "GENERAL SALE LIVE · SELLING FAST");
    assert.equal(p.lines[0]!.approvedText, "General sale live · selling fast");
    assert.deepEqual(seen, ["GENERAL SALE LIVE · SELLING FAST"]);
    assert.equal(inKitCase("2nd & 3rd"), "2ND & 3RD");
    assert.equal(inKitCase("istanbul"), "ISTANBUL"); // root locale, not Turkish dotted İ
    assert.equal((planCardClaim("General sale live", measure, "as-approved") as CardClaimPlan).lines[0]!.text, "General sale live");
  });

  it("too wide: every line steps down together, keeping the ratio and the bottom on 1559", () => {
    const long = "EARLY BIRD, 1ST, 2ND, 3RD & 4TH RELEASE SOLD OUT\nFINAL RELEASE RUNNING VERY LOW NOW";
    const p = planCardClaim(long, measure) as CardClaimPlan;
    assert.ok(p.k < 1);
    assert.ok(Math.abs(p.lines[0]!.capPx / p.lines[1]!.capPx - 48 / 76) < 1e-9);
    assert.ok(Math.abs(p.lines[1]!.capTop + p.lines[1]!.capPx - 1559) < 1e-9);
    assert.ok(p.lines.every((l) => l.widthPx <= 864 + 1e-6));
    // The gap steps with the lines: 0.29 × line 2's cap (22 / 76).
    const gap = p.lines[1]!.capTop - (p.lines[0]!.capTop + p.lines[0]!.capPx);
    assert.ok(Math.abs(gap / p.lines[1]!.capPx - 22 / 76) < 1e-9);
    assert.ok(Math.abs(22 / 76 - 0.29) < 0.001);
  });

  it("below the floors (31 px line 1, 50 px one line), or three lines, the card is held", () => {
    assert.deepEqual(planCardClaim(`${"X".repeat(90)}\nFINAL`, measure), { held: "Claim too long for the artist card" });
    assert.deepEqual(planCardClaim("X".repeat(60), measure), { held: "Claim too long for the artist card" });
    assert.deepEqual(planCardClaim("A\nB\nC", measure), { held: "Claim too long for the artist card" });
    // Just above the one-line floor still renders.
    const atFloor = planCardClaim("X".repeat(40), measure) as CardClaimPlan;
    assert.ok(atFloor.lines[0]!.capPx >= 50);
  });

  it("4:5: the last line ends 76 px above the crop's bottom; 1:1: caps 38 / 61 px at y 902 / 958", () => {
    const p = planCardClaim(SAMPLE_ROLL_CALL, measure) as CardClaimPlan;
    assert.equal(RECT_45.bottom - p.bottom, 76);
    const sq = (y: number) => (y - RECT_45.top) * 0.8;
    assert.equal(Math.floor(sq(p.lines[0]!.capTop)), 902);
    assert.equal(Math.floor(sq(p.lines[1]!.capTop)), 958);
    assert.equal(Math.round(p.lines[0]!.capPx * 0.8), 38);
    assert.equal(Math.round(p.lines[1]!.capPx * 0.8), 61);
    assert.equal(Math.round(1080 - sq(p.bottom)), 61);
  });

  it("the face band with a claim: chin ≤ 0.72 H", () => {
    assert.equal(CLAIM_FACE_BAND.chinMax, 0.72);
    const plan = { scale: 0.5, left: 0, top: 0, headTop: 0.53, eyes: 0.6, chin: 0.73, clamped: { x: false, y: false }, extend: { top: 0, left: 0, right: 0 }, faceWidthPx: 240 };
    assert.equal(bandPlacementOk(plan, CLAIM_FACE_BAND), false);
    assert.equal(bandPlacementOk({ ...plan, chin: 0.72 }, CLAIM_FACE_BAND), true);
    // The face floor: 216 px without a claim, 200 px with one.
    assert.equal(bandPlacementOk({ ...plan, chin: 0.72, faceWidthPx: 211 }, CLAIM_FACE_BAND), false);
    assert.equal(bandPlacementOk({ ...plan, chin: 0.72, faceWidthPx: 211 }, CLAIM_FACE_BAND, CLAIM_LIMITS.faceFloorPx), true);
    assert.deepEqual([NO_CLAIM_LIMITS.faceFloorPx, NO_CLAIM_LIMITS.maxTopPx, CLAIM_LIMITS.faceFloorPx, CLAIM_LIMITS.maxTopPx], [216, 576, 200, 634]);
    // A face too high for 576 px of top extension finds a placement within 634 px with a claim.
    const high = { width: 2000, height: 3000 };
    const hf = { eyeX: 1000, eyeY: 980, headTopY: 700, chinY: 1320, box: { width: 470 } };
    const why = { blocker: "" };
    assert.equal(bandExtensionCandidates(high, hf, CLAIM_FACE_BAND, undefined, why, NO_CLAIM_LIMITS).length, 0);
    assert.match(why.blocker, /more than 576 px at the top/);
    const withClaim = bandExtensionCandidates(high, hf, CLAIM_FACE_BAND, undefined, undefined, CLAIM_LIMITS);
    assert.ok(withClaim.length > 0 && withClaim.every((c) => c.extend.top <= 634 && c.extend.top > 576));
    // Extension candidates honour the band: every candidate's chin at or above 0.72 H.
    const photo = { width: 2000, height: 3600 };
    const face = { eyeX: 1000, eyeY: 2200, headTopY: 1900, chinY: 2560, box: { width: 520 } };
    const cands = bandExtensionCandidates(photo, face, CLAIM_FACE_BAND);
    assert.ok(cands.length > 0);
    assert.ok(cands.every((c) => c.chin <= 0.72 + 1e-6));
  });
});

describe("O25 bands: the record's stops (H19, ±1 %)", () => {
  const H = 1920;
  const alphaAt = (y: number) => DEFAULT_GRADIENT_SHADOW.bands.reduce((a, b) => 1 - (1 - a) * (1 - bandAlphaAt(b, y, H)), 0);
  // The layer is sampled at pixel centres: the row whose centre sits on a fraction f of H is y = f·H − 0.5.
  const near = (f: number, want: number) => {
    const got = alphaAt(f * H - 0.5);
    assert.ok(Math.abs(got - want) <= 0.01 * 0.2 + 1e-6, `alpha ${got} at ${f} H, want ${want}`);
  };
  it("9:16 top: 20 % to 0.44, 18 % at 0.4404, 50 % at 0.4603, 10 % at 0.5001, 0 at 0.53", () => {
    near(0.3, 0.2);
    // The record lists 0.4404, its 0.44 + 0.005 × 0.09 = 0.44045 rounded to four places; the fall is 10 % over 0.6 px there.
    near(0.44045, 0.18);
    near(0.4603, 0.1);
    near(0.5001, 0.02);
    near(0.53, 0);
  });
  it("9:16 bottom (amended): 0 at 0.64, 2 % at 0.6599, 10 % at 0.6864, 18 % at 0.6997, 20 % at 0.70, rising to 30 % at 0.78 and below", () => {
    near(0.6599, 0.02);
    near(0.6864, 0.1);
    near(0.6997, 0.18);
    near(0.7, 0.2);
    near(0.74, 0.25);
    near(0.78, 0.3);
    near(0.9, 0.3);
    near(0.9997, 0.3);
    // ≈ 24 % behind the roll-call's line 1 (cap top 0.736 H), 29–30 % behind line 2 (0.772–0.812 H).
    assert.ok(alphaAt(1413) >= 0.24 && alphaAt(1413) <= 0.25);
    assert.ok(alphaAt(1483) >= 0.29 && alphaAt(1559) <= 0.3 + 1e-9);
    // Up to 22.5 % on the lower face at the 0.72 H chin.
    assert.ok(Math.abs(alphaAt(0.72 * H - 0.5) - 0.225) < 1e-6);
  });
  it("zero alpha from 0.53 to 0.64 H", () => {
    for (let y = Math.ceil(0.53 * H); y <= Math.floor(0.64 * H) - 1; y += 1) assert.equal(alphaAt(y), 0);
  });
  it("the 4:5 and 1:1 carry the 9:16 layer: the record's carried stops", () => {
    const layer = renderGradientShadow(DEFAULT_GRADIENT_SHADOW, 1, H);
    const at45 = (f: number) => layer[Math.round(RECT_45.top + f * 1350) * 4 + 3]! / 255;
    const want = [
      [0.4, 0.2],
      [0.4436, 0.1],
      [0.5001, 0.02],
      [0.5427, 0],
      [0.7274, 0.02],
      [0.7651, 0.1],
      [0.7844, 0.2],
      [0.8982, 0.3],
      [0.95, 0.3],
    ] as const;
    for (const [f, a] of want) assert.ok(Math.abs(at45(f) - a) <= 0.006, `4:5 ${f}: ${at45(f)} want ${a}`);
  });
});

describe("O19 amended: the claim box (15 %) and the red line (ink box, 25 %)", () => {
  it("contrast ratios", () => {
    assert.ok(Math.abs(contrastRatio(1, 0) - 21) < 1e-9);
    assert.equal(contrastRatio(0.2, 0.2), 1);
  });

  it("the claim box runs 0.07–0.93 W from the claim's cap top to 0.812 H", () => {
    const r = claimBoxRect(1413);
    assert.ok(Math.abs(r.left - 75.6) < 1e-9 && Math.abs(r.width - 928.8) < 1e-9);
    assert.equal(r.top, 1413);
    assert.equal(r.height, 146);
  });

  it("the red line renders white when more than 25 % of its ink box is below 2:1 against #FE3232", () => {
    const W = 1080;
    const H = 1920;
    const line = { capTop: 1413, capPx: 48, widthPx: 673 };
    // Its own ink box: width + 24 px each side, cap + 12 px above and below.
    assert.deepEqual(redInkBox(line), { left: (1080 - 673) / 2 - 24, top: 1401, width: 721, height: 72 });
    const dark = Buffer.alloc(W * H * 3, 20);
    assert.equal(redLineVerdict(dark, W, 3, line).red, true);
    const coral = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i += 1) coral.set([240, 90, 90], i * 3);
    const v = redLineVerdict(coral, W, 3, line);
    assert.equal(v.red, false);
    assert.ok(v.share > 0.1);
    assert.ok(contrastRatio(relativeLuminance(240, 90, 90), relativeLuminance(254, 50, 50)) < 2);
    // 20 % coral inside the ink box passes (≤ 25 %); the rest of the row doesn't count.
    const mixed = Buffer.alloc(W * H * 3, 20);
    const box = redInkBox(line);
    for (let y = Math.round(box.top); y < Math.round(box.top + box.height); y += 1) for (let x = Math.round(box.left); x < Math.round(box.left + 0.2 * box.width); x += 1) mixed.set([240, 90, 90], (y * W + x) * 3);
    for (let y = 1300; y < 1600; y += 1) for (let x = 0; x < 100; x += 1) mixed.set([240, 90, 90], (y * W + x) * 3);
    assert.equal(redLineVerdict(mixed, W, 3, line).red, true);
    assert.equal(CARD_CLAIM.redInk.max, 0.25);
    assert.equal(CARD_CLAIM.claimBoxMax, 0.15);
    assert.equal(CARD_CLAIM.redToWhite, "claim line 1 in white — red unreadable on this photo");
    assert.equal(lowContrastAgainst(dark, W, 3, { left: 0, top: 0, width: 10, height: 10 }, 0, 3), 1);
  });

  it("one subject: faces ≥ ½ the largest's width count; any face in the text or claim box fails", () => {
    const place = { scale: 1, left: 0, top: 0 };
    const main = { x: 400, y: 1050, width: 280, height: 330 };
    assert.equal(subjectVerdict([main, { x: 50, y: 1700, width: 60, height: 60 }], place, null).pass, true);
    assert.equal(subjectVerdict([main, { x: 50, y: 1100, width: 150, height: 150 }], place, null).counted, 2);
    // A small face inside the text box (0.188–0.512 H) fails, whatever its size.
    assert.equal(subjectVerdict([main, { x: 500, y: 600, width: 30, height: 30 }], place, null).pass, false);
    // The placed face's detector box runs below its chin; it is clipped at the chin landmark for the claim box.
    const low = { ...main, height: 380 }; // bottom at y 1430, past the claim's top 1413
    assert.equal(subjectVerdict([low], place, 1413).pass, false);
    assert.equal(subjectVerdict([low], place, 1413, undefined, { index: 0, chinY: 1382 }).pass, true);
  });
});

describe("the approved-claim gate and the watermark", () => {
  const now = new Date("2026-11-10T12:00:00Z");
  const row = (o: Partial<WarningRow>): WarningRow => ({ id: "r", claim: "General sale live · selling fast", format: "9:16", state: "held", approved_by: null, approved_at: null, runs_from: null, runs_to: null, ...o });

  it("held proposals are not claims; an approved claim in force is", () => {
    assert.equal(approvedClaim([row({})], now).kind, "none");
    const ok = approvedClaim([row({ state: "live", approved_by: "u", approved_at: "2026-11-10T10:00:00Z" })], now);
    assert.equal(ok.kind, "approved");
    if (ok.kind === "approved") assert.equal(ok.claim, "General sale live · selling fast");
  });

  it("pulled back, finished, out of its window or missing an approver: not in force", () => {
    const a = { approved_by: "u", approved_at: "2026-11-10T10:00:00Z" };
    for (const r of [row({ ...a, state: "back_to_held" }), row({ ...a, state: "done" }), row({ ...a, state: "live", runs_to: "2026-11-10T11:00:00Z" }), row({ ...a, state: "scheduled", runs_from: "2026-11-11T00:00:00Z" }), row({ state: "live", approved_at: a.approved_at })]) {
      assert.equal(approvedClaim([r], now).kind, "none");
    }
  });

  it("the newest approval wins", () => {
    const got = approvedClaim([row({ id: "old", claim: "A", state: "live", approved_by: "u", approved_at: "2026-11-09T10:00:00Z" }), row({ id: "new", claim: "B", state: "locked", approved_by: "u", approved_at: "2026-11-10T09:00:00Z" })], now);
    assert.equal(got.kind === "approved" && got.id, "new");
  });

  it("no approved claim: watermarked and not exportable; the sample is always watermarked; approved or no claim: clean", () => {
    assert.equal(watermarkFor({ kind: "none", why: "x" }), WATERMARK.notApproved);
    assert.equal(WATERMARK.notApproved, "DRAFT · claim not approved");
    assert.equal(watermarkFor({ kind: "sample", claim: SAMPLE_ROLL_CALL }), "DRAFT · sample claim");
    assert.equal(watermarkFor({ kind: "approved", id: "r", claim: "x", format: "9:16", approvedAt: "t" }), null);
    assert.equal(watermarkFor({ kind: "off" }), null);
    assert.throws(() => assertExportable({ watermark: WATERMARK.notApproved }), NotExportableError);
    assert.doesNotThrow(() => assertExportable({ watermark: null }));
  });
});
