import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WATERMARK_STAMP, watermarkCorner, CLAIM_FACE_BAND, CLAIM_LIMITS, NO_CLAIM_LIMITS, bandExtensionCandidates, bandPlacementOk, claimBoxRect, contrastRatio, lowContrastAgainst, redInkBox, redLineVerdict, subjectVerdict } from "../artist-card-claim.ts";
import { RECT_45, relativeLuminance } from "../artist-card.ts";
import { NotExportableError, SAMPLE_ROLL_CALL, SAMPLE_ROLL_CALL_RELEASES, WATERMARK, fixtureRelease as r, approvedClaim, assertExportable, watermarkFor, type WarningRow } from "../claim-approval.ts";
import { CARD_CLAIM, DROP_ORDER, inKitCase, planCardClaim, planClaim, rollCallStates, splitTwo, type CardClaimPlan, type ClaimPlan } from "../claim-slot.ts";
import { rollCallWords } from "../../releases/roll-call.ts";
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
    const long = "EARLY BIRD, 1ST, 2ND, 3RD & 4TH RELEASE SOLD OUT\nFINAL RELEASE SELLING VERY FAST NOW";
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

describe("H28: the roll-call's line 2 and its shortening (A21, O27)", () => {
  // lib/releases/roll-call.ts (merged in #1158), read through its import: these are its outputs.
  const ladder = [
    { position: 1, triggerKind: "state" as const, triggerValue: "on_sale", claimTemplate: "{release} live", options: {} },
    { position: 2, triggerKind: "state_days" as const, triggerValue: "selling_fast", claimTemplate: "{release} selling fast", options: { days: 14 } },
    { position: 3, triggerKind: "count_pct" as const, triggerValue: "75", claimTemplate: "{release} 75% sold", options: {} },
    { position: 4, triggerKind: "count_pct" as const, triggerValue: "90", claimTemplate: "{release} 90% sold", options: { wording: "final_x" as const, alt: "final X" } },
    { position: 5, triggerKind: "state" as const, triggerValue: "final_x", claimTemplate: "final {n}", options: {} },
  ];
  const now = "2026-11-10";
  const two = [r(1, "Early bird", "sold_out"), r(2, "1st release", "sold_out")];

  it("the sample is resolved from releases: line 2 is the live release at SELLING FAST, never lower", () => {
    assert.equal(SAMPLE_ROLL_CALL, "EARLY BIRD, 1ST, 2ND & 3RD RELEASE SOLD OUT\nFINAL RELEASE SELLING FAST");
    assert.equal(rollCallWords(SAMPLE_ROLL_CALL_RELEASES, { ladder, nowIso: now }).line2, "FINAL RELEASE SELLING FAST");
  });

  it("line 2 is the live release's furthest met rung, as #1158's generator gives it", () => {
    const cases: [ReturnType<typeof r>, string, string][] = [
      [r(3, "2nd release", "on_sale"), "2ND RELEASE SELLING FAST", "2ND RELEASE SELLING FAST"],
      [r(3, "2nd release", "selling_fast", { stateAt: "2026-10-20" }), "2ND RELEASE SELLING FAST", "2ND RELEASE SELLING FAST"],
      [r(3, "2nd release", "selling_fast", { capacity: 400, sold: 320 }), "2ND RELEASE SELLING FAST", "2ND RELEASE 75% SOLD"],
      [r(3, "2nd release", "final_x", { remaining: 100 }), "FINAL 100 2ND RELEASE TICKETS", "FINAL 100 2ND RELEASE TICKETS"],
    ];
    for (const [live, plain, laddered] of cases) {
      const w = rollCallWords([...two, live]);
      assert.equal(w.line1, "EARLY BIRD & 1ST RELEASE SOLD OUT");
      assert.equal(w.line2, plain);
      assert.equal(rollCallWords([...two, live], { ladder, nowIso: now }).line2, laddered);
    }
  });

  it("no RUNNING LOW anywhere: not in the sample, the generator's words, or any shortened state", () => {
    const live = ["on_sale", "selling_fast", "final_x"] as const;
    const all: string[] = [SAMPLE_ROLL_CALL];
    for (const st of live) {
      const w = rollCallWords([...two, r(3, "Final release", st, { remaining: 40 })], { ladder, nowIso: now });
      all.push(w.claim, ...rollCallStates(w.line1, w.line2).flatMap((s) => [s.line1, s.line2]));
    }
    assert.ok(all.every((t) => !/running\s+low/i.test(t)), all.join(" | "));
  });

  it("O27: line 1 is never shortened and keeps RELEASE; line 2 takes TICKETS, NOW, then the number form", () => {
    const line1 = "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT";
    const states = rollCallStates(line1, "FINAL 100 3RD RELEASE TICKETS NOW");
    assert.deepEqual(states.map((s) => s.line2), ["FINAL 100 3RD RELEASE TICKETS NOW", "FINAL 100 3RD RELEASE NOW", "FINAL 100 3RD RELEASE", "FINAL 100 3RD"]);
    assert.deepEqual(states.map((s) => s.dropped), [[], ["TICKETS"], ["TICKETS", "NOW"], [...DROP_ORDER]]);
    assert.ok(states.every((s) => s.line1 === line1 && /\bRELEASE\b/.test(s.line1)));
    // Only an ordinal has a number form.
    assert.deepEqual(rollCallStates(line1, "FINAL RELEASE SELLING FAST").map((s) => s.line2), ["FINAL RELEASE SELLING FAST"]);
    // Line 1 without RELEASE on the frame: line 2 never takes the number form.
    assert.deepEqual(rollCallStates("EARLY BIRD & PRESALE SOLD OUT", "3RD RELEASE SELLING FAST").map((s) => s.line2), ["3RD RELEASE SELLING FAST"]);
  });

  it("O27 on the artist card: below the floor a roll-call takes line 2's drops before it is held; line 1 is never touched", () => {
    const claim = "Early bird, 1st & 2nd release sold out\nFinal 100 3rd release tickets now selling";
    // Line 2's width alone decides: as approved it is under the floor; without TICKETS it is over it.
    const m = (t: string, cap: number) => (t.startsWith("EARLY") ? 100 : t.includes("TICKETS") ? 3000 : 1200) * (cap / 76);
    const p = planCardClaim(claim, m) as CardClaimPlan;
    assert.deepEqual(p.dropped, ["TICKETS"]);
    assert.equal(p.lines[0]!.text, "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT");
    assert.equal(p.lines[1]!.text, "FINAL 100 3RD RELEASE NOW SELLING");
    assert.equal(p.lines[1]!.approvedText, "Final 100 3rd release tickets now selling");
    const held = planCardClaim(claim, (t, cap) => (t.startsWith("EARLY") ? 5000 : 100) * (cap / 76));
    assert.deepEqual(held, { held: CARD_CLAIM.tooLong });
  });

  it("O35 on T1: past step 2 a plain claim takes TICKETS, then NOW, then the ordinal number form, in that order, before it is refused", () => {
    const text = "3rd release tickets now selling fast with final release up next at noon on friday";
    const ok = { approvedBy: "m", approvedAt: "2026-11-10" };
    const p = planClaim({ kind: "claim", text, ...ok }) as ClaimPlan;
    assert.equal(p.step, 2);
    assert.deepEqual(p.dropped, ["TICKETS", "NOW", "number form"]);
    // O28 on T1 (design, #1163): the break never falls inside "FINAL RELEASE".
    assert.deepEqual(p.lines.map((l) => l.text), ["3RD SELLING FAST WITH FINAL RELEASE", "UP NEXT AT NOON ON FRIDAY"]);
    // No T1 split ever ends a line with FINAL when the next word is RELEASE or a number, wherever FINAL falls.
    const filler = "TICKETS ON SALE NOW AT THE DOOR FOR THE LAST FEW DAYS OF THE YEAR".split(" ");
    for (const tail of ["FINAL RELEASE", "FINAL 100", "FINAL £16.50"]) {
      for (let k = 0; k <= filler.length; k += 1) {
        const words = [...filler.slice(0, k), ...tail.split(" "), ...filler.slice(k)];
        const two = splitTwo(words.join(" "));
        if (!two) continue;
        const next = two[1].split(" ")[0]!;
        assert.ok(!(/\bFINAL$/.test(two[0]) && (next === "RELEASE" || /^[£$€]?\d/.test(next))), two.join(" | "));
      }
    }
    const refused = planClaim({ kind: "claim", text: `${text} and saturday and sunday too`, ...ok });
    assert.match((refused as { blocker: string }).blocker, /can't shorten/);
  });

  it("O35 on the artist card: below its floor a plain claim takes TICKETS, then NOW, then the number form, before it is held", () => {
    const seen: string[] = [];
    const m = (t: string, cap: number) => {
      seen.push(t);
      return (/TICKETS|\bNOW\b|3RD RELEASE/.test(t) ? 2400 : 1000) * (cap / 105);
    };
    const p = planCardClaim("3rd release tickets now, final release next", m) as CardClaimPlan;
    assert.deepEqual(p.dropped, ["TICKETS", "NOW", "number form"]);
    assert.equal(p.lines[0]!.text, "3RD, FINAL RELEASE NEXT");
    assert.equal(p.lines[0]!.approvedText, "3rd release tickets now, final release next");
    assert.deepEqual(seen, ["3RD RELEASE TICKETS NOW, FINAL RELEASE NEXT", "3RD RELEASE NOW, FINAL RELEASE NEXT", "3RD RELEASE, FINAL RELEASE NEXT", "3RD, FINAL RELEASE NEXT"]);
    // Nothing left to drop: held.
    assert.deepEqual(planCardClaim("3rd release tickets now, final release next", () => 5000), { held: CARD_CLAIM.tooLong });
  });

  it("O35 on T1: a plain claim past step 2 takes TICKETS, then NOW, before it can't shorten", () => {
    // At step 2 (0.034 H) a line holds 37 characters in 0.8 W: the most even break gives 41 / 34 as approved, 33 / 34 without TICKETS.
    const p = planClaim({ kind: "claim", text: "Final 100 3rd release tickets now selling fast across the whole city tonight", approvedBy: "m", approvedAt: "2026-11-10" }) as ClaimPlan;
    assert.ok(!("blocker" in p));
    assert.ok((p.dropped ?? []).length >= 1);
    assert.equal(p.dropped![0], "TICKETS");
    assert.ok(p.lines.every((l) => !/TICKETS/.test(l.text)));
    const never = planClaim({ kind: "claim", text: "x ".repeat(60), approvedBy: "m", approvedAt: "2026-11-10" });
    assert.match((never as { blocker: string }).blocker, /can't shorten/);
  });

  it("O35 on the artist card: a one-line claim below its floor drops TICKETS before it is held", () => {
    const m = (t: string, cap: number) => (t.includes("TICKETS") ? 2400 : 1400) * (cap / 105);
    const p = planCardClaim("Final 100 3rd release tickets now", m) as CardClaimPlan;
    assert.deepEqual(p.dropped, ["TICKETS"]);
    assert.equal(p.lines[0]!.text, "FINAL 100 3RD RELEASE NOW");
    assert.equal(p.lines[0]!.approvedText, "Final 100 3rd release tickets now");
    // The size steps come first: a claim that fits above the floor keeps every word.
    const scaled = planCardClaim("Final 100 3rd release tickets now", (t, cap) => 1000 * (cap / 105)) as CardClaimPlan;
    assert.deepEqual(scaled.dropped, []);
    assert.ok(scaled.k < 1);
  });

  it("the sample roll-call fits T1 and the card as approved", () => {
    const [soldOut, live] = SAMPLE_ROLL_CALL.split("\n") as [string, string];
    const t1 = planClaim({ kind: "roll-call", soldOut, live, approvedBy: "m", approvedAt: "2026-11-10" }) as ClaimPlan;
    assert.deepEqual(t1.dropped, []);
    assert.deepEqual((planCardClaim(SAMPLE_ROLL_CALL, measure) as CardClaimPlan).dropped, []);
  });
});

describe("the draft stamp sits in a free corner, off the claim and the lockup", () => {
  const size = { width: 1080, height: 1920 };
  const within = { left: 0, top: RECT_45.top, width: 1080, height: RECT_45.bottom - RECT_45.top };
  const stamp = { width: 300, height: 50 };
  it("the first clear corner, inside the 4:5 rectangle", () => {
    const at = watermarkCorner(stamp, within, [], size);
    const m = Math.round(WATERMARK_STAMP.margin * 1080);
    assert.deepEqual([at.left, at.top], [m, RECT_45.top + m]);
  });
  it("skips a corner that would touch the type, the claim or the lockup", () => {
    const name = { left: 20, top: 300, width: 600, height: 200 };
    const lockup = { left: 700, top: 300, width: 300, height: 120 };
    const at = watermarkCorner(stamp, within, [name, lockup], size);
    assert.ok(at.top > 960, "a bottom corner");
    const claim = { left: 0, top: 1500, width: 600, height: 120 };
    const at2 = watermarkCorner(stamp, within, [name, lockup, claim], size);
    assert.ok(at2.left > 540 && at2.top > 960, "bottom-right");
  });
});
