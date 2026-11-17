/**
 * VW2–VW5 (docs/design-record/2026-11-17-creative-lab-video-window.html):
 * every Lab video edit is 15–20 s with the drop 3–5 s in. Pure rules and
 * words. The drops come from clip-drops.ts, stored on the clip as
 * creative_lab_clips.drops (migration 258). The window a render reads is
 * the clip's in_s / out_s, which detection and the picker write from here,
 * so T1, T2, captions, quotes and the triple-fit all cut the same one.
 */

import type { DropCandidate } from "./clip-drops.ts";

export const WINDOW_RULE = {
  /** VW2: the default window, seconds, and where the drop sits in it. */
  defaultLengthS: 16,
  defaultDropInS: 4,
  /** VW2's limits. */
  minLengthS: 15,
  maxLengthS: 20,
  minDropInS: 3,
  maxDropInS: 5,
  /** VW4's steps. */
  dropInStepS: 0.1,
  lengthStepS: 1,
} as const;

/** VW2: a clip needs this much sound after the drop (15 s less the most the drop can be in). */
export const MIN_AFTER_S = WINDOW_RULE.minLengthS - WINDOW_RULE.maxDropInS;

/** What creative_lab_clips.drops holds (migration 258). */
export type StoredDrops =
  | {
    v: 1;
    status: "ok";
    /** The creative_assets row the sound was read from: the render copy (O68), else the original. */
    assetId: string;
    /** The clip's length, seconds. */
    durationS: number;
    /** False: no audio stream, or the whole clip under −50 LUFS. */
    hasSound: boolean;
    lufs: number | null;
    /** Every candidate, time order. */
    candidates: DropCandidate[];
    mainS: number | null;
    peaks: number[];
  }
  | { v: 1; status: "failed"; assetId: string | null; error: string };

/** The operator's window, as stored beside the drops (migration 258). */
export type WindowChoice = {
  /** The drop the operator chose instead of the main one, or null. */
  dropS: number | null;
  /** True once the operator changed the window (VW5's " · set by hand"). */
  byHand: boolean;
  inS: number | null;
  outS: number | null;
};

export type EditWindow = { inS: number; outS: number; dropS: number; dropInS: number; lengthS: number };

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ─── Words (VW3, VW5) ────────────────────────────────────────────────────────

