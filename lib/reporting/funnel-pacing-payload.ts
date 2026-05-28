/**
 * Pure helpers for funnel pacing metrics sourced from
 * `active_creatives_snapshots.payload` (ShareActiveCreativesResult-compatible).
 * Kept separate from `funnel-pacing.ts` so tests do not load `server-only`.
 */

export type SnapshotPayloadForLpv =
  | {
      kind: "ok";
      groups: ReadonlyArray<{ landingPageViews: number }>;
      meta: { unattributed: { landingPageViews: number } };
    }
  | { kind: "skip" | "error" };

/** Sums LPV from concept groups plus unattributed snapshot rows. */
export function sumLandingPageViewsFromSharePayload(
  payload: SnapshotPayloadForLpv,
): number {
  if (payload.kind !== "ok") return 0;
  let sum = payload.meta.unattributed.landingPageViews;
  for (const g of payload.groups) {
    sum += g.landingPageViews;
  }
  return sum;
}

/**
 * Split a single per-event-code LPV across the sibling events that share
 * that code, weighted by each sibling's rollup `link_clicks` share.
 *
 * Why this exists: `fetchActiveCreativesForEvent` substring-matches
 * campaigns by `event_code`, so every sibling event under the same
 * code (e.g. 4 WC26 fixtures at one venue) ends up with the SAME
 * underlying ad data — and therefore the SAME landing-page view total
 * — in `active_creatives_snapshots`. Naively summing per-event LPV
 * across a venue/region scope multiplies the real number by N siblings
 * (a 6,500-LPV venue showed up as 26,381 when 4 fixtures share the code).
 *
 * Strategy:
 *   - Distribute `codeLpv` across siblings in proportion to their
 *     rollup clicks. Mirrors how `event_daily_rollups.ad_spend_allocated`
 *     and `link_clicks` already split venue spend across fixtures.
 *   - Last sibling absorbs rounding remainder so the scope-level sum
 *     stays exactly `codeLpv` (no drift from repeated rounding).
 *   - Zero total clicks → split evenly (no rollup signal to weight by).
 *   - **Degenerate "owner-only" share → split evenly** (issue #471
 *     PR-A.5). Post-PR-A.5 the rollup writer NULLs out engagement
 *     metrics on non-owner siblings, so `link_clicks` on a 3-fixture
 *     venue collapses to `{owner: 854, b: 0, c: 0}`. The proportional
 *     weighter would assign 100 % of the LPV to the owner and 0 % to
 *     the others — wrong. When the click-share signal collapses to
 *     ≤ 1 non-zero sibling we equal-split instead, matching the
 *     "spend stays equally split" principle (locked decision from
 *     issue #471).
 *   - Single sibling → assign the full LPV (degenerate split).
 *
 * Returns a new map containing one entry per `eventIds` item.
 */
export function splitEventCodeLpvByClickShare(
  eventIds: readonly string[],
  codeLpv: number,
  clicksByEvent: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  if (eventIds.length === 0) return out;
  if (eventIds.length === 1) {
    out.set(eventIds[0]!, Math.max(0, Math.round(codeLpv)));
    return out;
  }

  let totalClicks = 0;
  let positiveClickSiblings = 0;
  for (const id of eventIds) {
    const c = clicksByEvent.get(id) ?? 0;
    totalClicks += c;
    if (c > 0) positiveClickSiblings += 1;
  }

  // Equal-split when the click signal is uninformative — either no
  // sibling has any clicks yet, or (post-PR-A.5 fanout fix) only the
  // engagement-owning sibling has clicks and the others are NULLed.
  // The latter case is detected by `positiveClickSiblings <= 1` for a
  // multi-sibling venue; proportional weighting would dump 100 % of
  // the LPV on the owner, which doesn't reflect any genuine per-
  // fixture signal. Equal-split mirrors the "spend stays split
  // equally" rule (locked in #471).
  if (totalClicks <= 0 || positiveClickSiblings <= 1) {
    const per = Math.floor(codeLpv / eventIds.length);
    let remaining = codeLpv;
    for (let i = 0; i < eventIds.length; i++) {
      const isLast = i === eventIds.length - 1;
      const val = isLast ? Math.max(0, Math.round(remaining)) : per;
      out.set(eventIds[i]!, val);
      remaining -= per;
    }
    return out;
  }

  let remaining = codeLpv;
  for (let i = 0; i < eventIds.length; i++) {
    const id = eventIds[i]!;
    const isLast = i === eventIds.length - 1;
    if (isLast) {
      out.set(id, Math.max(0, Math.round(remaining)));
    } else {
      const share = (clicksByEvent.get(id) ?? 0) / totalClicks;
      const val = Math.round(codeLpv * share);
      out.set(id, val);
      remaining -= val;
    }
  }
  return out;
}
