/**
 * Variant pairs (docs/design-record/2026-11-18-creative-test-variant-pairs.html,
 * VP1–VP10): two versions of one asset, tested against each other, each with an
 * operator label. A pair is a test of kind "pair" (migration 261); what kind of
 * pair it is (track, clip or card), its asset, its two windows, its static, its
 * sign-off and its artist-page approval sit in creative_tests.held.
 *
 * This build makes track pairs (VP2): two windows of one track file on one
 * static at one length. The clip and card makers come in their own PRs (VP3);
 * their words are here only where the record gives them.
 *
 * Every string is the record's. Pure: no database, no Meta.
 */

import { clampWindow, clampLength } from "./snippet.ts";
import { londonDayLabel, type TestAdSetKind } from "./tests-campaign.ts";

export type PairKind = "track" | "clip" | "card";

/** VP4's {kind}: "Track", "Clip" or "Card". */
export const PAIR_KIND_WORD: Record<PairKind, string> = { track: "Track", clip: "Clip", card: "Card" };

/** VP4: the ad set's kind, "{kind} pair" (TT10, extended). */
export function pairAdSetKind(kind: PairKind): TestAdSetKind {
  return `${PAIR_KIND_WORD[kind]} pair` as TestAdSetKind;
}

export const PAIR = {
  /** VP1: a label is at most this long. */
  labelMax: 60,
  /** VP2: each window's drop lands this far in (VW2's shape). */
  dropInMin: 3,
  dropInMax: 5,
  /** VP1: a pair has exactly two variants. */
  variants: 2,
} as const;

/** Who signed off and when (VP7). `by` is the user id; the words always say Matas, the only one who can. */
export type Approval = { by: string; at: string };

export type PairWindow = { startS: number; dropS: number };

/** creative_tests.held for a track pair. */
export type PairHeld = {
  pair: PairKind;
  /** The one track file (creative_lab_audio_files.id). */
  audioFileId: string;
  /** VP6's {asset}: the track's title as CT11 names it. */
  asset: string;
  static: string;
  staticDriveFileId: string;
  lengthS: number;
  /** The two windows, in variant order (earlier start first). */
  windows: PairWindow[];
  signOff: Approval | null;
  artistPageApproval: Approval | null;
};

// ── The words ───────────────────────────────────────────────────────────────

export const ONE_WINDOW = "One window";
export const PAIR_SWITCH = "Pair";
export const STARTS_AT = "Starts at";
export const WINDOW_FROM = "Window from";
export const SIGN_OFF = "Sign off";
export const RECORD_ARTIST_PAGE = "Record artist-page approval";
export const APPROVE_VARIANTS = "Approve variants";

/** VP9's refusals, at "Make pair" and again at Approve. */
export const PLACE_SECOND_DROP = "Place the second drop.";
export const WINDOWS_OVERLAP = "The two windows overlap. Move one so they don't.";
export const LABEL_MISSING = "Give each version a label.";
export const LABELS_SAME = "The two labels are the same. Change one.";
/** New words (VP1 gives the 60-character limit, not a sentence for it): listed for design. */
export const LABEL_TOO_LONG = "A label is at most 60 characters.";
/** VP7: Approve only. */
export const WAITING_SIGN_OFF = "Waiting for sign-off from Matas.";
export const WAITING_ARTIST_PAGE = "Waiting for artist-page approval.";

/** "{label}: the drop is {d} s in. Move the window so the drop is 3 to 5 s in." ({d} with one decimal). */
export function dropInText(label: string, dropIn: number): string {
  return `${label}: the drop is ${dropIn.toFixed(1)} s in. Move the window so the drop is 3 to 5 s in.`;
}

/** VP7: "Signed off by Matas · {d Mon}", the London day he recorded it. */
export function signedOffText(at: string): string {
  return `Signed off by Matas · ${londonDayLabel(at)}`;
}

/** VP7: "Artist-page approval recorded by Matas · {d Mon}". */
export function artistPageText(at: string): string {
  return `Artist-page approval recorded by Matas · ${londonDayLabel(at)}`;
}

/** VP2: "Make pair · {Track}". */
export function makePairText(asset: string): string {
  return `Make pair · ${asset}`;
}

/** VP1's track-pair defaults: "{Track} · earlier drop" and "{Track} · payoff drop". */
export function trackPairLabels(track: string): [string, string] {
  return [`${track} · earlier drop`, `${track} · payoff drop`];
}

/** VP6: "Test {n} · {kind} pair · {asset}". */
export function pairTestName(n: number, kind: PairKind, asset: string): string {
  return `Test ${n} · ${PAIR_KIND_WORD[kind]} pair · ${asset}`;
}

/** VP2: m:ss, keeping up to two decimals when it isn't whole: "0:07", "2:03.5", "1:46.85". */
export function preciseTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const m = Math.floor(cs / 6000);
  const rest = cs - m * 6000;
  const s = Math.floor(rest / 100);
  const frac = rest % 100;
  const tail = frac ? `.${String(frac).padStart(2, "0").replace(/0$/, "")}` : "";
  return `${m}:${String(s).padStart(2, "0")}${tail}`;
}

/** "{start}–{end}": "2:03.5–2:19.5". */
export function preciseSpan(startS: number, lengthS: number): string {
  return `${preciseTime(startS)}–${preciseTime(startS + lengthS)}`;
}

/** The drop's distance into its window, to the hundredth (so 127.5 − 123.5 is exactly 4). */
export function dropIn(startS: number, dropS: number): number {
  return Math.round((dropS - startS) * 100) / 100;
}

