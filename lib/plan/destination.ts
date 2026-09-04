/**
 * Destination URL resolution for the canvas.
 *
 * The typed "Destination URL" field is gone (§2: "it is on the event").
 * The URL is a fact of the event, and which of the two event columns is
 * right is a fact of the target unit: a `purchase` campaign lands on the
 * ticket page, everything else on the signup page. When the event has
 * both, the unit decides; when it has one, that one wins; when it has
 * neither there is nothing to read, so — and only then — the operator can
 * paste one inside the `ⓘ`.
 *
 * `PlanDestinationPattern` in `./library.ts` already names the two
 * columns; this module resolves them rather than re-declaring them.
 */

import type { PlanTargetUnit } from "../types.ts";
import type { PlanDestinationPattern } from "./library.ts";

export type PlanDestinationSource = PlanDestinationPattern | "manual" | "none";

export interface PlanDestinationEvent {
  ticketUrl?: string | null;
  signupUrl?: string | null;
}

export interface ResolvedPlanDestination {
  url: string;
  source: PlanDestinationSource;
  /**
   * True only when neither event column has a URL. The `ⓘ` shows a paste
   * field in that state and a read-only value in every other state —
   * changing the destination of an event that has one is an event edit.
   */
  overridable: boolean;
}

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/** `purchase` buys a ticket; every other unit collects a registration. */
export function destinationPatternForUnit(
  unit: PlanTargetUnit | null | undefined,
): PlanDestinationPattern {
  return unit === "purchase" ? "ticket_url" : "signup_url";
}

export function resolvePlanDestination(
  event: PlanDestinationEvent | null | undefined,
  unit: PlanTargetUnit | null | undefined,
  override: string | null | undefined,
): ResolvedPlanDestination {
  const ticket = clean(event?.ticketUrl);
  const signup = clean(event?.signupUrl);
  const preferred = destinationPatternForUnit(unit);
  const order: PlanDestinationPattern[] =
    preferred === "ticket_url" ? ["ticket_url", "signup_url"] : ["signup_url", "ticket_url"];

  for (const pattern of order) {
    const url = pattern === "ticket_url" ? ticket : signup;
    if (url) return { url, source: pattern, overridable: false };
  }

  const pasted = clean(override);
  return {
    url: pasted,
    source: pasted ? "manual" : "none",
    overridable: true,
  };
}

/**
 * The `ⓘ` label. Names the column the URL came from so "why this URL?"
 * is answered without opening the event.
 */
export function destinationSourceLabel(source: PlanDestinationSource): string {
  if (source === "ticket_url") return "event ticket_url";
  if (source === "signup_url") return "event signup_url";
  if (source === "manual") return "manual entry";
  return "no destination";
}
