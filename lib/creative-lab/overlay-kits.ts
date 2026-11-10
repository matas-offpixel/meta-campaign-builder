/**
 * Per-kit slot tables for the artwork overlays (overlay-templates issue 1,
 * H2: "boxes per kit as ratios of H and W in one file (overlay-kits.ts:
 * floating and frame)"). Values are ratios of the 9:16 master (H = 1920,
 * W = 1080), resolved at the output size, never pixel-copied.
 *
 * This file carries the floating kit's T2 standalone message (O4, O8, O12)
 * for Puzzle. T1 and the artist card keep their constants in artist-card.ts
 * and claim-slot.ts until those move here (artist-card.ts is open on
 * cursor/artist-card-lab today, CLAUDE.md rule 3). The frame kit (J2, O15)
 * is held for PPNeueMachina-Regular (O24) and isn't tabled yet.
 *
 * Every value no asset gives is in T2_INVENTED with its ruling (issue 4).
 */

export type KitKind = "floating" | "frame";

export type T2ClaimStep = {
  /** Cap height as a fraction of H. */
  cap: number;
  /** Line pitch (cap top to next cap top) for equal-cap lines, fraction of H. */
  pitch: number;
};

export type T2Kit = {
  id: string;
  kind: KitKind;
  /** The kit's face for every rendered slot (O6, O24): PostScript name. */
  face: string;
  /** O26 / O30: T2 on this kit always draws its panel, and the claim slot is the panel. */
  panel: boolean;
  /** Display case of claims (O23 as amended): the kit's own CTAs are capitals. */
  claimCase: "upper" | "as-approved";
  colours: { white: string; kitRed: string; coral: string };
  /** Tracking in thousandths of an em (Photoshop units). */
  tracking: { claim: number; lineup: number; details: number };
  claim: {
    /** The block's vertical centre: the 4:5 rectangle's centre (O4). */
    centre: number;
    /** Each line within this share of W (O4: 86 % W); on a panel kit, the slot is never wider. */
    maxWidth: number;
    /** O26: the slot is the panel's ink box less these insets (fractions of W each side, of H top and bottom). */
    panelInset: { x: number; y: number };
    /** O8 T2: step 0 two lines at 6 % H; step 1 two lines at 5.2 % H; never a third line. */
    steps: readonly T2ClaimStep[];
    /** A number token alone on its line draws at this multiple (O4). */
    numberToken: number;
    /** The qualifier line, at this share of the claim cap (O4). */
    qualifier: number;
    /** Roll-call (O12): line 1 kit red at the PSD's size ratio to line 2 (0.217 / 0.347, issue 3 data note). */
    rollCallLine1: number;
    /** Roll-call gap: line 1's baseline to line 2's cap top, as a share of line 2's cap (O23: 22 / 76). */
    rollCallGap: number;
  };
  lineup: { capTop: number; cap: number; pitch: number; rightInset: number; maxLines: number; maxWidth: number };
  details: { centre: number; cap: number; pitch: number; leftInset: number; maxWidth: number };
  logo: { width: number; rightInset: number };
  /** O8's fixed shortening order, applied after the last step. */
  dropOrder: readonly ("TICKETS" | "NOW" | "number form")[];
};

export const PUZZLE_FLOATING_T2: T2Kit = {
  id: "puzzle-floating",
  kind: "floating",
  face: "BootzyCondensedTM-Regular",
  panel: true,
  claimCase: "upper",
  colours: { white: "#FFFFFF", kitRed: "#FE3232", coral: "#FF6876" },
  tracking: { claim: 25, lineup: 5, details: 5 },
  claim: {
    centre: 0.5,
    maxWidth: 0.86,
    panelInset: { x: 0.04, y: 0.02 },
    steps: [
      { cap: 0.06, pitch: 0.0875 },
      { cap: 0.052, pitch: 0.0875 * (0.052 / 0.06) },
    ],
    numberToken: 1.5,
    qualifier: 0.6,
    rollCallLine1: 0.217 / 0.347,
    rollCallGap: 22 / 76,
  },
  lineup: { capTop: 0.219, cap: 0.026, pitch: 0.03, rightInset: 0.143, maxLines: 6, maxWidth: 0.4 },
  details: { centre: 0.767, cap: 0.0266, pitch: 0.0266 * (0.03 / 0.026), leftInset: 0.143, maxWidth: 0.4 },
  logo: { width: 0.15, rightInset: 0.143 },
  dropOrder: ["TICKETS", "NOW", "number form"],
};

export type T2InventedRuling = "accepted" | "amended" | "invented in issue 4" | "new, not yet ruled";

/**
 * Values on the T2 static that no asset, PSD or measurement gives (H26), each
 * with the ruling overlay-templates issue 4 gave it. Accepted values stay
 * invented in the sense of rule 11: no asset gives them.
 */