/** {m:ss.s}: 16.4 → "0:16.4". */
export function clock(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths - minutes * 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** {n.n}: one decimal. */
export function tenth(seconds: number): string {
  return r1(seconds).toFixed(1);
}

export type RefusalKind = "noSound" | "tooShort" | "noDrop" | "tooSoon" | "tooLittleAfter";

export const VW_LINES = {
  /** VW3's tile chips, in VW3's order. */
  chip: {
    noSound: "No sound",
    tooShort: "Too short for an edit",
    noDrop: "No clear drop",
    tooSoon: "Drop too soon",
    tooLittleAfter: "Too little after the drop",
  } satisfies Record<RefusalKind, string>,
  noSound: "This clip has no sound, so there's no drop to build the edit on.",
  tooShort: (lengthS: number) => `This clip is ${tenth(lengthS)} s long. An edit needs 15 s, with 3 s before the drop and 10 s after it.`,
  noDrop: "No clear drop in this clip's sound, so it can't make a 15–20 s edit. Choose another clip.",
  tooSoon: (mainS: number) => `The main drop is ${tenth(mainS)} s in. An edit needs 3 s before it.`,
  tooLittleAfter: (afterS: number, mainS: number) => `Only ${tenth(afterS)} s after the main drop at ${clock(mainS)}. An edit needs 10 s after it.`,
  dropAction: (dropS: number) => `Use the drop at ${clock(dropS)}`,
  /** VW5. */
  heading: "Edit window",
  summary: (w: Pick<EditWindow, "dropS" | "dropInS" | "lengthS">, byHand: boolean) =>
    `Drop at ${clock(w.dropS)} · ${tenth(w.dropInS)} s in · ${Math.round(w.lengthS)} s long${byHand ? " · set by hand" : ""}`,
  mainDrop: (c: DropCandidate) => `Main drop ${clock(c.tS)}`,
  otherDrop: (c: DropCandidate) => clock(c.tS),
  rises: (c: DropCandidate) => `rises ${Math.round(c.riseDb)} dB`,
  useThisDrop: "Use this drop",
  doesntFit: "doesn't fit",
  inUse: "in use",
  dropInAt: "Drop in at",
  length: "Length",
  dropInRange: "3.0–5.0 s",
  lengthRange: "15–20 s",
  back: "Back to the detected window",
  dropMarker: "DROP",
} as const;

// ─── VW2 ─────────────────────────────────────────────────────────────────────

/** VW2's limits for one drop: 3 s before it and 10 s after it, in a clip of 15 s or more. */
export function dropFits(dropS: number, durationS: number): boolean {
  return durationS + 1e-9 >= WINDOW_RULE.minLengthS && dropS + 1e-9 >= WINDOW_RULE.minDropInS && durationS - dropS + 1e-9 >= MIN_AFTER_S;
}

/**
 * VW2's default window for a drop that fits: 16 s from 4.0 s before it; at
 * the clip's start when the drop is under 4.0 s in; shortened to the clip's
 * end down to 15 s; then started earlier until it is 15 s, which puts the
 * drop up to 5.0 s in. Null for a drop that doesn't fit.
 */
export function defaultWindow(dropS: number, durationS: number): EditWindow | null {
  if (!dropFits(dropS, durationS)) return null;
  let inS = Math.max(0, dropS - WINDOW_RULE.defaultDropInS);
  let lengthS = Math.min(WINDOW_RULE.defaultLengthS, durationS - inS);
  if (lengthS < WINDOW_RULE.minLengthS) {
    inS = durationS - WINDOW_RULE.minLengthS;
    lengthS = WINDOW_RULE.minLengthS;
  }
  return shape(dropS, inS, lengthS);
}

function shape(dropS: number, inS: number, lengthS: number): EditWindow {
  return { inS: r3(inS), outS: r3(inS + lengthS), dropS: r3(dropS), dropInS: r1(dropS - inS), lengthS: r3(lengthS) };
}

/** True when a window keeps VW2's limits on this clip. */
export function withinLimits(w: Pick<EditWindow, "inS" | "outS" | "dropS">, durationS: number): boolean {
  const lengthS = w.outS - w.inS;
  const dropInS = w.dropS - w.inS;
  return (
    w.inS >= -1e-6
    && w.outS <= durationS + 1e-3
    && lengthS + 1e-6 >= WINDOW_RULE.minLengthS
    && lengthS - 1e-6 <= WINDOW_RULE.maxLengthS
    && dropInS + 1e-6 >= WINDOW_RULE.minDropInS
    && dropInS - 1e-6 <= WINDOW_RULE.maxDropInS
  );
}

/**
 * VW4: the window for a drop, a "drop in at" and a length. Each is snapped to
 * its step; null when the result is outside VW2's limits or the clip.
 */
export function nudgedWindow(dropS: number, dropInS: number, lengthS: number, durationS: number): EditWindow | null {
  const dropIn = Math.round(dropInS / WINDOW_RULE.dropInStepS) * WINDOW_RULE.dropInStepS;
  const length = Math.round(lengthS / WINDOW_RULE.lengthStepS) * WINDOW_RULE.lengthStepS;
  const w = shape(dropS, dropS - dropIn, length);
  return withinLimits(w, durationS) ? w : null;
}

/** VW4's stepper: the next "drop in at" either way, or null at the limit. */
export function stepDropIn(w: EditWindow, direction: -1 | 1, durationS: number): EditWindow | null {
  return nudgedWindow(w.dropS, r1(w.dropInS + direction * WINDOW_RULE.dropInStepS), w.lengthS, durationS);
}

/** VW4's stepper: the next length either way, or null at the limit or past the clip's end. */
export function stepLength(w: EditWindow, direction: -1 | 1, durationS: number): EditWindow | null {
  return nudgedWindow(w.dropS, w.dropInS, Math.round(w.lengthS) + direction * WINDOW_RULE.lengthStepS, durationS);
}

// ─── VW3 and the clip's state ────────────────────────────────────────────────

export type WindowState =
  /** Not checked yet (before the backfill, or the import's check is still to land). The stored window stands. */
  | { kind: "pending" }
  | { kind: "refused"; refusal: RefusalKind; chip: string; sentence: string; useDrop: DropCandidate | null; drops: StoredDrops }
  | { kind: "ok"; window: EditWindow; detected: EditWindow | null; byHand: boolean; drops: Extract<StoredDrops, { status: "ok" }> };

/** VW3's "Use the drop at": the fitting candidate other than the main drop with the largest rise, the earlier on a tie. */
function anotherDrop(drops: Extract<StoredDrops, { status: "ok" }>, mainS: number): DropCandidate | null {
  const fits = drops.candidates.filter((c) => Math.abs(c.tS - mainS) > 1e-6 && dropFits(c.tS, drops.durationS));
  fits.sort((a, b) => b.riseDb - a.riseDb || a.tS - b.tS);
  return fits[0] ?? null;
}

/** VW3's checks, in order, on the main drop. Null when the main drop makes an edit. */
export function refusalOf(drops: StoredDrops): Extract<WindowState, { kind: "refused" }> | null {
  const refuse = (refusal: RefusalKind, sentence: string, useDrop: DropCandidate | null = null) =>
    ({ kind: "refused", refusal, chip: VW_LINES.chip[refusal], sentence, useDrop, drops }) as const;
  // The coordinator's rule: a failed check refuses the clip, with VW3's no-drop words.
  if (drops.status === "failed") return refuse("noDrop", VW_LINES.noDrop);
  if (!drops.hasSound) return refuse("noSound", VW_LINES.noSound);
  if (drops.durationS + 1e-9 < WINDOW_RULE.minLengthS) return refuse("tooShort", VW_LINES.tooShort(drops.durationS));
  const main = drops.mainS == null ? null : drops.candidates.find((c) => Math.abs(c.tS - drops.mainS!) < 1e-6) ?? null;
  if (!main) return refuse("noDrop", VW_LINES.noDrop);
  if (main.tS + 1e-9 < WINDOW_RULE.minDropInS) return refuse("tooSoon", VW_LINES.tooSoon(main.tS), anotherDrop(drops, main.tS));
  const after = drops.durationS - main.tS;
  if (after + 1e-9 < MIN_AFTER_S) return refuse("tooLittleAfter", VW_LINES.tooLittleAfter(after, main.tS), anotherDrop(drops, main.tS));
  return null;
}

/** Reads creative_lab_clips.drops; anything else is "not checked". */
export function parseStoredDrops(value: unknown): StoredDrops | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1) return null;
  if (v.status === "failed") return { v: 1, status: "failed", assetId: typeof v.assetId === "string" ? v.assetId : null, error: String(v.error ?? "") };
  if (v.status !== "ok") return null;
  const durationS = Number(v.durationS);
  if (!Number.isFinite(durationS)) return null;
  const candidates = Array.isArray(v.candidates)
    ? v.candidates
      .map((c) => ({ tS: Number((c as Record<string, unknown>)?.tS), riseDb: Number((c as Record<string, unknown>)?.riseDb) }))
      .filter((c) => Number.isFinite(c.tS) && Number.isFinite(c.riseDb))
      .sort((a, b) => a.tS - b.tS)
    : [];
  const mainS = v.mainS == null || !Number.isFinite(Number(v.mainS)) ? null : Number(v.mainS);
  return {
    v: 1,
    status: "ok",
    assetId: String(v.assetId ?? ""),
    durationS,
    hasSound: v.hasSound !== false,
    lufs: v.lufs == null || !Number.isFinite(Number(v.lufs)) ? null : Number(v.lufs),
    candidates,
    mainS,
    peaks: Array.isArray(v.peaks) ? v.peaks.map((p) => Math.max(0, Math.min(1, Number(p) || 0))) : [],
  };
}

