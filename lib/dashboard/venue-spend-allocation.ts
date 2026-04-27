/**
 * lib/dashboard/venue-spend-allocation.ts
 *
 * Pure allocator for PR D2's per-event spend attribution. Given the
 * events in a venue group (one row per match sharing an event_code)
 * and the ad-level spend that the Meta rollup pulled under the
 * venue's `[event_code]` campaigns, compute a per-event spend
 * breakdown:
 *
 *   - `specific`       : spend from ads whose name matches this
 *                        event's opponent (whole-word, case-
 *                        insensitive). "WC26 Croatia Static" is
 *                        specific to the Croatia match.
 *   - `genericShare`   : this event's share of the venue-wide
 *                        generic pool (ads with no opponent in the
 *                        name). Split evenly across every event in
 *                        the venue.
 *   - `allocated`      : specific + genericShare. The value the
 *                        venue table surfaces as per-event Ad Spend
 *                        once the allocator has run.
 *
 * The allocator is deliberately pure + day-oblivious: it runs on a
 * flat list of ads with a single spend number each. The caller
 * (`venue-spend-allocator` server helper) runs it per calendar
 * day, so the SAME function composes cleanly for a daily loop or
 * a lifetime single-pass.
 *
 * Reconciliation guarantee
 *
 *   The sum of every event's `allocated` equals the sum of the
 *   input `spend` values, within floating-point rounding (see
 *   `reconcileRoundingDrift`). This lets the venue card's Total
 *   row keep showing the raw venue spend without a second source
 *   of truth.
 */

import {
  classifyAdAgainstOpponents,
  extractOpponentName,
} from "../db/event-opponent-extraction.ts";

export interface AllocatorEvent {
  /** Stable identifier used as the allocation map key. The caller
   *  is responsible for keying back into `events` by this id. */
  id: string;
  /** Event's human-readable `name`; opponent is parsed out via
   *  `extractOpponentName`. Knockout-named events (Last 32, etc.)
   *  have no opponent and only ever receive `genericShare`. */
  name: string | null;
}

export interface AllocatorAd {
  /** Stable identifier — only used for diagnostics / logs. */
  id: string;
  /** Ad name as returned by Meta (pre-lowercase). The classifier
   *  handles the case-insensitive match internally. */
  name: string;
  /** Ad-level spend for the window the caller is allocating over
   *  (typically a single calendar day). Non-finite / negative
   *  values are treated as 0. */
  spend: number;
}

export interface AllocatedEventSpend {
  eventId: string;
  /** Matched-opponent spend for this event (0 for knockouts and
   *  events whose opponent never appeared in any ad name). */
  specific: number;
  /** This event's share of the venue-wide generic pool. Even
   *  across every event in the venue, including knockouts. */
  genericShare: number;
  /** specific + genericShare. Persisted as `ad_spend_allocated`
   *  on `event_daily_rollups`. */
  allocated: number;
}

export interface AllocationSummary {
  /** Same length/order as `events`; guaranteed one row per input
   *  event regardless of whether any ads matched it. */
  perEvent: AllocatedEventSpend[];
  /** Sum of every ad's spend — the venue total. Equals the sum of
   *  `perEvent[i].allocated` within floating-point tolerance. */
  venueTotalSpend: number;
  /** Sum of the generic-pool ads (no opponent in ad name). */
  genericPool: number;
  /** `genericPool / eventCount`. Exposed so the venue header
   *  footnote can read the headline "£X averaged across N games"
   *  without recomputing it. */
  genericSharePerEvent: number;
}

/**
 * Numeric tolerance for the reconciliation check. Float rounding
 * across N events plus the generic-share divide can leave a 1-pence
 * residual on a £3,000 venue; anything larger means a bug.
 */
const RECONCILE_EPSILON = 0.01;

/**
 * Allocate `ads` across `events` per the per-event spend
 * attribution rules. Returns one row per event + the venue
 * totals needed by the reporting surface (footnote text, tooltip
 * detail).
 *
 * Empty `events` → empty perEvent list, zero totals. Empty `ads`
 * → zero perEvent allocations, still one row per event. Neither
 * case throws; the runner relies on the allocator producing a
 * well-shaped response so it can persist zero-rows when a venue
 * has no ad activity yet.
 */
