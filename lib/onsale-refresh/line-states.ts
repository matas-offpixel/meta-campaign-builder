/**
 * What a refresh line can be and say (R4, HR5, F3), with no server
 * imports: the panel (a client component) and the server share it.
 */

import type { LineKind } from "./rules.ts";

export type LineState = "to_review" | "accepted" | "rejected" | "applying" | "applied" | "failed" | "expired";

export const STATE_WORD: Record<LineState, string> = {
  to_review: "To review",
  accepted: "Accepted",
  rejected: "Rejected",
  applying: "Applying",
  applied: "Applied",
  failed: "Failed",
  expired: "Expired",
};

/** The write a line would make (its stored `write.kind`). */
export type WriteKind = "add_ads" | "ad_status" | "adset_status" | "new_adset" | "adset_budget_move";

type GateLine = { kind: LineKind; state: string; writeKind?: string | null };

/** Each write's own gate, on top of the deployment gate and the event's Live arm. */
export type WriteGates = {
  /** OFFPIXEL_META_AD_STATUS_WRITES_ENABLED: Pause creative. */
  pauseWritesEnabled: boolean;
  /** OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED: Bring back (a stopped ad set) and Drop. */
  adsetStatusWritesEnabled?: boolean;
  /** ENABLE_OPTIMISATION_WRITES: the optimisation budget write, for moves. */
  budgetWritesEnabled?: boolean;
  /** OFFPIXEL_META_AUDIENCE_WRITES_ENABLED: the audience builder, for a standing default's audience. */
  audienceWritesEnabled?: boolean;
};

/** P2 wrote creatives; P3 adds bring-backs (a stopped ad set, or a cluster's new ad set), drops, within-campaign moves and standing defaults. */
export const APPLY_KINDS: readonly LineKind[] = ["add_creative", "pause_creative", "bring_back_audience", "drop_audience", "move_budget", "missing_default"];

/**
 * Lines that turn delivery on or raise a budget, so add spend: the plan
 * guard and the no-budget sentence apply to them only. An add, a pause and
 * a drop never add spend (the design ruling on #1220).
 * `adset_budget_raise` is a later write kind.
 */
export const SPEND_KINDS: readonly string[] = ["bring_back_audience", "missing_default", "adset_budget_raise"];

export function addsSpend(kind: string): boolean {
  return SPEND_KINDS.includes(kind);
}

/** Accept is open to the lines Apply writes; claims are made in the Lab. */
export function acceptable(line: { kind: LineKind; writeKind?: string | null }): boolean {
  return APPLY_KINDS.includes(line.kind);
}

/**
 * The sentence under a line Apply can't write in this piece, or null. P3
 * writes every kind it proposes; P4's cross-campaign moves would be the
 * next held kind. (P2's "Apply only writes creatives for now." is gone.)
 */
export function heldText(line: { kind: LineKind; writeKind?: string | null; supply?: boolean }): string | null {
  if (line.supply || line.kind === "claim_ready") return null;
  return acceptable(line) ? null : "Not applied yet.";
}

/**
 * The state the panel draws: a held line stored as Accepted (shadow data,
 * fixtures) is To review until Apply can write it.
 */
export function displayState(line: { kind: LineKind; state: LineState; writeKind?: string | null }): LineState {
  return line.state === "accepted" && !acceptable(line) && line.kind !== "claim_ready" ? "to_review" : line.state;
}

/** Whether this line's own write gate is open. */
export function writeGateOpen(line: GateLine, gates: WriteGates): boolean {
  if (line.kind === "add_creative") return true;
  if (line.kind === "pause_creative") return gates.pauseWritesEnabled;
  // A new ad set (a cluster's, a standing default's) goes in live: the ad-set gate; a default also builds an audience.
  if (line.kind === "missing_default") return Boolean(gates.adsetStatusWritesEnabled && gates.audienceWritesEnabled);
  if (line.kind === "bring_back_audience" || line.kind === "drop_audience") return Boolean(gates.adsetStatusWritesEnabled);
  if (line.kind === "move_budget") return Boolean(gates.budgetWritesEnabled);
  return false;
}

/**
 * "by {name}" (the ruling on #1220): the profile's first name, else the
 * email's local part — never the full email.
 */
export function displayName(user: { email?: string | null; user_metadata?: Record<string, unknown> | null }): string | null {
  const meta = user.user_metadata ?? {};
  for (const key of ["first_name", "given_name", "full_name", "name"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      const first = value.trim().split(/\s+/)[0]!;
      if (!first.includes("@")) return first;
    }
  }
  const local = user.email?.split("@")[0]?.trim();
  return local || null;
}

