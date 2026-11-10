/**
 * T2 standalone message (overlay-templates issue 1: O4 slots, O8 steps and
 * shortening, O12 roll-call; issue 3: O23 kit case, O24 fonts). Planning
 * only: geometry, the step ladder and the fit meter, with every width
 * measured by the caller in the kit's own face (H7: "measured with the real
 * font's advance widths, not a character count"). Rendering is t2-render.ts.
 *
 * The approved words are never changed here. A step is a smaller size at the
 * face's own width (never condensed); past the last step O8's drop order
 * shortens the displayed words and the plan says what went; past the last
 * drop the claim is flagged "can't shorten" and has no Approve.
 *
 * Issue 4: the claim slot is the panel (O26), the roll-call shortens only its
 * line 2 (O27), a break never splits a release name or makes a number token
 * and colour belongs to the claim (O28).
 */

import { MASTER, type Rect, type Size } from "./artist-card.ts";
import { rollCallStates } from "./claim-slot.ts";
import { PUZZLE_FLOATING_T2, type T2Kit } from "./overlay-kits.ts";

/** A line's ink width (px) at a cap height and tracking, in the kit face. */
export type MeasureLine = (text: string, capPx: number, tracking: number) => number;

export type T2ClaimKind = "roll-call" | "plain";

export type T2Attempt = {
  step: number;
  /** Displayed lines (kit case, after drops). */
  lines: string[];
  dropped: string[];
  /** A one-line claim broken onto two lines at this step. */
  split: boolean;
  widths: number[];
  /** Every line within the slot's width. */
  fitsWidth: boolean;
  /** The block (first cap top to last baseline) within the slot's height. */
  fitsHeight: boolean;
  fits: boolean;
  layout: T2Layout;
};

export type T2Line = {
  text: string;
  color: "red" | "white";
  capPx: number;
  capTop: number;
  widthPx: number;
  role: "claim" | "qualifier";
  numberToken: boolean;
};

export type T2Layout = { lines: T2Line[]; blockTop: number; blockBottom: number; capPx: number; /** Each line is centred on this x: the slot's centre. */ centreX: number };

/** O26: the claim slot, master px. */
export type T2Slot = { left: number; right: number; top: number; bottom: number; fromPanel: boolean };

export const slotWidth = (slot: T2Slot): number => slot.right - slot.left;
export const slotRect = (slot: T2Slot): Rect => ({ left: slot.left, top: slot.top, width: slot.right - slot.left, height: slot.bottom - slot.top });

/** O32: the kit's stored paper box as a rect (edges inclusive), or null on a kit with no panel. */
export function paperRect(kit: T2Kit = PUZZLE_FLOATING_T2): Rect | null {
  const p = kit.paper;
  return p ? { left: p.left, top: p.top, width: p.right - p.left + 1, height: p.bottom - p.top + 1 } : null;
}

/**
 * O32 (amends O26). On a kit whose T2 draws a panel, the slot is the panel's
 * paper (the kit-audit value, never the ink box with its tape) less 0.03 W
 * each side and 0.02 H top and bottom, and never wider than 86 % W (narrowed
 * about the paper's centre). A kit with no panel keeps O4's 86 % W, centred,
 * the frame's full height. Puzzle: x 126–938 (812 px), y 411–1510.
 */
export function claimSlot(panelInk: Rect | null, kit: T2Kit = PUZZLE_FLOATING_T2, frame: Size = MASTER): T2Slot {
  const maxW = kit.claim.maxWidth * frame.width;
  if (!panelInk) {
    const left = (frame.width - maxW) / 2;
    return { left, right: left + maxW, top: 0, bottom: frame.height, fromPanel: false };
  }
  const ix = kit.claim.panelInset.x * frame.width;
  const iy = kit.claim.panelInset.y * frame.height;
  let left = panelInk.left + ix;
  let right = panelInk.left + panelInk.width - ix;
  if (right - left > maxW) {
    const c = (left + right) / 2;
    left = c - maxW / 2;
    right = c + maxW / 2;
  }
  return { left, right, top: panelInk.top + iy, bottom: panelInk.top + panelInk.height - iy, fromPanel: true };
}

