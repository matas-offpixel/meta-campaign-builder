import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PUZZLE_FLOATING_T2 } from "../overlay-kits.ts";
import { applyDrop, claimKind, inCase, isNumberToken, layoutClaim, planDetails, planLineup, planLogo, planT2Claim } from "../t2-message.ts";

/** A fake measure: Bootzy-like width, 0.35 cap per character. */
const measure = (text: string, cap: number) => text.length * 0.35 * cap;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

describe("the floating kit's T2 table (O4, O8, O12)", () => {
  it("carries the record's ratios", () => {
    const k = PUZZLE_FLOATING_T2;
    assert.deepEqual(k.claim.steps.map((s) => s.cap), [0.06, 0.052]);
    assert.equal(k.claim.steps[0]!.pitch, 0.0875);
    assert.equal(k.claim.maxWidth, 0.86);
    assert.equal(k.claim.centre, 0.5);
    assert.equal(k.claim.numberToken, 1.5);
    assert.equal(k.claim.qualifier, 0.6);
    assert.deepEqual([k.lineup.cap, k.lineup.pitch, k.lineup.capTop, k.lineup.rightInset, k.lineup.maxLines], [0.026, 0.03, 0.219, 0.143, 6]);
    assert.deepEqual([k.details.cap, k.details.centre, k.details.leftInset], [0.0266, 0.767, 0.143]);
    assert.equal(k.logo.width, 0.15);
    assert.deepEqual([...k.dropOrder], ["TICKETS", "NOW", "number form"]);
    assert.deepEqual(k.colours, { white: "#FFFFFF", kitRed: "#FE3232", coral: "#FF6876" });
  });
});

describe("T2 claim words", () => {
  it("a number token is a line that is only the number (O4)", () => {
    for (const t of ["FINAL 100", "£16.50", "90%", "100"]) assert.ok(isNumberToken(t), t);
    for (const t of ["FINAL 100 3RD RELEASE TICKETS", "3RD RELEASE 90% SOLD OUT", "GENERAL SALE LIVE"]) assert.ok(!isNumberToken(t), t);
  });

  it("the roll-call is two lines whose first names what sold out", () => {
    assert.equal(claimKind(["EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT", "3RD RELEASE SELLING FAST"]), "roll-call");
    assert.equal(claimKind(["3RD RELEASE TICKETS", "NOW AVAILABLE"]), "plain");
    assert.equal(claimKind(["GENERAL SALE LIVE"]), "plain");
  });

  it("O8's drops: TICKETS, NOW, then the release's number form only while RELEASE stays on the frame", () => {
    assert.deepEqual(applyDrop(["FINAL 100 3RD RELEASE TICKETS", "NOW AVAILABLE"], "TICKETS"), ["FINAL 100 3RD RELEASE", "NOW AVAILABLE"]);
    assert.deepEqual(applyDrop(["3RD RELEASE TICKETS", "NOW AVAILABLE"], "NOW"), ["3RD RELEASE TICKETS", "AVAILABLE"]);
    assert.equal(applyDrop(["GENERAL SALE LIVE"], "TICKETS"), null);
    // The only RELEASE on the frame is kept.
    assert.equal(applyDrop(["3RD RELEASE SELLING FAST"], "number form"), null);
    assert.deepEqual(applyDrop(["EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT", "3RD RELEASE SELLING FAST"], "number form"), ["EARLY BIRD, 1ST & 2ND SOLD OUT", "3RD RELEASE SELLING FAST"]);
  });

  it("claims display in the kit's case; the approved words are kept exactly", () => {
    const p = planT2Claim({ approved: "General sale live" }, measure);
    assert.deepEqual(p.approvedLines, ["General sale live"]);
    assert.deepEqual(p.layout!.lines.map((l) => l.text), ["GENERAL SALE LIVE"]);
    assert.equal(inCase("3rd release selling fast"), "3RD RELEASE SELLING FAST");
  });
});

describe("T2 claim layout", () => {
  it("roll-call: line 2 white at the step's cap, line 1 kit red at 0.625 of it, 0.29 of line 2's cap apart, centred on 0.50 H", () => {
    const lay = layoutClaim(["EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT", "3RD RELEASE SELLING FAST"], "roll-call", 0, measure);
    const [l1, l2] = lay.lines;
    close(l2!.capPx, 0.06 * 1920);
    close(l1!.capPx, 0.06 * 1920 * (0.217 / 0.347));
    assert.deepEqual([l1!.color, l2!.color], ["red", "white"]);
    close(l2!.capTop - (l1!.capTop + l1!.capPx), (22 / 76) * l2!.capPx);
    close((lay.blockTop + lay.blockBottom) / 2, 960);
  });

  it("plain two lines keep O4's 8.75 % H pitch at step 0 and scale it at step 1", () => {
    const s0 = layoutClaim(["3RD RELEASE TICKETS", "NOW AVAILABLE"], "plain", 0, measure);
    close(s0.lines[1]!.capTop - s0.lines[0]!.capTop, 0.0875 * 1920);
    const s1 = layoutClaim(["3RD RELEASE TICKETS", "NOW AVAILABLE"], "plain", 1, measure);
    close(s1.lines[0]!.capPx, 0.052 * 1920);
    close(s1.lines[1]!.capTop - s1.lines[0]!.capTop, 0.0875 * (0.052 / 0.06) * 1920);
  });

  it("a number alone on its line draws at 1.5×; inside a sentence at sentence size (O4)", () => {
    const lay = layoutClaim(["FINAL 100", "3RD RELEASE TICKETS"], "plain", 0, measure);
    close(lay.lines[0]!.capPx, 1.5 * 0.06 * 1920);
    assert.ok(lay.lines[0]!.numberToken);
    close(lay.lines[1]!.capPx, 0.06 * 1920);
    const inside = layoutClaim(["FINAL 100 3RD RELEASE TICKETS"], "plain", 0, measure);
    close(inside.lines[0]!.capPx, 0.06 * 1920);
  });

  it("FINAL {n} TICKETS alone is kit red; the qualifier sits under the claim at 0.6×", () => {
    assert.equal(layoutClaim(["FINAL 50 TICKETS"], "plain", 0, measure).lines[0]!.color, "red");
    const q = layoutClaim(["£16.50 EARLY ENTRY"], "plain", 0, measure, "ARRIVE BEFORE 4PM");
    assert.equal(q.lines[1]!.role, "qualifier");
    close(q.lines[1]!.capPx, 0.6 * 0.06 * 1920);
  });
});