/**
 * The clip's window state. A chosen drop that fits wins over the main drop
 * (VW3's chip goes once "Use the drop at" is used). The stored in/out stands
 * when it keeps VW2's limits around the drop in use; otherwise the default
 * for that drop.
 */
export function windowState(drops: StoredDrops | null, choice: WindowChoice): WindowState {
  if (!drops) return { kind: "pending" };
  const refused = refusalOf(drops);
  if (drops.status !== "ok") return refused!;
  const detected = refused ? null : defaultWindow(drops.mainS!, drops.durationS);
  const chosen = choice.dropS == null ? null : drops.candidates.find((c) => Math.abs(c.tS - choice.dropS!) < 0.0005 && dropFits(c.tS, drops.durationS)) ?? null;
  const dropS = chosen?.tS ?? (refused ? null : drops.mainS);
  if (dropS == null) return refused!;
  const stored = choice.inS != null && choice.outS != null ? { inS: choice.inS, outS: choice.outS, dropS } : null;
  const window = stored && withinLimits(stored, drops.durationS)
    ? shape(dropS, stored.inS, stored.outS - stored.inS)
    : defaultWindow(dropS, drops.durationS)!;
  const byHand = choice.byHand && !(detected && sameWindow(window, detected));
  return { kind: "ok", window, detected, byHand, drops };
}

export function sameWindow(a: Pick<EditWindow, "inS" | "outS">, b: Pick<EditWindow, "inS" | "outS">): boolean {
  return Math.abs(a.inS - b.inS) < 0.0005 && Math.abs(a.outS - b.outS) < 0.0005;
}

