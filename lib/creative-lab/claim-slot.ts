/**
 * T1's claim slot (overlay-templates issue 1: O3 claim slot, O8 steps, O12
 * roll-call), prepared for approved claim text. Geometry is planned without
 * the font; text is rendered only through the font index (kit-font.ts), and a
 * missing, trial or server-uncleared face holds the card.
 *
 * Measured values (1080×1920, fractions of H):
 *   - O3: the claim box 0.7536–0.7927 H (cap 0.0391 H), centred, ≤ 0.80 W.
 *   - O12 roll-call, from Puzzle overlay.psd's CTA group (Bootzy, cap/em
 *     0.712): line 1 "EARLY BIRD, 1ST, 2nd & 3rd RELEASE SOLD OUT" #FE3232 at
 *     65.1 px, line 2 white at 104.2 px (25 characters; the PSD's words
 *     predate A21, so the generator's line 2 is used, never the PSD's); line 1's
 *     size is 0.625 of line 2's; the gap from line 1's baseline to line 2's
 *     cap top is 0.0160 H (0.409 of line 2's cap). Record O12 says line 1's
 *     cap is ≈ 0.022 H; the PSD gives 0.0241 H (65.1 px × 0.712).
 *   - Advance: Bootzy caps average ≤ 0.35 cap heights per character with
 *     spaces (0.324 on line 1, 0.350 on line 2), so a line's width is
 *     estimated as characters × 0.35 × cap until rendered.
 *
 * Placement as O3: the bottom line stays in O3's box; a second line or the
 * roll-call's red line sits above it. With a claim present the face band's
 * chin moves up to ≤ 0.72 H, and never below the claim block's top.
 */

import { MASTER, SLOTS, type FaceBand, type Size } from "./artist-card.ts";
import { requireFont, type FontEntry } from "./kit-font.ts";

export const KIT_RED = "#FE3232";
export const KIT_WHITE = "#FFFFFF";
export const CLAIM_FONT = "BootzyCondensedTM-Regular";
/** Tracking on every Puzzle text layer (Photoshop units, thousandths of an em), all caps. */
export const CLAIM_TRACKING = 25;

export const CLAIM_SLOT = {
  box: { top: 0.7536, bottom: 0.7927 },
  cap: 0.0391,
  maxWidth: 0.8,
  /** O8 T1 steps: one line, two lines, two smaller lines; never a third line. */
  steps: [
    { lines: 1, cap: 0.0391, maxChars: 36 },
    { lines: 2, cap: 0.0391, maxChars: 36 },
    { lines: 2, cap: 0.034, maxChars: 42 },
  ],
  /** Line gap: baseline to the next line's cap top, as a share of the lower line's cap (roll-call, measured). */
  gapPerCap: 0.409,
  rollCall: { line1SizeRatio: 0.625 },
  /** Average advance per character (with spaces), in cap heights; an over-estimate on both measured lines. */
  advancePerCap: 0.35,
  /** The face band's chin limit when a claim is present. */
  chinWithClaim: 0.72,
} as const;

export type ApprovedClaim =
  | { kind: "claim"; text: string; approvedBy: string; approvedAt: string; /** O48: the event's own release names (event_releases), which a line break never splits. */ releaseNames?: readonly string[] }
  | { kind: "roll-call"; soldOut: string; live: string; approvedBy: string; approvedAt: string };

export type ClaimLine = { text: string; color: string; cap: number; capTop: number; baseline: number; estWidth: number };

export type ClaimPlan = {
  lines: ClaimLine[];
  /** O8 step reached (0, 1, 2), or "roll-call". */
  step: 0 | 1 | 2 | "roll-call";
  /** O27: the drops line 2 of a roll-call took to fit, in order (empty when none). */
  dropped?: string[];
  blockTop: number;
  blockBottom: number;
  /** The face band's chin limit with this claim. */
  chinMax: number;
  /** Why the chin limit is lower than 0.72 H, when it is. */
  chinNote: string | null;
};

/** Estimated width (fraction of W) of a caps line at a cap height (fraction of H). */
export function estimateWidth(text: string, cap: number, frame: Size = MASTER): number {
  return (text.length * CLAIM_SLOT.advancePerCap * cap * frame.height) / frame.width;
}

/** Release names that are two words without RELEASE (O28's examples), beside every "{X} RELEASE". */
export const TWO_WORD_RELEASE_NAMES = ["EARLY BIRD", "GENERAL SALE"] as const;

