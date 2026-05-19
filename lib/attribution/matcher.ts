/**
 * lib/attribution/matcher.ts
 *
 * Pure matching logic for the Off/Pixel attribution moat. Joins a
 * single `ticketing_purchase_events` row to its best
 * `meta_click_touchpoints` candidate using a three-tier waterfall:
 *
 *   1. `email_hash` — same hashed email on both sides.
 *      Highest confidence (0.95). Email survives device-switching,
 *      browser changes, etc.
 *
 *   2. `external_id` — same hashed CRM / ticketing customer id on
 *      both sides. Confidence 0.90. Slightly lower because the
 *      same external id can refer to different real users when an
 *      account is shared.
 *
 *   3. `fbc_cookie` — same `_fbc` cookie value on both sides.
 *      Confidence 0.70. Subject to cookie partitioning and the
 *      ITP / browser-storage roulette, so we treat it as the
 *      tie-breaker rather than the headline join.
 *
 * If multiple touchpoints qualify under the same strategy, we pick
 * the most recent one whose `clicked_at <= purchase.purchased_at`
 * (latest-touch attribution; matches Meta's default 7-day click
 * window in spirit, though we don't gate on the 7-day cutoff here
 * because Meta's choice is stricter than the demo needs).
 *
 * Pure module — no Supabase, no network. The cron handler converts
 * DB rows to the `MatchPurchaseInput` shape, calls into here, then
 * upserts the `MatchResult` rows back. Tests run directly on this
 * file via `node --experimental-strip-types`.
 */

/**
 * Single ticketing purchase as seen by the matcher.
 */
export interface MatchPurchaseInput {
  /** Primary key — flowed back into the result row unchanged. */
  purchaseEventId: string;
  /** Trimmed `purchased_at` ISO. Used to gate latest-touch picks. */
  purchasedAt: string;
  /** sha256(lower(trim(email))) when the provider supplied one. */
  emailHash: string | null;
  /** sha256(lower(trim(externalId))) when the provider supplied one. */
  externalIdHash: string | null;
  /** Verbatim `_fbc` cookie value when the webhook captured one. */
  fbc: string | null;
}

/**
 * Single Meta click as seen by the matcher.
 */
export interface MatchTouchpointInput {
  touchpointId: string;
  clickedAt: string;
  emailHash: string | null;
  externalIdHash: string | null;
  fbc: string | null;
}

/**
 * Strategies in their priority order. Used by both the matcher and
 * the DB CHECK constraint on `attribution_order_matches.match_strategy`.
 */
export const MATCH_STRATEGIES = [
  "email_hash",
  "external_id",
  "fbc_cookie",
  "unmatched",
] as const;
export type MatchStrategy = (typeof MATCH_STRATEGIES)[number];

/** Confidence per strategy. Honours the prompt's spec verbatim. */
export const MATCH_CONFIDENCE: Record<MatchStrategy, number> = {
  email_hash: 0.95,
  external_id: 0.9,
  fbc_cookie: 0.7,
  unmatched: 0,
};

/**
 * Match output. One row per input purchase. `unmatched` is a
 * legitimate value — the cron writes it verbatim to the DB so a
 * later cron pass can skip purchases that were already considered.
 */
export interface MatchResult {
  purchaseEventId: string;
  touchpointId: string | null;
  strategy: MatchStrategy;
  confidence: number;
}

/**
 * Match a single purchase against a candidate set of touchpoints.
 *
 * Caller controls the candidate set. Typical use: the cron pre-
 * filters touchpoints to "any touchpoint for the same client_id
 * with `clicked_at <= purchase.purchased_at + 1d`". The matcher
 * doesn't load anything itself — keeping it dependency-free makes
 * the unit tests trivial and the cron's chunk-size obvious.
 */
export function matchPurchase(
  purchase: MatchPurchaseInput,
  touchpoints: ReadonlyArray<MatchTouchpointInput>,
): MatchResult {
  // Cap the candidate set to clicks that happened at or before the
  // purchase. A click after the purchase can't have driven it; this
  // avoids accidentally matching to a later session.
  const eligible = touchpoints.filter(
    (t) => t.clickedAt <= purchase.purchasedAt,
  );

  // Email hash — strongest signal.
  if (purchase.emailHash) {
    const candidates = eligible.filter(
      (t) => t.emailHash === purchase.emailHash,
    );
    const best = pickLatest(candidates);
    if (best) {
      return {
        purchaseEventId: purchase.purchaseEventId,
        touchpointId: best.touchpointId,
        strategy: "email_hash",
        confidence: MATCH_CONFIDENCE.email_hash,
      };
    }
  }

  // External id hash — equally surfaceable, slightly less reliable.
  if (purchase.externalIdHash) {
    const candidates = eligible.filter(
      (t) => t.externalIdHash === purchase.externalIdHash,
    );
    const best = pickLatest(candidates);
    if (best) {
      return {
        purchaseEventId: purchase.purchaseEventId,
        touchpointId: best.touchpointId,
        strategy: "external_id",
        confidence: MATCH_CONFIDENCE.external_id,
      };
    }
  }

  // Fbc cookie — tie-breaker. Useful when the user buys without
  // signing in but landed via the ad.
  if (purchase.fbc) {
    const candidates = eligible.filter((t) => t.fbc === purchase.fbc);
    const best = pickLatest(candidates);
    if (best) {
      return {
        purchaseEventId: purchase.purchaseEventId,
        touchpointId: best.touchpointId,
        strategy: "fbc_cookie",
        confidence: MATCH_CONFIDENCE.fbc_cookie,
      };
    }
  }

  return {
    purchaseEventId: purchase.purchaseEventId,
    touchpointId: null,
    strategy: "unmatched",
    confidence: MATCH_CONFIDENCE.unmatched,
  };
}

/**
 * Latest-touch picker. Sort by `clickedAt` descending, return the
 * first. Stable with respect to ties (in practice the chance of two
 * clicks landing in the same millisecond per email is vanishingly
 * small; tie-break is whichever comes first in the input array).
 */
function pickLatest(
  candidates: ReadonlyArray<MatchTouchpointInput>,
): MatchTouchpointInput | null {
  if (candidates.length === 0) return null;
  let best: MatchTouchpointInput = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].clickedAt > best.clickedAt) {
      best = candidates[i];
    }
  }
  return best;
}
