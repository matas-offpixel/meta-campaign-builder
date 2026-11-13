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
};

/** P2 wrote creatives; P3 adds a stopped ad set's bring-back, drops and within-campaign moves. */
export const APPLY_KINDS: readonly LineKind[] = ["add_creative", "pause_creative", "bring_back_audience", "drop_audience", "move_budget"];

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

/**
 * A line that would make a new ad set — a client cluster brought back, a
 * missing standing default — isn't applied yet: the audience and the ads
 * a new ad set carries wait for a ruling. Reject stays live.
 */
export const NEW_ADSET_NOT_YET = "Not applied yet: Apply doesn't make new ad sets yet.";

/** Accept is open to the lines Apply writes. Claims are made in the Lab; new ad sets wait. */
export function acceptable(line: { kind: LineKind; writeKind?: string | null }): boolean {
  if (!APPLY_KINDS.includes(line.kind)) return false;
  return line.writeKind !== "new_adset";
}

/** The sentence under a line whose Accept is held, or null. */
export function heldText(line: { kind: LineKind; writeKind?: string | null; supply?: boolean }): string | null {
  if (line.supply || line.kind === "claim_ready") return null;
  return acceptable(line) ? null : NEW_ADSET_NOT_YET;
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
