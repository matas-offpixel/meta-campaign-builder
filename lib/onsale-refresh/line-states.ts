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

/** P2 writes creatives only; audiences and budget are P3. */
export const APPLY_KINDS: readonly LineKind[] = ["add_creative", "pause_creative"];

/** The lines Apply accepted (n) would write: accepted creative lines, pauses only when their own gate is open. */
export function appliesNow(line: { kind: LineKind; state: string }, gates: { pauseWritesEnabled: boolean }): boolean {
  if (line.state !== "accepted") return false;
  if (line.kind === "add_creative") return true;
  return line.kind === "pause_creative" && gates.pauseWritesEnabled;
}

/** Failed lines Retry failed (n) would run again. */
export function retriesNow(line: { kind: LineKind; state: string }, gates: { pauseWritesEnabled: boolean }): boolean {
  return line.state === "failed" && appliesNow({ kind: line.kind, state: "accepted" }, gates);
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