export const T2_INVENTED: readonly { value: string; ruling: T2InventedRuling; by: string }[] = [
  { ruling: "accepted", by: "issue 4", value: "roll-call sizes on T2: line 2 (white) at the step's cap; line 1 (kit red) at 0.625 of it (the Puzzle overlay PSD's 0.217 / 0.347); the gap 0.29 of line 2's cap (O23's 22 / 76)" },
  { ruling: "accepted", by: "issue 4", value: "two-line pitch: O4's 8.75 % H at step 0, scaled with the cap at step 1 (7.58 % H)" },
  { ruling: "accepted", by: "issue 4, with O26", value: "the claim block (first cap top to last baseline, the qualifier included) is centred on 0.50 H, and must sit inside the panel slot" },
  { ruling: "accepted", by: "issue 4, with O28", value: "a one-line claim wider than the slot breaks onto two lines at the same step; a claim that comes with its own line break keeps it and is never re-broken" },
  { ruling: "accepted", by: "issue 4, with O28", value: "\"FINAL {n} TICKETS\" is kit red (the PSD's one-line piece); every other non-roll-call line white; a split red claim is red on both lines" },
  { ruling: "accepted", by: "issue 4, with O28", value: "a number token is a line that is only a number with an optional FINAL, currency sign or %; enlarged only when the approved claim itself puts it on its own line, never by a split" },
  { ruling: "accepted", by: "issue 4, with O27", value: "drops are cumulative: each applies to every line that has the word and stays dropped, both steps retried after each; on a roll-call only line 2 takes them, and the number form (\"3RD RELEASE\" → \"3RD\") only while line 1 keeps RELEASE" },
  { ruling: "accepted", by: "issue 4, with O26", value: "the fit meter: \"step {n} of 1 · {lines} line(s)\", \"· dropped {words}\" after shortening, \"{widest} of {slot} px · can't shorten\" past the last drop" },
  { ruling: "amended", by: "issue 4 (O26)", value: "the claim box tested by O19 is the O26 slot (was 0.07–0.93 W), ≤ 15 % below 3:1 with the bands on; the red line's ink-box test unchanged (≤ 25 % below 2:1 against #FE3232, else white)" },
  { ruling: "accepted", by: "issue 4", value: "the lineup and details corners each tested on their own ink block padded 12 px, ≤ 10 % below 3:1, bands on" },
  { ruling: "accepted", by: "issue 4", value: "corner lines capped at 40 % W, stepping down together; tracking 5 (the PSD's live layer)" },
  { ruling: "accepted", by: "issue 4", value: "the details pitch is the lineup's pitch-to-cap ratio (3.0 / 2.6) at the details cap: 3.07 % H" },
  { ruling: "accepted", by: "issue 4", value: "details: the STORY PSD's live layer verbatim, date line then venue line, coral on \">\" only; the time line left off" },
  { ruling: "accepted", by: "issue 4", value: "the logo is the lockup (wordmark + script) by its ink box at 15 % W, centred on the details' centre line, right edge on the 14.3 % W inset" },
  { ruling: "accepted", by: "issue 4 (O30)", value: "the ground is the STORY PSD's Background paint, re-covered in the 1:1; the taped panel at the PSD's position, 0.8× in the 1:1; a panel kit never draws T2 without its panel" },
  { ruling: "accepted", by: "issue 4 (O29)", value: "O25's bands carried onto T2 unchanged, over the ground and panel, under all type and the lockup" },
  { ruling: "invented in issue 4", by: "O26", value: "the slot insets: 0.04 W each side, 0.02 H top and bottom of the panel's ink box" },
  { ruling: "invented in issue 4", by: "O28, H30", value: "no break inside a release name; colour by claim; band stops read on a 3 × 3 average" },
  { ruling: "new, not yet ruled", by: "H27 build", value: "claim lines centre on the slot's horizontal centre (on Puzzle x 531 from the ink box, 533 from the paper), not the frame's; a slot wider than 86 % W is narrowed about the panel's centre" },
  { ruling: "new, not yet ruled", by: "H27 build", value: "the panel's ink box is every pixel with alpha > 8 at its placed size, as O26 is written; on Puzzle that includes the tape strips (x 35–1025), so the slot is x 78–983 (905 px), and a line wider than about 880 px runs past the paper (x 94–970) at the claim's rows. The paper box (each edge the median over the rows or columns with ink) gives 137–928 (791 px); drafts with --panel-box paper show it" },
  { ruling: "new, not yet ruled", by: "H27 build", value: "a claim whose lines fit the width but whose block is taller than the slot meters \"{block} of {slot} px tall · can't shorten\"" },
  { ruling: "new, not yet ruled", by: "H27 build", value: "a draft of a ladder state that doesn't fit draws its claim lines cut at the slot's edges, so no line runs past the slot in any format" },
  { ruling: "new, not yet ruled", by: "H29 build", value: "release names that can't be split: any word followed by RELEASE, EARLY BIRD and GENERAL SALE, and the event's own release names when given" },
  { ruling: "new, not yet ruled", by: "H30 build", value: "the 3 × 3 average is centred on the frame's centre column and the pixel row the stop falls in; two stops less than a pixel apart (O25's plateau edges 0.44 / 0.4404 and 0.6997 / 0.7 H, 0.784 / 0.7844 in the 4:5) share one reading, which passes between their two values ±1" },
];