describe("the O8 ladder on T2", () => {
  it("a short claim fits at step 0 on one line", () => {
    const p = planT2Claim({ approved: "General sale live" }, measure);
    assert.equal(p.chosen, 0);
    assert.equal(p.meter, "step 0 of 1 · 1 line");
    assert.ok(p.canApprove);
  });

  it("a one-line claim too wide for one line breaks onto two at the same step", () => {
    const p = planT2Claim({ approved: "3rd release tickets now available selling fast" }, measure);
    const a = p.attempts[p.chosen!]!;
    assert.equal(a.step, 0);
    assert.ok(a.split);
    assert.equal(a.lines.length, 2);
    assert.equal(p.meter, "step 0 of 1 · 2 lines");
  });

  it("a roll-call too wide at 6 % H steps to 5.2 % H; it is never re-broken onto a third line", () => {
    // 0.35 × 115.2 px × 24 chars = 968 px > 929; at 99.84 px it is 839 px.
    const p = planT2Claim({ approved: "Early bird, 1st & 2nd release sold out\n3rd release selling fast" }, measure);
    assert.equal(p.kind, "roll-call");
    assert.equal(p.attempts[p.chosen!]!.step, 1);
    assert.equal(p.meter, "step 1 of 1 · 2 lines");
    assert.ok(p.attempts.every((a) => a.lines.length === 2));
  });

  it("past the last step the words shorten in order, and the plan says what went", () => {
    const p = planT2Claim({ approved: "Early bird, 1st, 2nd & 3rd release sold out\nFinal 100 final release tickets" }, (t, cap) => t.length * 0.4 * cap);
    assert.match(p.meter, /^step [01] of 1 · 2 lines · dropped /);
    assert.ok(p.attempts[p.chosen!]!.dropped.length >= 1);
    assert.equal(p.attempts[p.chosen!]!.dropped[0], "TICKETS");
    assert.deepEqual(p.approvedLines, ["Early bird, 1st, 2nd & 3rd release sold out", "Final 100 final release tickets"]);
  });

  it("with nothing left to drop it can't shorten and has no Approve", () => {
    const p = planT2Claim({ approved: "Early bird, 1st, 2nd, 3rd, 4th, 5th, 6th & 7th release sold out\nFinal 100 final release tickets now" }, measure);
    assert.equal(p.chosen, null);
    assert.equal(p.canApprove, false);
    assert.equal(p.held, "can't shorten");
    assert.match(p.meter, / of 929 px · can't shorten$/);
    assert.deepEqual(p.attempts[p.attempts.length - 1]!.dropped, ["TICKETS", "NOW", "number form"]);
  });

  it("never a third line", () => {
    const p = planT2Claim({ approved: "a\nb\nc" }, measure);
    assert.equal(p.canApprove, false);
    assert.equal(p.layout, null);
  });

  it("exhaust lists every state even after one fits", () => {
    const p = planT2Claim({ approved: "General sale live" }, measure, PUZZLE_FLOATING_T2, undefined, { exhaust: true });
    assert.equal(p.chosen, 0);
    assert.ok(p.attempts.length >= 2);
  });
});

describe("T2 corners (O4, O9)", () => {
  it("lineup: top-right, right-aligned at 14.3 % W in, cap 2.6 % H, pitch 3 % H, from 21.9 % H", () => {
    const l = planLineup(["Enzo Siragusa", "Luke Dean", "Reeshy"], measure);
    for (const line of l) close(line.left + line.widthPx, 1080 * (1 - 0.143));
    close(l[0]!.capTop, 0.219 * 1920);
    close(l[1]!.capTop - l[0]!.capTop, 0.03 * 1920);
    close(l[0]!.capPx, 0.026 * 1920);
    assert.equal(l[0]!.text, "ENZO SIRAGUSA");
  });

  it("lineup: at most six lines, the sixth \"& MORE\"", () => {
    const l = planLineup(["A", "B", "C", "D", "E", "F", "G"], measure);
    assert.equal(l.length, 6);
    assert.equal(l[5]!.text, "& MORE");
  });

  it("details: two lines bottom-left at 14.3 % W, centred on 0.767 H, coral on \">\"", () => {
    const d = planDetails(["Sunday 27th December", "Circuit > Southampton"], measure);
    close(d[0]!.left, 0.143 * 1080);
    close((d[0]!.capTop + d[1]!.capTop + d[1]!.capPx) / 2, 0.767 * 1920);
    assert.deepEqual(d[1]!.runs, [{ text: "CIRCUIT ", coral: false }, { text: ">", coral: true }, { text: " SOUTHAMPTON", coral: false }]);
  });

  it("logo: the lockup by its ink box at 15 % W, centred on the details' line", () => {
    const at = planLogo({ width: 1290, height: 388 });
    close(at.width, 162);
    close(at.top + at.height / 2, 0.767 * 1920);
    close(at.left + at.width, 1080 * (1 - 0.143));
  });
});