const bare = (w: string) => w.replace(/[^\p{L}\p{N}&%£$€]/gu, "").toUpperCase();

/**
 * O28 / O34 (T2), and on T1 too (design, #1163): may a one-line claim break before word i? Never inside a release
 * name: not before RELEASE ("2ND RELEASE", "FINAL RELEASE"), not inside "EARLY
 * BIRD" or "GENERAL SALE", nor inside any of the event's own release names;
 * and never between FINAL and its number.
 */
export function breakAllowed(words: readonly string[], i: number, releaseNames: readonly string[] = []): boolean {
  if (bare(words[i]!) === "RELEASE") return false;
  // O34: never between FINAL and its number ("FINAL 100").
  if (bare(words[i - 1] ?? "") === "FINAL" && /^[£$€]?\d/.test(bare(words[i]!))) return false;
  const names = [...TWO_WORD_RELEASE_NAMES, ...releaseNames.map((n) => n.trim().toUpperCase())].map((n) => n.split(/\s+/).map(bare)).filter((n) => n.length > 1);
  const ws = words.map(bare);
  for (const n of names) {
    for (let start = Math.max(0, i - n.length + 1); start < i; start += 1) {
      if (start + n.length <= ws.length && n.every((w, j) => ws[start + j] === w)) return false;
    }
  }
  return true;
}

/** The two-line break with the most even halves, at a space, among O28's allowed breaks (T1 and T2 share the rule). */
export function splitTwo(text: string, releaseNames: readonly string[] = []): [string, string] | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let diff = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    if (!breakAllowed(words, i, releaseNames)) continue;
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    const d = Math.max(a.length, b.length);
    if (d < diff) {
      diff = d;
      best = [a, b];
    }
  }
  return best;
}

/** The face band with a claim present: chin ≤ 0.72 H and ≤ the claim block's top. */
export function faceBandWithClaim(blockTop: number): FaceBand {
  return { ...SLOTS.face, chinMax: Math.min(CLAIM_SLOT.chinWithClaim, blockTop) };
}

// ─── O27: the roll-call's shortening (overlay-templates issue 4) ──────────

/** O8's fixed shortening order. */
export const DROP_ORDER = ["TICKETS", "NOW", "number form"] as const;
export type Drop = (typeof DROP_ORDER)[number];

/** The roll-call, H28: two lines whose first names what sold out (A14). */
export function isRollCall(lines: readonly string[]): boolean {
  return lines.length === 2 && /\bSOLD OUT\s*$/i.test(lines[0]!.trim());
}

