/**
 * Plan / campaign name derivation — the canvas has no name input.
 *
 * The rule was inline in `components/wizard/wizard-shell.tsx` (event name
 * plus the derived phase). Zone A of the canvas needs the same string, so
 * it moves here and the wizard imports it. One rule, two callers.
 */

import { derivePhase } from "../wizard/phase.ts";

/**
 * camelCase mirror of the five `events` columns `derivePhase` reads.
 * `PlanEventOption` and the wizard's `EventWithClient` both map onto it.
 */
export interface PlanNameEvent {
  name: string;
  announcementAt?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
  eventDate?: string | null;
  eventStartAt?: string | null;
}

export function derivePlanName(
  event: PlanNameEvent | null | undefined,
  now: Date = new Date(),
): string {
  const name = event?.name?.trim() ?? "";
  if (!event || !name) return "";
  const phase = derivePhase(
    {
      announcement_at: event.announcementAt ?? null,
      presale_at: event.presaleAt ?? null,
      general_sale_at: event.generalSaleAt ?? null,
      event_date: event.eventDate ?? null,
      event_start_at: event.eventStartAt ?? null,
    },
    now,
  );
  return phase === "Campaign" ? name : `${name} — ${phase}`;
}

/**
 * What the header renders. The event name is verbatim (§2.2 A). The
 * stored plan title, if any, lives in the ⓘ — not on the face.
 */
export function planHeaderName(
  storedName: string | null | undefined,
  event: PlanNameEvent | null | undefined,
  _now: Date = new Date(),
): string {
  const eventName = event?.name?.trim() ?? "";
  if (eventName) return eventName;
  const stored = storedName?.trim() ?? "";
  if (stored) return stored;
  return PLAN_UNNAMED_LABEL;
}

/**
 * PageHeader chrome — event name or nothing. The stored plan title
 * never appears above the canvas.
 */
export function planPageTitle(event: PlanNameEvent | null | undefined): string {
  return event?.name?.trim() ?? "";
}

export const PLAN_UNNAMED_LABEL = "new plan";
