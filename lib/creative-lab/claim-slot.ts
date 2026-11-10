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
 *     65.1 px, line 2 "FINAL RELEASE RUNNING LOW" white at 104.2 px; line 1's
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
  | { kind: "claim"; text: string; approvedBy: string; approvedAt: string }
  | { kind: "roll-call"; soldOut: string; live: string; approvedBy: string; approvedAt: string };

export type ClaimLine = { text: string; color: string; cap: number; capTop: number; baseline: number; estWidth: number };

export type ClaimPlan = {
  lines: ClaimLine[];
  /** O8 step reached (0, 1, 2), or "roll-call". */
  step: 0 | 1 | 2 | "roll-call";
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

/** The two-line break with the most even halves, at a space. */
export function splitTwo(text: string): [string, string] | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best: [string, string] | null = null;
  let diff = Infinity;
  for (let i = 1; i < words.length; i += 1) {
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
    const plan = stack([{ text: line1, color: KIT_RED, cap: cap1 }, { text: line2, color: KIT_WHITE, cap: cap2 }], frame);
    const over = plan.lines.find((l) => l.estWidth > CLAIM_SLOT.maxWidth);
    if (over) return { blocker: `roll-call line "${over.text}" is about ${over.estWidth.toFixed(2)} W at its size (max ${CLAIM_SLOT.maxWidth}); O12 has no smaller step` };
    return { ...plan, step: "roll-call" };
  }
  const text = claim.text.trim().toUpperCase().replace(/\s+/g, " ");
  if (!text) return { blocker: "the claim is empty" };
  const [s0, s1, s2] = CLAIM_SLOT.steps;
  if (text.length <= s0.maxChars && estimateWidth(text, s0.cap, frame) <= CLAIM_SLOT.maxWidth) return { ...stack([{ text, color: KIT_WHITE, cap: s0.cap }], frame), step: 0 };
  const two = splitTwo(text);
  if (two) {
    for (const [i, s] of [[1, s1], [2, s2]] as const) {
      if (two.every((t) => t.length <= s.maxChars && estimateWidth(t, s.cap, frame) <= CLAIM_SLOT.maxWidth)) return { ...stack(two.map((t) => ({ text: t, color: KIT_WHITE, cap: s.cap })), frame), step: i };
    }
  }
  return { blocker: `"${text}" doesn't fit two lines at ${s2.cap} H (≤ ${s2.maxChars} characters and ${CLAIM_SLOT.maxWidth} W a line); shorten it per O8 before approval` };
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