export function allocateVenueSpend(
  events: readonly AllocatorEvent[],
  ads: readonly AllocatorAd[],
): AllocationSummary {
  const eventCount = events.length;

  // Event id × opponent map. Kept in input order so downstream
  // tie-breaks in `classifyAdAgainstOpponents` respect the
  // card's render order (first venue event wins a tie — see its
  // docs).
  const opponentsByEvent = events.map((ev) => ({
    id: ev.id,
    opponent: extractOpponentName(ev.name),
  }));
  const opponents = opponentsByEvent
    .map((e) => e.opponent)
    .filter((o): o is string => o !== null);

  const specificByEvent = new Map<string, number>();
  let genericPool = 0;
  let venueTotalSpend = 0;

  for (const ad of ads) {
    const spend = sanitiseSpend(ad.spend);
    if (spend === 0) continue;
    venueTotalSpend += spend;

    const verdict = classifyAdAgainstOpponents(ad.name, opponents);
    if (verdict.kind === "generic") {
      genericPool += spend;
      continue;
    }

    // Map the matched opponent back to the event(s) that claim it.
    // Multiple events CAN share an opponent in principle (rare —
    // typically only when the operator has duplicated a row); we
    // split the specific spend evenly among them so the total
    // still reconciles.
    const matches = opponentsByEvent.filter(
      (e) => e.opponent === verdict.opponent,
    );
    if (matches.length === 0) {
      // Defensive — the classifier picked an opponent we surfaced
      // but the event list dropped it. Shouldn't fire in practice;
      // fall back to generic so we don't lose the spend.
      genericPool += spend;
      continue;
    }
    const perMatch = spend / matches.length;
    for (const m of matches) {
      specificByEvent.set(
        m.id,
        (specificByEvent.get(m.id) ?? 0) + perMatch,
      );
    }
  }

  const genericSharePerEvent =
    eventCount > 0 ? genericPool / eventCount : 0;

  const perEvent: AllocatedEventSpend[] = events.map((ev) => {
    const specific = specificByEvent.get(ev.id) ?? 0;
    const genericShare = genericSharePerEvent;
    const allocated = specific + genericShare;
    return {
      eventId: ev.id,
      specific,
      genericShare,
      allocated,
    };
  });

  // Reconcile any float drift on the final event so the per-event
  // total exactly equals the venue total. We pick the last event
  // because its allocation already absorbed the last divisor — its
  // one-event rounding is the natural sink without introducing a
  // bias on the first event.
  const reconciled = reconcileRoundingDrift(perEvent, venueTotalSpend);

  return {
    perEvent: reconciled,
    venueTotalSpend,
    genericPool,
    genericSharePerEvent,
  };
}

/**
 * When `eventCount > 0` and the generic pool doesn't divide
 * cleanly, the sum of per-event allocations drifts from the venue
 * total by at most `eventCount * 0.5p`. Absorb that residual into
 * the last event so the Total row on the venue card still
 * reconciles. No-op for venues with zero events or zero drift.
 */
function reconcileRoundingDrift(
  perEvent: readonly AllocatedEventSpend[],
  venueTotalSpend: number,
): AllocatedEventSpend[] {
  if (perEvent.length === 0) return [];
  const sum = perEvent.reduce((acc, r) => acc + r.allocated, 0);
  const drift = venueTotalSpend - sum;
  if (Math.abs(drift) < 1e-9) return [...perEvent];
  if (Math.abs(drift) > RECONCILE_EPSILON) {
    // Drift exceeds what rounding can explain — surface rather
    // than silently absorbing a real mismatch. The caller logs
    // and continues; upstream diagnostics (console.warn inside
    // the runner) will notice.
    console.warn(
      `[venue-spend-allocation] reconciliation drift ${drift.toFixed(
        4,
      )} exceeds epsilon ${RECONCILE_EPSILON} (venueTotal=${venueTotalSpend})`,
    );
  }
  const out = perEvent.map((r) => ({ ...r }));
  const last = out[out.length - 1];
  last.allocated += drift;
  last.genericShare += drift;
  return out;
}

function sanitiseSpend(spend: number | null | undefined): number {
  if (spend == null || !Number.isFinite(spend) || spend < 0) return 0;
  return spend;
}