function dropWord(line: string, word: string): string {
  return line.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`, "gi"), " ").replace(/\s+/g, " ").trim();
}

/** O8's number form: "3RD RELEASE" → "3RD". Only an ordinal has a number form; "FINAL RELEASE" keeps its word. */
export function numberForm(line: string): string {
  return line.replace(/\b(\d+(?:ST|ND|RD|TH))\s+RELEASE\b/gi, "$1").replace(/\s+/g, " ").trim();
}

const squash = (s: string) => s.replace(/\s+/g, " ").replace(/\s+,/g, ",").replace(/^,\s*/, "").replace(/\s+([,·&])\s*$/, "").replace(/,$/, "").trim();

/**
 * One O8 drop over every line of a claim that is not a roll-call, or null when
 * it changes nothing. TICKETS and NOW go wherever they are; the number form
 * ("3RD RELEASE" → "3RD", ordinals only) only while another RELEASE stays on
 * the frame.
 */
export function applyDrop(lines: readonly string[], drop: Drop): string[] | null {
  let out: string[];
  if (drop === "TICKETS" || drop === "NOW") {
    const re = new RegExp(`\\b${drop}\\b`, "gi");
    out = lines.map((l) => squash(l.replace(re, " ")));
  } else {
    out = [...lines];
    const re = /\b(\d+(?:ST|ND|RD|TH))\s+RELEASE\b/i;
    for (let i = 0; i < out.length; i += 1) {
      for (;;) {
        const next = out[i]!.replace(re, "$1");
        if (next === out[i]) break;
        const trial = out.map((l, j) => (j === i ? next : l));
        if (!trial.some((l) => /\bRELEASE\b/i.test(l))) break;
        out[i] = next;
      }
    }
  }
  out = out.filter(Boolean);
  return out.every((l, i) => l === lines[i]) && out.length === lines.length ? null : out;
}

/** O35: a claim's states after its last size step — as approved, then O8's drops cumulatively (not for a roll-call: rollCallStates). */
export function plainDropStates(lines: readonly string[]): { lines: string[]; dropped: Drop[] }[] {
  const out: { lines: string[]; dropped: Drop[] }[] = [{ lines: [...lines], dropped: [] }];
  let cur = [...lines];
  const dropped: Drop[] = [];
  for (const d of DROP_ORDER) {
    const next = applyDrop(cur, d);
    if (!next) continue;
    cur = next;
    dropped.push(d);
    out.push({ lines: [...cur], dropped: [...dropped] });
  }
  return out;
}

/**
 * O27: the roll-call's states, in order — as approved, then line 2 with each of
 * O8's drops applied cumulatively. Line 1 is never shortened, so its single
 * RELEASE (A14's shared noun) always stays; line 2 takes the number form only
 * while line 1 keeps RELEASE on the frame. A drop that changes nothing adds no
 * state. Past the last state the claim can't shorten.
 */
export function rollCallStates(line1: string, line2: string): { line1: string; line2: string; dropped: Drop[] }[] {
  const out: { line1: string; line2: string; dropped: Drop[] }[] = [{ line1, line2, dropped: [] }];
  let cur = line2;
  const dropped: Drop[] = [];
  for (const d of DROP_ORDER) {
    const next = d === "number form" ? (/\bRELEASE\b/i.test(line1) ? numberForm(cur) : cur) : dropWord(cur, d);
    if (!next || next === cur) continue;
    cur = next;
    dropped.push(d);
    out.push({ line1, line2: cur, dropped: [...dropped] });
  }
  return out;
}

function stack(texts: { text: string; color: string; cap: number }[], frame: Size): Omit<ClaimPlan, "step"> {
  // Bottom line in O3's box (baseline 0.7927 H); each line above sits one gap over the next line's cap top.
  const lines: ClaimLine[] = [];
  let baseline = CLAIM_SLOT.box.bottom;
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const t = texts[i]!;
    const capTop = baseline - t.cap;
    lines.unshift({ ...t, capTop, baseline, estWidth: estimateWidth(t.text, t.cap, frame) });
    baseline = capTop - CLAIM_SLOT.gapPerCap * t.cap;
  }
  const blockTop = lines[0]!.capTop;
  const band = faceBandWithClaim(blockTop);
  return {
    lines,
    blockTop,
    blockBottom: CLAIM_SLOT.box.bottom,
    chinMax: band.chinMax,
    chinNote: blockTop < CLAIM_SLOT.chinWithClaim ? `the claim block starts at ${blockTop.toFixed(4)} H, above the 0.72 H chin limit; the chin moves to ${blockTop.toFixed(4)} H` : null,
  };
}

/** Plan an approved claim in the T1 slot. Unapproved, empty or too-long text is refused (no third line, no shortening here: O8's shortening happens at proposal time). */
export function planClaim(claim: ApprovedClaim, frame: Size = MASTER): ClaimPlan | { blocker: string } {
  if (!claim.approvedBy?.trim() || !claim.approvedAt?.trim()) return { blocker: "the claim is not approved" };
  if (claim.kind === "roll-call") {
    const line1 = claim.soldOut.trim().toUpperCase();
    const line2 = claim.live.trim().toUpperCase();
    if (!line1 || !line2) return { blocker: "the roll-call needs both lines (O12)" };
    const cap2 = CLAIM_SLOT.cap;
    const cap1 = cap2 * CLAIM_SLOT.rollCall.line1SizeRatio;
    // O12 has one size; O27: past it line 2 takes the drops, line 1 never shortens.
    let widest = 0;
    for (const st of rollCallStates(line1, line2)) {
      const plan = stack([{ text: st.line1, color: KIT_RED, cap: cap1 }, { text: st.line2, color: KIT_WHITE, cap: cap2 }], frame);
      widest = Math.max(...plan.lines.map((l) => l.estWidth));
      if (plan.lines.every((l) => l.estWidth <= CLAIM_SLOT.maxWidth)) return { ...plan, step: "roll-call", dropped: st.dropped };
    }
    return { blocker: `roll-call is about ${widest.toFixed(2)} W at its size (max ${CLAIM_SLOT.maxWidth}) · can't shorten (O27: line 1 is never shortened)` };
  }
  const approved = claim.text.trim().toUpperCase().replace(/\s+/g, " ");
  if (!approved) return { blocker: "the claim is empty" };
  const [s0, s1, s2] = CLAIM_SLOT.steps;
  // O8's steps 0 → 2 on the words as approved; O35: past step 2, each drop in order, retrying the steps.
  for (const st of plainDropStates([approved])) {
    const text = st.lines.join(" ");
    if (text.length <= s0.maxChars && estimateWidth(text, s0.cap, frame) <= CLAIM_SLOT.maxWidth) return { ...stack([{ text, color: KIT_WHITE, cap: s0.cap }], frame), step: 0, dropped: st.dropped };
    const two = splitTwo(text, claim.releaseNames);
    if (two) {
      for (const [i, s] of [[1, s1], [2, s2]] as const) {
        if (two.every((t) => t.length <= s.maxChars && estimateWidth(t, s.cap, frame) <= CLAIM_SLOT.maxWidth)) return { ...stack(two.map((t) => ({ text: t, color: KIT_WHITE, cap: s.cap })), frame), step: i, dropped: st.dropped };
      }
    }
  }
  return { blocker: `"${approved}" doesn't fit two lines at ${s2.cap} H (≤ ${s2.maxChars} characters and ${CLAIM_SLOT.maxWidth} W a line), even with TICKETS, NOW and the number form dropped · can't shorten` };
}