/** VP2's box line: "{start}–{end} · {length} s · drop {d} s in" (no drop part before a marker is placed). */
export function boxLine(startS: number, lengthS: number, dropS: number | null): string {
  const base = `${preciseSpan(startS, lengthS)} · ${lengthS} s`;
  return dropS == null ? base : `${base} · drop ${dropIn(startS, dropS).toFixed(1)} s in`;
}

/** VP6 at 1280, internal only: "{span 1} vs {span 2} · Static: {name}" for a track pair. */
export function spanLine(held: Pick<PairHeld, "pair" | "windows" | "lengthS" | "static">): string {
  const spans = held.windows.map((w) => preciseSpan(w.startS, held.lengthS)).join(" vs ");
  if (held.pair === "card") return "Framing 1 vs framing 2";
  return held.pair === "track" ? `${spans} · Static: ${held.static}` : spans;
}

/** "Starts at": m:ss with up to two decimals ("2:03.5", "1:46.85"), or plain seconds. Null when it can't be read. */
export function parseStartsAt(text: string): number | null {
  const t = text.trim();
  const clock = /^(\d+):([0-5]\d)(?:\.(\d{1,2}))?$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + (clock[3] ? Number(`0.${clock[3]}`) : 0);
  if (/^\d+(?:\.\d{1,2})?$/.test(t)) return Number(t);
  return null;
}

// ── VP2's rules ─────────────────────────────────────────────────────────────

export type PairBox = { label: string; startS: number | null; dropS: number | null };

/** The boxes in variant order: earlier start first (VP1). */
export function orderBoxes<T extends { startS: number | null }>(boxes: readonly T[]): T[] {
  return [...boxes].sort((a, b) => (a.startS ?? Infinity) - (b.startS ?? Infinity));
}

/**
 * A track pair's refusal, or null when it can be made (VP2, VP9): both drops
 * placed; each label there, different and at most 60 characters; each drop 3 to
 * 5 s into its window; and the two windows apart. Both windows share one length.
 */
export function trackPairRefusal(input: { lengthS: number; boxes: readonly PairBox[] }): string | null {
  const { boxes } = input;
  if (boxes.length !== PAIR.variants || boxes.some((b) => b.startS == null || b.dropS == null)) return PLACE_SECOND_DROP;
  const labels = boxes.map((b) => b.label.trim());
  if (labels.some((l) => !l)) return LABEL_MISSING;
  if (labels[0] === labels[1]) return LABELS_SAME;
  if (labels.some((l) => l.length > PAIR.labelMax)) return LABEL_TOO_LONG;
  const ordered = orderBoxes(boxes);
  for (const box of ordered) {
    const d = dropIn(box.startS!, box.dropS!);
    if (d < PAIR.dropInMin || d > PAIR.dropInMax) return dropInText(box.label.trim(), d);
  }
  const length = clampLength(input.lengthS);
  if (ordered[0]!.startS! + length > ordered[1]!.startS! + 1e-9) return WINDOWS_OVERLAP;
  return null;
}

/** A window kept inside the track at the pair's length (the operator's typed start can't run past the end). */
export function clampPairStart(startS: number, durationS: number, lengthS: number): number {
  return clampWindow(startS, durationS, lengthS).startS;
}

// ── VP7: sign-off, then live at Approve ─────────────────────────────────────

/**
 * What holds a pair's Approve before any Graph call, in order: Matas's sign-off,
 * then VP2's rules again. The artist-page approval is checked once Approve knows
 * the page it runs from (pairArtistPageRefusal).
 */
export function pairApproveRefusal(held: PairHeld, labels: readonly string[]): string | null {
  if (!held.signOff) return WAITING_SIGN_OFF;
  const boxes = held.windows.map((w, i) => ({ label: labels[i] ?? "", startS: w.startS, dropS: w.dropS }));
  return trackPairRefusal({ lengthS: held.lengthS, boxes });
}

/** VP7: a pair that runs from the artist's page needs the artist-page approval too. */
export function pairArtistPageRefusal(held: PairHeld, pageId: string | null | undefined, artistPageId: string | null | undefined): string | null {
  const fromArtistPage = Boolean(pageId && artistPageId && pageId === artistPageId);
  return fromArtistPage && !held.artistPageApproval ? WAITING_ARTIST_PAGE : null;
}

/** The sign-off lines a pair shows in the Lab and on the event page card at 1280 (VP7), never on the share link. */
export function approvalLines(held: Pick<PairHeld, "signOff" | "artistPageApproval">): string[] {
  const out: string[] = [];
  if (held.signOff) out.push(signedOffText(held.signOff.at));
  if (held.artistPageApproval) out.push(artistPageText(held.artistPageApproval.at));
  return out;
}

function approval(value: unknown): Approval | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v.by === "string" && typeof v.at === "string" ? { by: v.by, at: v.at } : null;
}

/** creative_tests.held read as a pair's, or null when it isn't one. */
export function readPairHeld(held: unknown): PairHeld | null {
  if (!held || typeof held !== "object") return null;
  const h = held as Record<string, unknown>;
  if (h.pair !== "track" && h.pair !== "clip" && h.pair !== "card") return null;
  const windows = Array.isArray(h.windows)
    ? h.windows.map((w) => ({ startS: Number((w as Record<string, unknown>)?.startS), dropS: Number((w as Record<string, unknown>)?.dropS) })).filter((w) => Number.isFinite(w.startS) && Number.isFinite(w.dropS))
    : [];
  return {
    pair: h.pair,
    audioFileId: String(h.audioFileId ?? ""),
    asset: String(h.asset ?? ""),
    static: String(h.static ?? ""),
    staticDriveFileId: String(h.staticDriveFileId ?? ""),
    lengthS: clampLength(Number(h.lengthS)),
    windows,
    signOff: approval(h.signOff),
    artistPageApproval: approval(h.artistPageApproval),
  };
}