/** VW3 for the tile: the chip, or null when the clip makes an edit (or isn't checked yet). */
export function windowChip(state: WindowState): string | null {
  return state.kind === "refused" ? state.chip : null;
}

// ─── VW5: the picker's view ──────────────────────────────────────────────────

export type DropLine = { tS: number; label: string; rises: string; main: boolean; inUse: boolean; fits: boolean };

/** VW5's drop lines, the main drop first, then the rest in time order. */
export function dropLines(state: WindowState): DropLine[] {
  if (state.kind === "pending" || state.drops.status !== "ok") return [];
  const drops = state.drops;
  const inUse = state.kind === "ok" ? state.window.dropS : null;
  const lines = drops.candidates.map((c) => {
    const main = drops.mainS != null && Math.abs(c.tS - drops.mainS) < 1e-6;
    return {
      tS: c.tS,
      label: main ? VW_LINES.mainDrop(c) : VW_LINES.otherDrop(c),
      rises: VW_LINES.rises(c),
      main,
      inUse: inUse != null && Math.abs(c.tS - inUse) < 0.0005,
      fits: dropFits(c.tS, drops.durationS),
    };
  });
  return lines.sort((a, b) => Number(b.main) - Number(a.main) || a.tS - b.tS);
}

/** The timeline under the waveform: every 10 s, then the clip's end; a phone shows every 20 s. */
export function timelineTicks(durationS: number, phone: boolean): string[] {
  const every = phone ? 20 : 10;
  const ticks: string[] = [];
  for (let t = 0; t < durationS - every / 2; t += every) ticks.push(clock(t).replace(/\.\d$/, ""));
  ticks.push(clock(durationS).replace(/\.\d$/, ""));
  return ticks;
}

/** What the picker saves (POST /api/creative-lab/clips/[id]/window). */
export type WindowRequest =
  | { action: "nudge"; dropS: number; dropInS: number; lengthS: number }
  | { action: "useDrop"; dropS: number }
  | { action: "reset" };

/**
 * The stored columns after a request, or the sentence that refuses it. A
 * drop is only ever one of the clip's own candidates (VW4: never a drop by
 * hand), and nothing leaves VW2's limits.
 */
export function applyWindowRequest(
  drops: StoredDrops | null,
  request: WindowRequest,
): { ok: true; columns: { window_drop_s: number | null; window_by_hand: boolean; in_s: number | null; out_s: number | null } } | { ok: false; error: string } {
  if (!drops || drops.status !== "ok") return { ok: false, error: "This clip's sound hasn't been checked yet." };
  const main = drops.mainS;
  if (request.action === "reset") {
    const detected = refusalOf(drops) ? null : defaultWindow(main!, drops.durationS);
    return { ok: true, columns: { window_drop_s: null, window_by_hand: false, in_s: detected?.inS ?? null, out_s: detected?.outS ?? null } };
  }
  const candidate = drops.candidates.find((c) => Math.abs(c.tS - request.dropS) < 0.0005);
  if (!candidate) return { ok: false, error: "That drop isn't one this clip's sound shows." };
  if (!dropFits(candidate.tS, drops.durationS)) return { ok: false, error: "That drop can't make a 15–20 s edit." };
  const window = request.action === "useDrop"
    ? defaultWindow(candidate.tS, drops.durationS)
    : nudgedWindow(candidate.tS, request.dropInS, request.lengthS, drops.durationS);
  if (!window) return { ok: false, error: "That window is outside 15–20 s with the drop 3.0–5.0 s in." };
  const isMain = main != null && Math.abs(candidate.tS - main) < 1e-6;
  return { ok: true, columns: { window_drop_s: isMain ? null : candidate.tS, window_by_hand: true, in_s: window.inS, out_s: window.outS } };
}

const numOrNull = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** windowState from a creative_lab_clips row (select "*"). Before migration 258 the columns are absent: pending. */
export function windowStateOfRow(row: Readonly<Record<string, unknown>> | null | undefined): WindowState {
  return windowState(parseStoredDrops(row?.drops), {
    dropS: numOrNull(row?.window_drop_s),
    byHand: row?.window_by_hand === true,
    inS: numOrNull(row?.in_s),
    outS: numOrNull(row?.out_s),
  });
}

/** The sentence a render row shows for a clip VW3 refuses, else null. */
export function windowRefusalSentence(row: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const state = windowStateOfRow(row);
  return state.kind === "refused" ? state.sentence : null;
}