// ─── Rendering (font path) ──────────────────────────────────────────────────

type Sharp = typeof import("sharp");
async function sharpLib(): Promise<Sharp> {
  const m = await import("sharp");
  return ((m as unknown as { default: Sharp }).default ?? (m as unknown as Sharp)) as Sharp;
}

export type ClaimPiece = { png: Buffer; width: number; height: number; left: number; top: number; text: string };

/**
 * Render a planned claim's lines with the kit face, read in place from the
 * font index (never copied). Throws FontHeldError ("Claim held — … not
 * installed", "… is a trial font — not for client work", or the server
 * licence hold) instead of using any other face. Each line is trimmed to its
 * ink and centred, its cap top on the planned line; the caller adds O6's
 * shadow once on the text group.
 */
export async function renderClaimLines(plan: ClaimPlan, index: readonly FontEntry[], opts: { server?: boolean; frame?: Size } = {}): Promise<ClaimPiece[]> {
  const face = requireFont(CLAIM_FONT, index, { server: opts.server });
  const frame = opts.frame ?? MASTER;
  const sharp = await sharpLib();
  const capPerEm = face.capHeight && face.unitsPerEm ? face.capHeight / face.unitsPerEm : null;
  if (!capPerEm) throw new Error(`${face.file} has no OS/2 cap height; claim lines can't be sized to the slot`);
  const out: ClaimPiece[] = [];
  for (const line of plan.lines) {
    const capPx = line.cap * frame.height;
    const sizePx = Math.round(capPx / capPerEm);
    const escaped = line.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    // Pango's letter_spacing is in 1/1024 pt; at 72 dpi a point is a pixel.
    const spacing = Math.round((CLAIM_TRACKING / 1000) * sizePx * 1024);
    const img = await sharp({ text: { text: `<span foreground="${line.color}" letter_spacing="${spacing}">${escaped}</span>`, font: `${face.family ?? CLAIM_FONT} ${sizePx}`, fontfile: face.path, dpi: 72, rgba: true } }).png().toBuffer();
    const trimmed = await sharp(img).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
    const png = await sharp(trimmed.data).png().toBuffer();
    const { width, height } = trimmed.info;
    out.push({ png, width, height, left: Math.round((frame.width - width) / 2), top: Math.round(line.capTop * frame.height), text: line.text });
  }
  return out;
}

// ─── O23: the claim on the artist card (overlay-templates issue 3) ─────────

/**
 * O23 replaces O3's claim position on the artist card (T1 clips keep O3).
 * Words verbatim from the approved claim, with its line break; displayed in
 * the kit's case (Puzzle: capitals, root locale) — the approved words stay
 * exactly as approved for storage and comparison, and the fit is measured on
 * the line as displayed.
 * The roll-call keeps the PSD's sizes against the full name cap (220 px):
 * line 1 kit red at 0.217 → 48 px, line 2 white at 0.347 → 76 px, 22 px apart;
 * a one-line "FINAL {n} TICKETS" is red at 0.556 → 122 px, any other one-line
 * claim white at 0.479 → 105 px. Bottom-anchored: the last line sits on
 * 0.812 H (y 1559). Each line within 80 % W (864 px); too wide, every line
 * steps down together keeping its ratio, the bottom staying on y 1559; floors
 * 31 px (a two-line claim's line 1) and 50 px (a one-line claim); below them
 * the card is held. Never condensed, never three lines.
 */