/** The lines Apply accepted (n) would write: accepted lines Apply can write, each only while its own gate is open. */
export function appliesNow(line: GateLine, gates: WriteGates): boolean {
  if (line.state !== "accepted") return false;
  return acceptable(line) && writeGateOpen(line, gates);
}

/** Failed lines Retry failed (n) would run again. */
export function retriesNow(line: GateLine, gates: WriteGates): boolean {
  return line.state === "failed" && appliesNow({ ...line, state: "accepted" }, gates);
}

export const REJECT_REASONS = { too_early: "Too early", wrong_creative: "Wrong creative", claim_not_right: "Claim not right", other: "Other" } as const;
export type RejectReason = keyof typeof REJECT_REASONS;

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && Object.hasOwn(REJECT_REASONS, value);
}

/** The line's state as F3 writes it: "Applied · 6 ads live", "Failed — {reason}", "Rejected — Too early". */
export function stateText(state: LineState, reason: string | null): string {
  if (state === "applied") return reason ? `Applied · ${reason}` : "Applied";
  // A new ad set that went live with some of its ads reads as the ruling draws it: "Ad set live · 4 of 6 ads — {reason}".
  if (state === "failed" && reason?.startsWith("Ad set live · ")) return reason;
  if (state === "failed" || state === "rejected") return reason ? `${STATE_WORD[state]} — ${reason}` : STATE_WORD[state];
  if (state === "applying") return "Applying…";
  return STATE_WORD[state];
}

const NBSP = " ";
const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const WEEKDAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?";

/**
 * Keep each date together (#620's rule): a non-breaking space between the
 * weekday and the day, the day and the month, the month and the year, and
 * after "w/c", so "Mon 16 Nov" never breaks at 393.
 */
export function keepDates(text: string): string {
  return text
    .replace(new RegExp(`\\b(${WEEKDAY}) (\\d{1,2})\\b`, "g"), `$1${NBSP}$2`)
    .replace(new RegExp(`\\b(\\d{1,2}) (${MONTH})\\b`, "g"), `$1${NBSP}$2`)
    .replace(new RegExp(`\\b(${MONTH}) (\\d{4})\\b`, "g"), `$1${NBSP}$2`)
    .replace(/\bw\/c (\d)/g, `w/c${NBSP}$1`);
}

/** keepDates on every string inside a value (a proposal, its lines, its why block). */
export function keepDatesDeep<T>(value: T): T {
  if (typeof value === "string") return keepDates(value) as T;
  if (Array.isArray(value)) return value.map((item) => keepDatesDeep(item)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, keepDatesDeep(item)])) as T;
  return value;
}

/** "1234567" → "1,234,567". */
function groupDigits(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Thousands separators on every money figure and every count of 1,000 or
 * more (design's ruling on #1221): £2505.85 → £2,505.85, 3105 → 3,105.
 * Decimals are kept as written. A number glued to a word, an id after
 * "…" or "#", a decimal's fraction and anything already grouped are left
 * alone, so applying it twice changes nothing.
 */
export function groupFigures(text: string): string {
  return text
    .replace(/£(\d+)(\.\d+)?/g, (_match, int: string, frac: string | undefined) => `£${groupDigits(int)}${frac ?? ""}`)
    .replace(/(?<![\w…#/.,£\-−:])(\d{4,})(?![\w\-:]|[.,]\d)/g, (_match, int: string) => groupDigits(int));
}

/** Everything the refresh panel writes: figures grouped, dates kept together. */
export function panelText(text: string): string {
  return keepDates(groupFigures(text));
}

/** Names and ad copy are shown as written: they keep their dates together but their digits as they are. */
const AS_WRITTEN = new Set(["title", "campaignKey", "copy", "id", "destinationUrl", "carried"]);

/** panelText on every string inside a value (a proposal, its lines, its why block); names and copy only get keepDates. */
export function panelTextDeep<T>(value: T, asWritten = false): T {
  if (typeof value === "string") {
    // Data, not words: an ISO date or timestamp is left exactly as stored.
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
    return (asWritten ? keepDates(value) : panelText(value)) as T;
  }
  if (Array.isArray(value)) return value.map((item) => panelTextDeep(item, asWritten)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, panelTextDeep(item, asWritten || AS_WRITTEN.has(key))])) as T;
  return value;
}