export type T2Plan = {
  kind: T2ClaimKind;
  /** The approved words, exactly as stored. */
  approvedLines: string[];
  /** Every state of the O8 ladder in order; `chosen` indexes the first that fits. */
  attempts: T2Attempt[];
  chosen: number | null;
  /** The fit meter's reading. */
  meter: string;
  /** False when nothing fits: "can't shorten", no Approve. */
  canApprove: boolean;
  held: string | null;
  /** Layout of the chosen attempt, else of the last one tried (drawn flagged). */
  layout: T2Layout | null;
  /** The O26 slot every state was measured against. */
  slot: T2Slot;
  maxWidthPx: number;
};

/** Capitals with the root locale when the kit's case is upper (O23). Display only. */
export function inCase(text: string, kit: T2Kit = PUZZLE_FLOATING_T2): string {
  return kit.claimCase === "upper" ? text.toUpperCase() : text;
}

/** A line that is only a number token: "FINAL 100", "£16.50", "90%" (O4). */
export function isNumberToken(line: string): boolean {
  return /^(FINAL\s+)?[£$€]?\d[\d,.]*%?$/i.test(line.trim());
}

/** "FINAL {n} TICKETS" alone: the kit's red one-line piece (O23). */
export const isFinalTickets = (line: string): boolean => /^FINAL\s+\d[\d,]*\s+TICKETS$/i.test(line.trim());

/** O12's two-line roll-call: line 1 names what sold out. */
export function claimKind(lines: readonly string[]): T2ClaimKind {
  return lines.length === 2 && /\bSOLD OUT$/i.test(lines[0]!.trim()) ? "roll-call" : "plain";
}

/** One O8 drop over every line (claim-slot.ts, shared with T1 and the artist card). */
export { applyDrop } from "./claim-slot.ts";
import { applyDrop } from "./claim-slot.ts";

/** O28 / O34's unbreakable release names and break rule live in claim-slot.ts, shared with T1's splitTwo. */
export { TWO_WORD_RELEASE_NAMES, breakAllowed } from "./claim-slot.ts";
import { breakAllowed } from "./claim-slot.ts";

/** The two-line break whose wider line is narrowest (measured), among O28's allowed breaks. */
export function bestSplit(line: string, capPx: number, tracking: number, measure: MeasureLine, releaseNames: readonly string[] = []): [string, string] | null {
  const words = line.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let widest = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    if (!breakAllowed(words, i, releaseNames)) continue;
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const w = Math.max(measure(a, capPx, tracking), measure(b, capPx, tracking));
    if (w < widest) {
      widest = w;
      best = [a, b];
    }
  }
  return best;
}

export type LayoutOpts = {
  /** O28: the claim is red ("FINAL {n} TICKETS"): every line red, split or not. Default: one line that reads so. */
  claimRed?: boolean;
  /** O28: which lines are number tokens — only a line the approved claim itself gives the number. Default: each line that is one. */
  tokens?: readonly boolean[];
  /** Lines centre on this x (the slot's centre). Default: the frame's centre. */
  centreX?: number;
};

/** Sizes, colours and cap tops for one state of the ladder, centred on the kit's claim centre. */
export function layoutClaim(lines: readonly string[], kind: T2ClaimKind, step: number, measure: MeasureLine, qualifier: string | null = null, kit: T2Kit = PUZZLE_FLOATING_T2, frame: Size = MASTER, opts: LayoutOpts = {}): T2Layout {
  const s = kit.claim.steps[step]!;
  const C = s.cap * frame.height;
  const gapPlain = (s.pitch - s.cap) * frame.height;
  const t = kit.tracking.claim;
  type Draft = Omit<T2Line, "capTop" | "widthPx">;
  const drafts: Draft[] = [];
  if (kind === "roll-call") {
    drafts.push({ text: lines[0]!, color: "red", capPx: C * kit.claim.rollCallLine1, role: "claim", numberToken: false });
    drafts.push({ text: lines[1]!, color: "white", capPx: C, role: "claim", numberToken: false });
  } else {
    const red = opts.claimRed ?? (lines.length === 1 && isFinalTickets(lines[0]!));
    lines.forEach((text, i) => {
      const token = opts.tokens ? !!opts.tokens[i] : isNumberToken(text);
      drafts.push({ text, color: red ? "red" : "white", capPx: token ? C * kit.claim.numberToken : C, role: "claim", numberToken: token });
    });
  }
  if (qualifier) drafts.push({ text: qualifier, color: "white", capPx: C * kit.claim.qualifier, role: "qualifier", numberToken: false });
  const gaps = drafts.map((_, i) => (i === 0 ? 0 : kind === "roll-call" && i === 1 ? kit.claim.rollCallGap * C : gapPlain));
  const total = drafts.reduce((a, d, i) => a + d.capPx + gaps[i]!, 0);
  let y = kit.claim.centre * frame.height - total / 2;
  const out: T2Line[] = drafts.map((d, i) => {
    y += gaps[i]!;
    const line: T2Line = { ...d, capTop: y, widthPx: measure(d.text, d.capPx, t) };
    y += d.capPx;
    return line;
  });
  return { lines: out, blockTop: out[0]!.capTop, blockBottom: y, capPx: C, centreX: opts.centreX ?? frame.width / 2 };
}