export const CARD_CLAIM = {
  nameCap: 220,
  bottom: 1559,
  maxWidth: 864,
  twoLine: { line1Cap: 48, line2Cap: 76, gap: 22, line1Floor: 31 },
  oneLine: { redCap: 122, whiteCap: 105, floor: 50 },
  ratios: { line1: 0.217, line2: 0.347, finalTickets: 0.556, onePiece: 0.479 },
  /** The face band's chin with a claim on the card (was 0.76 H). */
  chinMax: 0.72,
  /** The claim box runs 0.07–0.93 W; ≤ 15 % of it below 3:1 against white (amended from 10 % before #1155 merged). */
  box: { left: 0.07, right: 0.93 },
  claimBoxMax: 0.15,
  /** The red line is tested on its own ink box: its width + 24 px each side, its cap + 12 px above and below; ≤ 25 % below 2:1 against #FE3232. */
  redInk: { padX: 24, padY: 12, max: 0.25 },
  /** With a claim: the face floor drops to 200 px (216 without) and the top extension may reach 0.33 H (634 px) when the 0.72 H chin forces it. */
  faceFloorPx: 200,
  maxTopPx: 634,
  /** The kit's case for claims: Puzzle's CTAs are all capitals. */
  kitCase: "upper" as "upper" | "as-approved",
  tooLong: "Claim too long for the artist card",
  redToWhite: "claim line 1 in white — red unreadable on this photo",
} as const;

export type CardClaimLine = {
  /** As displayed (the kit's case). */
  text: string;
  /** Exactly as approved, never case-folded. */
  approvedText: string;
  color: "red" | "white";
  capPx: number;
  capTop: number;
  widthPx: number;
};

/** A line in the kit's case: capitals with the root locale (String.prototype.toUpperCase is locale-independent). */
export function inKitCase(text: string, kitCase: "upper" | "as-approved" = CARD_CLAIM.kitCase): string {
  return kitCase === "upper" ? text.toUpperCase() : text;
}
export type CardClaimPlan = {
  kind: "two-line" | "final-tickets" | "one-line";
  lines: CardClaimLine[];
  k: number;
  blockTop: number;
  bottom: number;
  /** O27: the drops a roll-call's line 2 took to stay above the floor (empty when none). */
  dropped: Drop[];
};

/** A line's ink width (px) at a cap height, in the kit face; the caller measures (a rendered line, or a fake in tests). */
export type MeasureLine = (text: string, capPx: number) => number;

