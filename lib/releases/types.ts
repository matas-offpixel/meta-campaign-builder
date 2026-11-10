/** Release states, in the order a tap moves forward. A backwards tap asks once. */

export const RELEASE_STATES = ["not_yet", "on_sale", "selling_fast", "final_x", "sold_out"] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

export type StateSource = "vendor_page" | "client_message" | "entry";

export type Release = {
  id: string;
  eventId: string;
  position: number;
  name: string;
  communityAt: string | null;
  listAt: string | null;
  state: ReleaseState;
  stateAt: string | null;
  stateSource: StateSource | null;
  stateSetBy: string | null;
  price: number | null;
  capacity: number | null;
  sold: number | null;
  remaining: number | null;
};

export type TriggerKind =
  | "count_pct"
  | "state_days"
  | "state"
  | "page_remaining"
  | "roll_call"
  | "velocity"
  | "price_rise_date"
  | "countdown_pct"
  | "lineup_add";

export type LadderWording = "percent" | "final_x";

export type LadderRung = {
  position: number;
  triggerKind: TriggerKind;
  triggerValue: string;
  claimTemplate: string;
  options: {
    days?: number;
    wording?: LadderWording;
    alt?: string;
    preferred?: boolean;
    /** On the selling-fast state rung: on sale counts when every earlier release is sold out. */
    or_earlier_sold_out?: boolean;
    windowDays?: number;
    threshold?: number;
  };
};

export type WarningState = "held" | "locked" | "scheduled" | "live" | "done" | "back_to_held";

export type TicketWarning = {
  id: string;
  eventId: string;
  releaseId: string | null;
  claim: string;
  format: string;
  state: WarningState;
  trigger: Record<string, unknown> | null;
  approvedAt: string | null;
  runsFrom: string | null;
  runsTo: string | null;
  why: string | null;
};

export function stateIndex(state: ReleaseState): number {
  return RELEASE_STATES.indexOf(state);
}
