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
 * Every value the records don't give is in T2_INVENTED.
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
  /** Display case of claims (O23 as amended): the kit's own CTAs are capitals. */
  claimCase: "upper" | "as-approved";
  colours: { white: string; kitRed: string; coral: string };
  /** Tracking in thousandths of an em (Photoshop units). */
  tracking: { claim: number; lineup: number; details: number };
  claim: {
    /** The block's vertical centre: the 4:5 rectangle's centre (O4). */
    centre: number;
    /** Each line within this share of W (O4: 86 % W). */
    maxWidth: number;
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
  claimCase: "upper",
  colours: { white: "#FFFFFF", kitRed: "#FE3232", coral: "#FF6876" },
  tracking: { claim: 25, lineup: 5, details: 5 },
  claim: {
    centre: 0.5,
    maxWidth: 0.86,
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

/** Values on the T2 static that no asset, PSD, record or ruling gives (H26). */
export const T2_INVENTED = [
  "the claim's roll-call sizes on T2: line 2 (white) takes the step's cap; line 1 (kit red) is 0.625 of it, the Puzzle overlay PSD's 0.217 / 0.347; the gap is 0.29 of line 2's cap, O23's 22 / 76. O12 says only \"the central claim at the slot's cap height\"",
  "equal-cap two-line claims keep O4's 8.75 % H pitch at step 0 and scale it with the cap at step 1 (7.58 % H)",
  "the claim block (first cap top to last baseline, the qualifier included) is centred on 0.50 H",
  "a one-line claim that is wider than 86 % W at a step is broken into two lines at that step, at the word break with the narrowest wider line; a claim that comes with its own line break keeps it and is never re-broken",
  "\"FINAL {n} TICKETS\" alone is kit red, as the Puzzle PSD's one-line piece (O23); every other non-roll-call line is white",
  "a number token is a line that is only a number with an optional FINAL, currency sign or %",
  "shortening applies each drop to every line that has the word, cumulatively, re-trying both steps after each; the number form (\"3RD RELEASE\" → \"3RD\") is used only while another RELEASE stays on the frame",
  "the fit meter on T2 reads \"step {n} of 1 · {lines} line(s)\", plus \"· dropped {words}\" after shortening, and \"{widest} of {max} px · can't shorten\" past the last drop",
  "the T2 claim box is 0.07–0.93 W from the block's first cap top to its last baseline, tested at ≤ 15 % below 3:1 against white with the bands on (O19's claim-box limit); the red line is tested on its ink box as O19 amended (≤ 25 % below 2:1 against #FE3232, else white)",
  "the lineup and details corners are tested as O19's text box is (≤ 10 % below 3:1), each on its own ink block padded 12 px",
  "lineup and details lines are capped at 40 % W and step down together to fit; their tracking is the PSD's live layer's 5",
  "the details pitch is the lineup's pitch-to-cap ratio (3.0 / 2.6) at the details cap: 3.07 % H",
  "the details read the STORY PSD's live layer verbatim, the date line then the venue line (O4: \"two lines date / venue\"), coral on \">\" only; the time line is left off",
  "the logo slot is the kit's lockup piece (wordmark + script, issue 2) by its ink box at 15 % W, its centre on the details' centre line, its right edge on the lineup's 14.3 % W inset",
  "the ground is the STORY PSD's Background paint layer with the taped panel over it at the PSD's own position; the paint is the ground (re-covered in the 1:1), the panel moves with the arrangement (0.8× in the 1:1)",
  "T2 carries O25's bands unchanged (O25's scope leaves T2 to its own draft): over the ground and panel, under all type and the lockup",
] as const;