/** O23 placement of an approved claim on the 9:16 artist card, or the hold line. */
export function planCardClaim(approved: string, measure: MeasureLine, kitCase: "upper" | "as-approved" = CARD_CLAIM.kitCase): CardClaimPlan | { held: string } {
  const lines = approved.replace(/\r\n?/g, "\n").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { held: "no approved claim" };
  if (lines.length > 2) return { held: CARD_CLAIM.tooLong };
  const c = CARD_CLAIM;
  let kind: CardClaimPlan["kind"];
  let base: { text: string; approvedText: string; color: "red" | "white"; capPx: number }[];
  let floorK: number;
  if (lines.length === 2) {
    kind = "two-line";
    base = [
      { text: inKitCase(lines[0]!, kitCase), approvedText: lines[0]!, color: "red", capPx: c.twoLine.line1Cap },
      { text: inKitCase(lines[1]!, kitCase), approvedText: lines[1]!, color: "white", capPx: c.twoLine.line2Cap },
    ];
    floorK = c.twoLine.line1Floor / c.twoLine.line1Cap;
  } else if (/^final\s+\d+\s+tickets$/i.test(lines[0]!)) {
    kind = "final-tickets";
    base = [{ text: inKitCase(lines[0]!, kitCase), approvedText: lines[0]!, color: "red", capPx: c.oneLine.redCap }];
    floorK = c.oneLine.floor / c.oneLine.redCap;
  } else {
    kind = "one-line";
    base = [{ text: inKitCase(lines[0]!, kitCase), approvedText: lines[0]!, color: "white", capPx: c.oneLine.whiteCap }];
    floorK = c.oneLine.floor / c.oneLine.whiteCap;
  }
  // O27 / O35: a claim that would fall below the floor tries the drops in order; a roll-call's line 1 never shortens.
  // O35: after the floors, O8's drops — on a roll-call only line 2 (O27), otherwise every line; the line count never changes.
  const states = isRollCall(lines)
    ? rollCallStates(base[0]!.text, base[1]!.text).map((st) => ({ texts: [st.line1, st.line2], dropped: st.dropped }))
    : plainDropStates(base.map((l) => l.text)).filter((st) => st.lines.length === base.length).map((st) => ({ texts: st.lines, dropped: st.dropped }));
  let chosen: { texts: string[]; dropped: Drop[]; widths: number[]; k: number } | null = null;
  for (const st of states) {
    const widths = st.texts.map((t, i) => measure(t, base[i]!.capPx));
    const k = Math.min(1, ...widths.map((w) => (w > 0 ? c.maxWidth / w : 1)));
    if (k >= floorK - 1e-9) {
      chosen = { ...st, widths, k };
      break;
    }
  }
  if (!chosen) return { held: c.tooLong };
  const { widths, k } = chosen;
  base = base.map((l, i) => ({ ...l, text: chosen!.texts[i]! }));
  // Bottom-anchored on y 1559; the 22 px gap steps with the lines (0.29 × line 2's cap).
  const out: CardClaimLine[] = [];
  let baseline: number = c.bottom;
  for (let i = base.length - 1; i >= 0; i -= 1) {
    const capPx = base[i]!.capPx * k;
    const capTop = baseline - capPx;
    out.unshift({ ...base[i]!, capPx, capTop, widthPx: widths[i]! * k });
    baseline = capTop - c.twoLine.gap * k;
  }
  return { kind, lines: out, k, blockTop: out[0]!.capTop, bottom: c.bottom, dropped: chosen.dropped };
}

export type CardLinePiece = { png: Buffer; width: number; height: number; /** Row of the cap top inside png. */ capTopRow: number };

/**
 * One claim line in the kit face, read in place from the font index: trimmed
 * left and right to its ink, full line height kept, with the row its cap top
 * falls on (measured from an "H" set the same way), so a mixed-case line sits
 * by its caps, not by an ascender or descender.
 */
export async function renderCardLine(text: string, colorHex: string, capPx: number, face: FontEntry): Promise<CardLinePiece> {
  const sharp = await sharpLib();
  const capPerEm = face.capHeight && face.unitsPerEm ? face.capHeight / face.unitsPerEm : null;
  if (!capPerEm) throw new Error(`${face.file} has no OS/2 cap height; claim lines can't be sized`);
  const sizePx = capPx / capPerEm;
  const spacing = Math.round((CLAIM_TRACKING / 1000) * sizePx * 1024);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const set = async (s: string) => {
    const img = await sharp({ text: { text: `<span foreground="${colorHex}" letter_spacing="${spacing}">${esc(s)}</span>`, font: `${face.family ?? CLAIM_FONT} ${sizePx.toFixed(2)}`, fontfile: face.path, dpi: 72, rgba: true } }).raw().toBuffer({ resolveWithObject: true });
    return img;
  };
  const inkRows = (img: { data: Buffer; info: { width: number; height: number } }) => {
    let top = -1;
    let bottom = -1;
    let left = img.info.width;
    let right = -1;
    for (let y = 0; y < img.info.height; y += 1) {
      for (let x = 0; x < img.info.width; x += 1) {
        if (img.data[(y * img.info.width + x) * 4 + 3]! > 8) {
          if (top < 0) top = y;
          bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    return { top, bottom, left, right };
  };
  const ref = inkRows(await set("H"));
  const line = await set(text);
  const ink = inkRows(line);
  if (ink.right < 0 || ref.top < 0) throw new Error(`claim line "${text}" set no ink`);
  const width = ink.right - ink.left + 1;
  const png = await sharp(line.data, { raw: { width: line.info.width, height: line.info.height, channels: 4 } }).extract({ left: ink.left, top: 0, width, height: line.info.height }).png().toBuffer();
  return { png, width, height: line.info.height, capTopRow: ref.top };
}
