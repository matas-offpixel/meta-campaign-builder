/**
 * lib/dashboard/attribution-state.ts
 *
 * Pure classifier mapping `(metaRegs, ticketsTrue)` to a four-state
 * attribution label. The labels are surfaced verbatim by the tile +
 * the events-table attribution column + the campaigns-tab badge so
 * one source of truth here keeps every consumer in sync.
 *
 * The thesis (per the prompt that produced this file): the broken
 * `meta_regs` data IS the demo on the client surface — we do NOT
 * dedup it here. The whole point of the `over_attributed` state is
 * that Brighton looks wrong. Surfacing the breakage is more
 * informative than papering over it.
 *
 * State semantics:
 *   - `no_data`         — both sides zero (nothing to say). Renders `—`.
 *   - `capi_missing`    — tickets sold but Meta reported zero regs.
 *                         Server-side CAPI hasn't fired (the headline
 *                         demo case for WC26-LONDON-SHEPHERDS).
 *   - `over_attributed` — Meta reported MORE regs than tickets sold.
 *                         Sibling-overlap or attribution-window leak
 *                         (WC26-BRIGHTON: 14,696 vs 1,709).
 *   - `tracked`         — Meta reported less than or equal to tickets,
 *                         and both sides are non-zero. Sub-banded by
 *                         attribution `rate = metaRegs / ticketsTrue`:
 *                           - green  ≥ 80%
 *                           - amber  40 – 79%
 *                           - red    < 40%
 *
 * `attributionRate` is `null` for the three non-`tracked` states. The
 * tile UI reads it directly to render the percentage chip.
 */

export const ATTRIBUTION_STATES = [
  "no_data",
  "capi_missing",
  "over_attributed",
  "tracked",
] as const;

export type AttributionState = (typeof ATTRIBUTION_STATES)[number];

export const ATTRIBUTION_BANDS = ["green", "amber", "red"] as const;
export type AttributionBand = (typeof ATTRIBUTION_BANDS)[number];

export interface AttributionClassification {
  state: AttributionState;
  /**
   * `metaRegs / ticketsTrue` for the `tracked` state, otherwise null.
   * `over_attributed` could be expressed as a >100% ratio but we
   * deliberately suppress it — the badge already labels the
   * direction; the number would invite "fix it" interpretations the
   * tile is not trying to support.
   */
  rate: number | null;
  /**
   * Sub-band for the `tracked` state. `null` for the other three —
   * the badge palette below collapses them onto a single colour
   * (red for capi_missing / over_attributed, neutral for no_data).
   */
  band: AttributionBand | null;
}

/**
 * Pure compute. Inputs come from the canonical resolver
 * (`canonical-event-metrics.ts`); see those JSDocs for sourcing.
 */
export function computeAttributionState(args: {
  metaRegs: number | null;
  ticketsTrue: number | null;
}): AttributionClassification {
  const meta = numericOrZero(args.metaRegs);
  const tickets = numericOrZero(args.ticketsTrue);

  if (tickets <= 0 && meta <= 0) {
    return { state: "no_data", rate: null, band: null };
  }
  if (tickets > 0 && meta <= 0) {
    return { state: "capi_missing", rate: null, band: null };
  }
  if (meta > tickets) {
    return { state: "over_attributed", rate: null, band: null };
  }
  // tracked: meta <= tickets, both > 0
  const rate = tickets > 0 ? meta / tickets : 0;
  return { state: "tracked", rate, band: bandForRate(rate) };
}

function bandForRate(rate: number): AttributionBand {
  if (rate >= 0.8) return "green";
  if (rate >= 0.4) return "amber";
  return "red";
}

function numericOrZero(value: number | null | undefined): number {
  if (value == null) return 0;
  if (!Number.isFinite(value)) return 0;
  return value;
}

/**
 * Sort order used by the events-table `Attribution` column header
 * default sort + the campaigns-tab worst-state pick. Most-broken
 * first so the column draws the eye to the problems.
 *
 * over_attributed → capi_missing → tracked-red → tracked-amber →
 *   tracked-green → no_data
 */
export function attributionSortKey(c: AttributionClassification): number {
  switch (c.state) {
    case "over_attributed":
      return 0;
    case "capi_missing":
      return 1;
    case "tracked":
      switch (c.band) {
        case "red":
          return 2;
        case "amber":
          return 3;
        case "green":
          return 4;
        default:
          return 5;
      }
    case "no_data":
      return 6;
    default:
      return 7;
  }
}

/**
 * Pick the "worst" state across a set of child events. Used by the
 * campaigns-tab badge inheritance: a campaign that touches multiple
 * event_codes inherits the most-broken child state.
 *
 * `no_data` children are skipped — a campaign with mixed
 * `tracked-green` + `no_data` children is still tracked-green for
 * the purposes of the badge.
 */
export function worstAttributionState(
  classifications: ReadonlyArray<AttributionClassification>,
): AttributionClassification {
  if (classifications.length === 0) {
    return { state: "no_data", rate: null, band: null };
  }
  let worst: AttributionClassification | null = null;
  let worstKey = Number.POSITIVE_INFINITY;
  for (const c of classifications) {
    if (c.state === "no_data") continue;
    const key = attributionSortKey(c);
    if (key < worstKey) {
      worst = c;
      worstKey = key;
    }
  }
  return worst ?? { state: "no_data", rate: null, band: null };
}
