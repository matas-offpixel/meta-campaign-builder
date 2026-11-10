import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixtureRelease as r, rollCallWords } from "../roll-call-words.ts";
import { PUZZLE_FLOATING_T2, T2_INVENTED } from "../overlay-kits.ts";
import { sampleStops } from "../t2-render.ts";
import { applyDrop, bestSplit, breakAllowed, claimKind, claimSlot, inCase, isNumberToken, layoutClaim, planDetails, planLineup, planLogo, planT2Claim } from "../t2-message.ts";

/** A fake measure: Bootzy-like width, 0.35 cap per character. */
const measure = (text: string, cap: number) => text.length * 0.35 * cap;
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

describe("the floating kit's T2 table (O4, O8, O12)", () => {
  it("carries the record's ratios", () => {
    const k = PUZZLE_FLOATING_T2;
    assert.deepEqual(k.claim.steps.map((s) => s.cap), [0.06, 0.052]);
    assert.equal(k.claim.steps[0]!.pitch, 0.0875);
    assert.equal(k.claim.maxWidth, 0.86);
    assert.deepEqual(k.claim.panelInset, { x: 0.04, y: 0.02 });
    assert.equal(k.panel, true);
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
    // Line 1 fits; line 2 is too wide until TICKETS goes.
    const p = planT2Claim({ approved: "Early bird, 1st, 2nd & 3rd release sold out\nFinal 100 final release tickets" }, (t) => (t.startsWith("EARLY") ? 500 : t.includes("TICKETS") ? 1000 : 800));
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
    // "FINAL RELEASE" has no number form, so line 2's last state drops TICKETS and NOW.
    assert.deepEqual(p.attempts[p.attempts.length - 1]!.dropped, ["TICKETS", "NOW"]);
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

// ─── Issue 4 (H27–H30) ──────────────────────────────────────────────────────

/** The H26 fixtures, from releases through the generator (A14, A21). */
const six = rollCallWords([
  r(1, "Early bird", "sold_out"), r(2, "1st release", "sold_out"), r(3, "2nd release", "sold_out"), r(4, "3rd release", "sold_out"),
  r(5, "4th release", "sold_out"), r(6, "5th release", "sold_out"), r(7, "6th release", "sold_out"), r(8, "Final release", "final_x", { remaining: 100 }),
]).claim;
const sample = rollCallWords([r(1, "Early bird", "sold_out"), r(2, "1st release", "sold_out"), r(3, "2nd release", "sold_out"), r(4, "3rd release", "selling_fast")]).claim;
const longest = rollCallWords([r(1, "Early bird", "sold_out"), r(2, "1st release", "sold_out"), r(3, "2nd release", "sold_out"), r(4, "3rd release", "sold_out"), r(5, "Final release", "final_x", { remaining: 100 })]).claim;
/** Puzzle's taped panel ink at its placed size, roughly (0.09–0.90 W). */
const panelInk = { left: 97, top: 335, width: 875, height: 1246 };

describe("O26: the claim slot is the panel", () => {
  it("the panel's ink box less 0.04 W each side and 0.02 H top and bottom; never wider than 86 % W", () => {
    const s = claimSlot(panelInk);
    close(s.left, 97 + 0.04 * 1080);
    close(s.right, 97 + 875 - 0.04 * 1080);
    close(s.top, 335 + 0.02 * 1920);
    close(s.bottom, 335 + 1246 - 0.02 * 1920);
    assert.ok(s.fromPanel);
    const wide = claimSlot({ left: 0, top: 0, width: 1080, height: 1920 });
    close(wide.right - wide.left, 0.86 * 1080);
    close((wide.left + wide.right) / 2, 540);
  });

  it("a kit with no panel keeps O4's 86 % W", () => {
    const s = claimSlot(null);
    close(s.right - s.left, 0.86 * 1080);
    assert.equal(s.fromPanel, false);
  });

  it("steps, drops and the meter measure against the slot: \"{widest} of {slot} px\"", () => {
    const slot = claimSlot(panelInk);
    const w = Math.round(slot.right - slot.left);
    const p = planT2Claim({ approved: six }, measure, PUZZLE_FLOATING_T2, undefined, { slot });
    assert.equal(p.maxWidthPx, slot.right - slot.left);
    assert.match(p.meter, new RegExp(` of ${w} px · can't shorten$`));
    const ok = planT2Claim({ approved: "General sale live" }, measure, PUZZLE_FLOATING_T2, undefined, { slot });
    assert.equal(ok.layout!.centreX, (slot.left + slot.right) / 2);
    assert.ok(ok.attempts[ok.chosen!]!.widths.every((x) => x <= w));
  });

  it("a block taller than the slot doesn't fit, whatever its width", () => {
    const short = { left: 0, top: 940, right: 1080, bottom: 980, fromPanel: true };
    const p = planT2Claim({ approved: "General sale live" }, measure, PUZZLE_FLOATING_T2, undefined, { slot: short });
    assert.equal(p.canApprove, false);
    assert.match(p.meter, /px tall · can't shorten$/);
  });
});

describe("O27: the roll-call on T2", () => {
  it("the six-release fixture is \"can't shorten\" against the panel slot, and has no Approve", () => {
    const p = planT2Claim({ approved: six }, measure, PUZZLE_FLOATING_T2, undefined, { slot: claimSlot(panelInk) });
    assert.equal(p.kind, "roll-call");
    assert.equal(p.held, "can't shorten");
    assert.equal(p.canApprove, false);
  });

  it("no state of any roll-call drops RELEASE from line 1, and line 1 is never shortened", () => {
    for (const claim of [sample, longest, six, "Early bird, 1st & 2nd release sold out\nFinal 100 3rd release tickets now"]) {
      const p = planT2Claim({ approved: claim }, (t, cap) => t.length * 0.5 * cap, PUZZLE_FLOATING_T2, undefined, { exhaust: true, slot: claimSlot(panelInk) });
      const line1 = inCase(claim.split("\n")[0]!);
      assert.ok(p.attempts.length > 0);
      for (const a of p.attempts) {
        assert.equal(a.lines[0], line1);
        assert.match(a.lines[0]!, /\bRELEASE\b/);
        assert.ok(a.layout.lines.length === 2 && !a.split);
      }
    }
  });

  it("line 2 takes TICKETS, NOW, then the number form", () => {
    const p = planT2Claim({ approved: "Early bird, 1st & 2nd release sold out\nFinal 100 3rd release tickets now" }, (t, cap) => t.length * 0.5 * cap, PUZZLE_FLOATING_T2, undefined, { exhaust: true });
    const seen = [...new Set(p.attempts.map((a) => a.lines[1]))];
    assert.deepEqual(seen, ["FINAL 100 3RD RELEASE TICKETS NOW", "FINAL 100 3RD RELEASE NOW", "FINAL 100 3RD RELEASE", "FINAL 100 3RD"]);
  });

  it("no RUNNING LOW anywhere: the fixtures, every state, the kit's notes", () => {
    const words: string[] = [sample, longest, six];
    for (const claim of words.slice()) {
      for (const a of planT2Claim({ approved: claim }, measure, PUZZLE_FLOATING_T2, undefined, { exhaust: true }).attempts) words.push(...a.lines);
    }
    words.push(...T2_INVENTED.map((i) => i.value));
    assert.ok(words.every((w) => !/running\s+low/i.test(w)));
    assert.equal(sample, "EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT\n3RD RELEASE SELLING FAST");
  });
});

describe("O28: breaking a one-line claim", () => {
  it("\"FINAL 50 2ND RELEASE TICKETS\" never breaks between 2ND and RELEASE", () => {
    const words = "FINAL 50 2ND RELEASE TICKETS".split(" ");
    assert.equal(breakAllowed(words, 3), false);
    // Widths that would make 2ND | RELEASE the most even break.
    const m = (t: string) => ({ "FINAL 50 2ND": 500, "RELEASE TICKETS": 520, "FINAL 50": 300, "2ND RELEASE TICKETS": 700, "FINAL 50 2ND RELEASE": 650, TICKETS: 250, FINAL: 150, "50 2ND RELEASE TICKETS": 800 })[t] ?? 1000;
    assert.deepEqual(bestSplit(words.join(" "), 100, 25, m), ["FINAL 50 2ND RELEASE", "TICKETS"]);
    const p = planT2Claim({ approved: "Final 50 2nd release tickets" }, (t, cap) => t.length * 0.5 * cap, PUZZLE_FLOATING_T2, undefined, { exhaust: true });
    for (const a of p.attempts.filter((x) => x.split)) assert.ok(!/\b2ND$/.test(a.lines[0]!) && !/^RELEASE\b/.test(a.lines[1]!), a.lines.join(" | "));
  });

  it("never inside EARLY BIRD, GENERAL SALE, or the event's own release names", () => {
    assert.equal(breakAllowed("EARLY BIRD SELLING FAST".split(" "), 1), false);
    assert.equal(breakAllowed("GENERAL SALE LIVE".split(" "), 1), false);
    assert.equal(breakAllowed("GENERAL SALE LIVE".split(" "), 2), true);
    assert.equal(breakAllowed("SUMMER PASS SELLING FAST".split(" "), 1, ["Summer pass"]), false);
  });

  it("a split \"FINAL 50 TICKETS\" draws both lines at the step's cap, in red, with no number token", () => {
    // Too wide for one line at both steps, so it breaks.
    const p = planT2Claim({ approved: "Final 50 tickets" }, (t, cap) => (t.includes(" ") && t.split(" ").length === 3 ? 2000 : t.length * 0.35 * cap), PUZZLE_FLOATING_T2);
    const a = p.attempts[p.chosen!]!;
    assert.ok(a.split);
    assert.deepEqual(a.lines, ["FINAL 50", "TICKETS"]);
    const C = PUZZLE_FLOATING_T2.claim.steps[a.step]!.cap * 1920;
    for (const l of a.layout.lines) {
      close(l.capPx, C);
      assert.equal(l.color, "red");
      assert.equal(l.numberToken, false);
    }
  });

  it("a number the approved claim puts on its own line is still enlarged", () => {
    const p = planT2Claim({ approved: "Final 100\n3rd release tickets" }, measure);
    assert.ok(p.layout!.lines[0]!.numberToken);
    close(p.layout!.lines[0]!.capPx, 1.5 * 0.06 * 1920);
  });
});

describe("H30: band stops on 3 × 3 averages", () => {
  it("a one-row step reads as the mean of the rows around it, within ±1 of either side", () => {
    const w = 5;
    const h = 10;
    const a = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) a[(y * w + x) * 4 + 3] = y < 5 ? Math.round(0.18 * 255) : Math.round(0.2 * 255);
    const [s] = sampleStops(a, { width: w, height: h }, 4, [[0.5, 20]]);
    // Rows 4, 5, 6 → 18, 20, 20 → 19.3.
    assert.ok(Math.abs(s!.got - 19.3) < 0.15, String(s!.got));
    assert.ok(s!.ok);
  });

  it("two stops less than a pixel apart share a reading that passes between their values ±1; alone, a stop is held to ±1", () => {
    const w = 5;
    const h = 1350;
    const a = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) a[(y * w + x) * 4 + 3] = y < 1059 ? Math.round(0.18 * 255) : Math.round(0.2 * 255);
    const [s18, s20] = sampleStops(a, { width: w, height: h }, 4, [[0.784, 18], [0.7844, 20]]);
    assert.equal(s18!.got, s20!.got);
    assert.ok(s18!.ok && s20!.ok);
    assert.deepEqual(s20!.pairedWith, [18]);
    const [lone] = sampleStops(a, { width: w, height: h }, 4, [[0.7844, 20]]);
    assert.equal(lone!.ok, false);
  });
});