/** The meter's words for a fitting attempt (O8, OT4). */
export function meterFor(a: T2Attempt, kit: T2Kit = PUZZLE_FLOATING_T2): string {
  const n = a.lines.length;
  const base = `step ${a.step} of ${kit.claim.steps.length - 1} · ${n} line${n === 1 ? "" : "s"}`;
  return a.dropped.length ? `${base} · dropped ${a.dropped.join(", ")}` : base;
}

/**
 * The whole O8 ladder for an approved claim on T2, measured against the O26
 * slot: each step, then each drop with both steps again, until a state fits.
 * A roll-call shortens only its line 2 (O27, claim-slot.ts rollCallStates);
 * line 1 is never touched. Every state tried is returned so a draft can show
 * the ladder; `chosen` is the first that fits.
 */
export function planT2Claim(
  input: { approved: string; qualifier?: string | null; kind?: T2ClaimKind; releaseNames?: readonly string[] },
  measure: MeasureLine,
  kit: T2Kit = PUZZLE_FLOATING_T2,
  frame: Size = MASTER,
  opts: { exhaust?: boolean; slot?: T2Slot } = {},
): T2Plan {
  const approvedLines = input.approved.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  const slot = opts.slot ?? claimSlot(null, kit, frame);
  const maxWidthPx = slotWidth(slot);
  const kind = input.kind ?? claimKind(approvedLines);
  const base = { kind, approvedLines, attempts: [] as T2Attempt[], chosen: null, layout: null, slot, maxWidthPx };
  if (!approvedLines.length) return { ...base, meter: "no claim", canApprove: false, held: "no approved claim" };
  if (approvedLines.length > 2) return { ...base, meter: `${approvedLines.length} lines · can't shorten`, canApprove: false, held: "T2 takes two claim lines and a qualifier, never a third line" };
  const qualifier = input.qualifier ? inCase(input.qualifier, kit) : null;
  const shownApproved = approvedLines.map((l) => inCase(l, kit));
  // O28: colour belongs to the claim; a number is enlarged only where the approved claim puts it on its own line.
  const claimRed = kind === "plain" && shownApproved.length === 1 && isFinalTickets(shownApproved[0]!);
  const approvedTokens = shownApproved.map(isNumberToken);
  const centreX = (slot.left + slot.right) / 2;

  // The states past the steps: O27 for the roll-call (line 2 only), O8's cumulative drops otherwise.
  const states: { lines: string[]; dropped: string[] }[] = [];
  if (kind === "roll-call") {
    for (const st of rollCallStates(shownApproved[0]!, shownApproved[1]!)) states.push({ lines: [st.line1, st.line2], dropped: [...st.dropped] });
  } else {
    let lines = shownApproved;
    const dropped: string[] = [];
    states.push({ lines, dropped: [] });
    for (const drop of kit.dropOrder) {
      const next = applyDrop(lines, drop);
      if (!next) continue;
      lines = next;
      dropped.push(drop);
      states.push({ lines, dropped: [...dropped] });
    }
  }

  const attempts: T2Attempt[] = [];
  let chosen: number | null = null;
  outer: for (const state of states) {
    for (let step = 0; step < kit.claim.steps.length; step += 1) {
      const C = kit.claim.steps[step]!.cap * frame.height;
      const tries: { lines: string[]; split: boolean }[] = [{ lines: state.lines, split: false }];
      if (state.lines.length === 1 && kind === "plain") {
        const sp = bestSplit(state.lines[0]!, C, kit.tracking.claim, measure, input.releaseNames);
        if (sp) tries.push({ lines: sp, split: true });
      }
      for (const t of tries) {
        const tokens = t.split || t.lines.length !== shownApproved.length ? t.lines.map(() => false) : approvedTokens;
        const lay = layoutClaim(t.lines, kind === "roll-call" ? "roll-call" : "plain", step, measure, qualifier, kit, frame, { claimRed, tokens, centreX });
        const widths = lay.lines.map((l) => l.widthPx);
        const fitsWidth = widths.every((w) => w <= maxWidthPx + 0.5);
        const fitsHeight = lay.blockTop >= slot.top - 0.5 && lay.blockBottom <= slot.bottom + 0.5;
        const fits = fitsWidth && fitsHeight;
        attempts.push({ step, lines: t.lines, dropped: state.dropped, split: t.split, widths, fitsWidth, fitsHeight, fits, layout: lay });
        if (fits && chosen == null) {
          chosen = attempts.length - 1;
          if (!opts.exhaust) break outer;
        }
      }
    }
  }
  if (chosen != null) return { ...base, attempts, chosen, meter: meterFor(attempts[chosen]!, kit), canApprove: true, held: null, layout: attempts[chosen]!.layout };
  const last = attempts[attempts.length - 1]!;
  const widest = Math.max(...last.widths);
  const meter = last.fitsWidth
    ? `${Math.round(last.layout.blockBottom - last.layout.blockTop)} of ${Math.round(slot.bottom - slot.top)} px tall · can't shorten`
    : `${Math.round(widest)} of ${Math.round(maxWidthPx)} px · can't shorten`;
  return { ...base, attempts, chosen: null, meter, canApprove: false, held: "can't shorten", layout: last.layout };
}

// ─── Corners (O4, O9) ───────────────────────────────────────────────────────

export type CornerLine = { text: string; runs: { text: string; coral: boolean }[]; capPx: number; capTop: number; left: number; widthPx: number };

const runsOf = (text: string): CornerLine["runs"] =>
  text.split(/(>)/).filter(Boolean).map((t) => ({ text: t, coral: t === ">" }));

/** Top-right lineup: right-aligned, the typed lineup in order, at most six lines ("& MORE" when the event says more TBA). */
export function planLineup(names: readonly string[], measure: MeasureLine, opts: { more?: boolean } = {}, kit: T2Kit = PUZZLE_FLOATING_T2, frame: Size = MASTER): CornerLine[] {
  const L = kit.lineup;
  let list = names.map((n) => inCase(n.trim(), kit)).filter(Boolean);
  if (opts.more) list = [...list, inCase("& more", kit)];
  if (list.length > L.maxLines) list = [...list.slice(0, L.maxLines - 1), inCase("& more", kit)];
  const cap0 = L.cap * frame.height;
  const widths0 = list.map((t) => measure(t, cap0, kit.tracking.lineup));
  const k = Math.min(1, ...widths0.map((w) => (w > 0 ? (L.maxWidth * frame.width) / w : 1)));
  const right = frame.width * (1 - L.rightInset);
  return list.map((text, i) => {
    const w = widths0[i]! * k;
    return { text, runs: [{ text, coral: false }], capPx: cap0 * k, capTop: L.capTop * frame.height + i * L.pitch * frame.height * k, left: right - w, widthPx: w };
  });
}

/** Bottom-left details: date line then venue line, coral on ">" (issue 2), block centred on 0.767 H. */
export function planDetails(lines: readonly string[], measure: MeasureLine, kit: T2Kit = PUZZLE_FLOATING_T2, frame: Size = MASTER): CornerLine[] {
  const D = kit.details;
  const shown = lines.map((l) => inCase(l.trim(), kit)).filter(Boolean);
  const cap0 = D.cap * frame.height;
  const widths0 = shown.map((t) => measure(t, cap0, kit.tracking.details));
  const k = Math.min(1, ...widths0.map((w) => (w > 0 ? (D.maxWidth * frame.width) / w : 1)));
  const cap = cap0 * k;
  const pitch = D.pitch * frame.height * k;
  const total = cap + (shown.length - 1) * pitch;
  const top = D.centre * frame.height - total / 2;
  return shown.map((text, i) => ({ text, runs: runsOf(text), capPx: cap, capTop: top + i * pitch, left: D.leftInset * frame.width, widthPx: widths0[i]! * k }));
}

/** Bottom-right logo: the lockup by its ink box at 15 % W, centred on the details' centre line. */
export function planLogo(ink: { width: number; height: number }, kit: T2Kit = PUZZLE_FLOATING_T2, frame: Size = MASTER): { left: number; top: number; width: number; height: number } {
  const width = kit.logo.width * frame.width;
  const height = (ink.height / ink.width) * width;
  return { left: frame.width * (1 - kit.logo.rightInset) - width, top: kit.details.centre * frame.height - height / 2, width, height };
}
