/**
 * lib/dashboard/campaigns-aggregator.ts
 *
 * Pure compute layer for the internal `/clients/[id]/campaigns` tab.
 *
 * Reads `active_creatives_snapshots.payload` (which is the per-event
 * `ShareActiveCreativesResult` already populated by the existing
 * 6-hour cron) and aggregates concept groups → campaigns + ad-sets at
 * READ time. We do NOT introduce a new snapshots table — the
 * `project_active_creatives_snapshot_cache.md` invariant says reads
 * are stale-up-to-6h and a separate snapshot would just diverge.
 *
 * Three layers of aggregation:
 *   1. Snapshot picker — one snapshot per event_code (use the freshest
 *      among events sharing a code; sibling events share campaigns so
 *      summing across siblings would N-times-count).
 *   2. Campaign roll-up — group concept rows by campaign_id, sum
 *      spend / impressions / clicks / etc. Distribute creatives
 *      across multiple campaigns evenly when one creative spans
 *      multiple campaigns (rare; documented as Concept-* edge case).
 *   3. Ad-set roll-up — within each campaign, group concept rows by
 *      adset_id, same distribution logic.
 *
 * Two derived columns the surface needs:
 *   - **Sales (est., spend-share)** = `ticketsTrue × (row_spend /
 *     event_total_spend)`. Spend-share allocation per the prompt —
 *     wrong in absolute terms but useful relative to itself within
 *     an event_code.
 *   - **Meta purchases** = SUM of `meta_regs` from underlying
 *     concepts at the campaign level; ad-set-level is the parent
 *     campaign's `meta_regs × (adset_spend / campaign_spend)` per
 *     the explicit prompt contract.
 *
 * Pure module — no Supabase, no Meta. Loader is a sibling file.
 */

import {
  worstAttributionState,
  type AttributionClassification,
} from "./attribution-state.ts";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

/**
 * Input shape per snapshot row. Caller builds this from the
 * `active_creatives_snapshots` rows it already pre-fetches by
 * `client_id` + the `events` table mapping `event_id → event_code`.
 */
export interface CampaignsSnapshotInput {
  eventId: string;
  eventCode: string | null;
  /** When `null` we treat this row as missing — the eventCode is the
   *  required join key. */
  payload: ShareActiveCreativesResult | null;
  /** ISO `fetched_at` from `active_creatives_snapshots`. Used by
   *  `selectFreshestPerEventCode` when a venue has multiple sibling
   *  events with concurrent snapshots. */
  fetchedAt: string;
}

/**
 * Per-event_code attribution input. Built once per render from the
 * canonical resolver output.
 */
export interface CampaignsAttributionByEventCode {
  [eventCode: string]: AttributionClassification;
}

export interface CampaignsAggregateRow {
  /** Campaign-level row + ad-set children. */
  campaignId: string;
  campaignName: string | null;
  /**
   * Distinct event_codes this campaign appears in across the
   * supplied snapshots. Powers the badge-inheritance worst-state
   * pick.
   */
  eventCodes: string[];
  /**
   * Distinct effective_status values reported by Meta across the
   * underlying ads. We don't have campaign-level status from the
   * snapshot payload (ConceptGroupRow doesn't carry it); the
   * surface uses `any_ad_active` as a proxy: ACTIVE if at least
   * one underlying ad is ACTIVE, otherwise PAUSED.
   */
  status: "active" | "paused";
  spend: number;
  impressions: number;
  clicks: number;
  inlineLinkClicks: number;
  metaRegs: number;
  /** `clicks / impressions × 100` recomputed from sums. null when impressions = 0. */
  ctr: number | null;
  /** `spend / impressions × 1000`. null when impressions = 0. */
  cpm: number | null;
  /** `spend / clicks`. null when clicks = 0. */
  cpc: number | null;
  /** `spend / metaRegs`. null when metaRegs = 0. */
  metaCpa: number | null;
  /**
   * Spend-share-allocated estimated ticket sales for this row.
   * = `eventTicketsTrue × (row_spend / event_total_spend)` summed
   * across the event_codes the row touches. When the row covers
   * multiple event_codes the contribution from each is added up.
   */
  estSales: number | null;
  /** `spend / estSales`. null when estSales <= 0. */
  estCpa: number | null;
  /**
   * Inherited attribution badge — the worst state across the
   * event_codes this campaign appeared in. `no_data` when the
   * campaign matches no event_code with attribution data.
   */
  attribution: AttributionClassification;
  /**
   * `true` when `metaCpa` and `estCpa` differ by > 3× — surface
   * decorates BOTH cells with a ⚠️ icon. False on rows where one
   * side is null.
   */
  cpaDivergent: boolean;
  /** Ad-set children, sorted by spend desc. */
  adSets: CampaignsAdSetRow[];
}

export interface CampaignsAdSetRow {
  adSetId: string;
  adSetName: string | null;
  status: "active" | "paused";
  spend: number;
  impressions: number;
  clicks: number;
  inlineLinkClicks: number;
  /** Allocated from the parent campaign by spend-share — never the
   *  sum of underlying concept-row metaRegs (those are creative-
   *  level totals, not ad-set-level, and would cross-count when
   *  one creative spans multiple ad-sets). */
  metaRegs: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  metaCpa: number | null;
  estSales: number | null;
  estCpa: number | null;
  /**
   * Inherited from the parent campaign — every ad-set under a
   * campaign carries the same badge state. Convenience field so
   * the row component doesn't need to look up the campaign.
   */
  attribution: AttributionClassification;
  cpaDivergent: boolean;
  /** event_codes this ad-set touches (subset of campaign's set). */
  eventCodes: string[];
}

const DIVERGENCE_FACTOR = 3;

/**
 * Build the campaign + ad-set roll-up from a list of snapshot inputs
 * and a per-event_code attribution map.
 *
 * Public-facing pure compute. Returns a list of campaign rows,
 * sorted by `spend` desc by default. Caller controls re-sort + filter
 * (Active toggle, event-code multi-select) via standard table
 * primitives.
 *
 * `ticketsTrueByEventCode` carries the canonical `ticketsTrue` per
 * event_code (built once from the resolver). Used to compute the
 * spend-share `estSales` allocation.
 *
 * `attributionByEventCode` carries the four-state classifier per
 * event_code (also from the resolver). Drives the badge-inheritance
 * worst-state pick at the campaign + ad-set rows.
 */
export function aggregateCampaignsFromSnapshots(args: {
  snapshots: ReadonlyArray<CampaignsSnapshotInput>;
  ticketsTrueByEventCode: ReadonlyMap<string, number>;
  attributionByEventCode: ReadonlyMap<string, AttributionClassification>;
}): CampaignsAggregateRow[] {
  // Pick one snapshot per event_code — sibling events share
  // campaigns; summing across siblings would N-count.
  const freshest = selectFreshestPerEventCode(args.snapshots);

  type CampaignAcc = {
    campaignId: string;
    campaignName: string | null;
    eventCodes: Set<string>;
    spend: number;
    impressions: number;
    clicks: number;
    inlineLinkClicks: number;
    metaRegs: number;
    anyActive: boolean;
    /** event_code → contribution (spend × ticketsTrue / event_total_spend)
     *  Summed across event_codes for the row's estSales. */
    estSales: number;
    /** Per-(campaign, adset) sub-roll-up. Keyed by `${campaignId}|${adsetId}`. */
    adSets: Map<string, AdSetAcc>;
  };
  type AdSetAcc = {
    adSetId: string;
    adSetName: string | null;
    spend: number;
    impressions: number;
    clicks: number;
    inlineLinkClicks: number;
    anyActive: boolean;
    eventCodes: Set<string>;
  };

  const campaigns = new Map<string, CampaignAcc>();
  // Per event_code → total spend across this code's snapshot — used
  // for the spend-share allocation denominator. Computed on the fly
  // from the same iteration so the math is internally consistent.
  const eventTotalSpendByCode = new Map<string, number>();

  for (const snap of freshest) {
    if (!snap.payload || snap.payload.kind !== "ok") continue;
    const eventCode = snap.eventCode;
    if (!eventCode) continue;

    let snapshotTotalSpend = 0;
    for (const g of snap.payload.groups) snapshotTotalSpend += g.spend ?? 0;
    eventTotalSpendByCode.set(eventCode, snapshotTotalSpend);
  }

  for (const snap of freshest) {
    if (!snap.payload || snap.payload.kind !== "ok") continue;
    const eventCode = snap.eventCode;
    if (!eventCode) continue;
    const ticketsTrueForCode =
      args.ticketsTrueByEventCode.get(eventCode) ?? 0;
    const eventTotalSpend = eventTotalSpendByCode.get(eventCode) ?? 0;

    for (const g of snap.payload.groups) {
      // A concept group can span multiple campaigns (rare — Meta
      // duplicates creatives across campaigns) and multiple ad-sets
      // (common — adset-level testing). Distribute spend / impressions
      // evenly across campaigns. Within each campaign, distribute
      // evenly across the ad-sets that campaign touches via this
      // group. This is approximate but it's the best we can do
      // without per-(creative, adset) insight rows.
      const campaignList = g.campaigns.length > 0 ? g.campaigns : [];
      const campaignWeight =
        campaignList.length > 0 ? 1 / campaignList.length : 0;
      if (campaignWeight === 0) continue;

      const adSetWeight = g.adsets.length > 0 ? 1 / g.adsets.length : 0;

      for (const cmp of campaignList) {
        let acc = campaigns.get(cmp.id);
        if (!acc) {
          acc = {
            campaignId: cmp.id,
            campaignName: cmp.name,
            eventCodes: new Set<string>(),
            spend: 0,
            impressions: 0,
            clicks: 0,
            inlineLinkClicks: 0,
            metaRegs: 0,
            anyActive: false,
            estSales: 0,
            adSets: new Map<string, AdSetAcc>(),
          };
          campaigns.set(cmp.id, acc);
        }
        if (acc.campaignName == null && cmp.name) acc.campaignName = cmp.name;
        acc.eventCodes.add(eventCode);

        const cSpend = (g.spend ?? 0) * campaignWeight;
        acc.spend += cSpend;
        acc.impressions += (g.impressions ?? 0) * campaignWeight;
        acc.clicks += (g.clicks ?? 0) * campaignWeight;
        acc.inlineLinkClicks +=
          (g.inline_link_clicks ?? 0) * campaignWeight;
        acc.metaRegs += (g.registrations ?? 0) * campaignWeight;
        if (g.any_ad_active) acc.anyActive = true;

        // Spend-share allocation contribution from THIS event_code
        // toward the campaign's est sales. We sum contributions
        // across event_codes the campaign touches.
        if (eventTotalSpend > 0 && ticketsTrueForCode > 0) {
          acc.estSales += ticketsTrueForCode * (cSpend / eventTotalSpend);
        }

        if (adSetWeight > 0) {
          for (const a of g.adsets) {
            const key = `${cmp.id}|${a.id}`;
            let aacc = acc.adSets.get(key);
            if (!aacc) {
              aacc = {
                adSetId: a.id,
                adSetName: a.name,
                spend: 0,
                impressions: 0,
                clicks: 0,
                inlineLinkClicks: 0,
                anyActive: false,
                eventCodes: new Set<string>(),
              };
              acc.adSets.set(key, aacc);
            }
            if (aacc.adSetName == null && a.name) aacc.adSetName = a.name;
            aacc.eventCodes.add(eventCode);
            aacc.spend += cSpend * adSetWeight;
            aacc.impressions += (g.impressions ?? 0) * campaignWeight * adSetWeight;
            aacc.clicks += (g.clicks ?? 0) * campaignWeight * adSetWeight;
            aacc.inlineLinkClicks +=
              (g.inline_link_clicks ?? 0) * campaignWeight * adSetWeight;
            if (g.any_ad_active) aacc.anyActive = true;
          }
        }
      }
    }
  }

  // Materialise rows.
  const out: CampaignsAggregateRow[] = [];
  for (const acc of campaigns.values()) {
    const eventCodesList = [...acc.eventCodes].sort();

    // Inherited badge: worst state across this campaign's
    // event_codes.
    const childAttribs: AttributionClassification[] = [];
    for (const code of eventCodesList) {
      const a = args.attributionByEventCode.get(code);
      if (a) childAttribs.push(a);
    }
    const campaignAttribution = worstAttributionState(childAttribs);

    const ctr = acc.impressions > 0 ? (acc.clicks / acc.impressions) * 100 : null;
    const cpm = acc.impressions > 0 ? (acc.spend / acc.impressions) * 1000 : null;
    const cpc = acc.clicks > 0 ? acc.spend / acc.clicks : null;
    const metaCpa = acc.metaRegs > 0 ? acc.spend / acc.metaRegs : null;
    const estSales = acc.estSales > 0 ? acc.estSales : null;
    const estCpa = estSales != null && estSales > 0 ? acc.spend / estSales : null;
    const cpaDivergent = isDivergent(metaCpa, estCpa);

    // Ad-set rows: distribute the campaign's metaRegs by spend
    // share (per the prompt's explicit contract — NOT a sum of the
    // underlying creative metaRegs, which would cross-count when
    // creatives span multiple ad-sets).
    const adSets: CampaignsAdSetRow[] = [];
    for (const aacc of acc.adSets.values()) {
      const adsetSpendShare =
        acc.spend > 0 ? aacc.spend / acc.spend : 0;
      const adsetMetaRegs = acc.metaRegs * adsetSpendShare;
      // estSales for the ad-set: same allocation logic as the
      // campaign, scoped to this ad-set's event_codes via the
      // ad-set's own spend-vs-event_total ratios. Approximation:
      // we use the ad-set's spend-share OF THE CAMPAIGN's estSales
      // rather than re-running the per-event_code allocation. This
      // keeps Σ(adset.estSales) = campaign.estSales which is the
      // invariant the table needs.
      const adsetEstSales =
        estSales != null ? estSales * adsetSpendShare : null;
      const adsetAttribution = campaignAttribution;
      const adsetCtr =
        aacc.impressions > 0 ? (aacc.clicks / aacc.impressions) * 100 : null;
      const adsetCpm =
        aacc.impressions > 0 ? (aacc.spend / aacc.impressions) * 1000 : null;
      const adsetCpc = aacc.clicks > 0 ? aacc.spend / aacc.clicks : null;
      const adsetMetaCpa =
        adsetMetaRegs > 0 ? aacc.spend / adsetMetaRegs : null;
      const adsetEstCpa =
        adsetEstSales != null && adsetEstSales > 0
          ? aacc.spend / adsetEstSales
          : null;
      adSets.push({
        adSetId: aacc.adSetId,
        adSetName: aacc.adSetName,
        status: aacc.anyActive ? "active" : "paused",
        spend: aacc.spend,
        impressions: aacc.impressions,
        clicks: aacc.clicks,
        inlineLinkClicks: aacc.inlineLinkClicks,
        metaRegs: adsetMetaRegs,
        ctr: adsetCtr,
        cpm: adsetCpm,
        cpc: adsetCpc,
        metaCpa: adsetMetaCpa,
        estSales: adsetEstSales,
        estCpa: adsetEstCpa,
        attribution: adsetAttribution,
        cpaDivergent: isDivergent(adsetMetaCpa, adsetEstCpa),
        eventCodes: [...aacc.eventCodes].sort(),
      });
    }
    adSets.sort((a, b) => b.spend - a.spend);

    out.push({
      campaignId: acc.campaignId,
      campaignName: acc.campaignName,
      eventCodes: eventCodesList,
      status: acc.anyActive ? "active" : "paused",
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      inlineLinkClicks: acc.inlineLinkClicks,
      metaRegs: acc.metaRegs,
      ctr,
      cpm,
      cpc,
      metaCpa,
      estSales,
      estCpa,
      attribution: campaignAttribution,
      cpaDivergent,
      adSets,
    });
  }
  out.sort((a, b) => b.spend - a.spend);
  return out;
}

/**
 * Pick the freshest snapshot per event_code so sibling events under
 * one event_code (Manchester WC26 has 4) don't N-count their shared
 * campaign across the venue.
 *
 * Exported for testing — most call-sites use the aggregator directly.
 */
export function selectFreshestPerEventCode(
  snapshots: ReadonlyArray<CampaignsSnapshotInput>,
): CampaignsSnapshotInput[] {
  const byCode = new Map<string, CampaignsSnapshotInput>();
  for (const s of snapshots) {
    if (!s.eventCode) continue;
    const cur = byCode.get(s.eventCode);
    if (!cur || s.fetchedAt > cur.fetchedAt) byCode.set(s.eventCode, s);
  }
  return [...byCode.values()];
}

/**
 * Cross-check helper: returns true when `metaCpa` and `estCpa`
 * disagree in a way the surface should flag with a ⚠️ icon.
 *
 * Three flagging conditions:
 *   1. Both populated and they differ by > 3× either way (the
 *      explicit numeric divergence threshold from the prompt).
 *   2. `metaCpa` is null/zero while `estCpa` is populated — the
 *      capi_missing demo surface (Shepherd's Bush). Meta reported
 *      zero conversions, ticketing reports real sales: infinite
 *      divergence, definitely worth the ⚠️.
 *   3. `estCpa` is null/zero while `metaCpa` is populated — the
 *      mirror case, rare but plausible (no event_code attribution
 *      data while Meta is still reporting regs).
 */
export function isDivergent(
  metaCpa: number | null,
  estCpa: number | null,
): boolean {
  const metaOk =
    metaCpa != null && Number.isFinite(metaCpa) && metaCpa > 0;
  const estOk = estCpa != null && Number.isFinite(estCpa) && estCpa > 0;
  if (metaOk && estOk) {
    const ratio = metaCpa / estCpa;
    return ratio > DIVERGENCE_FACTOR || ratio < 1 / DIVERGENCE_FACTOR;
  }
  // Exactly one side populated — still a divergence (one side is
  // implicitly infinite vs the other).
  return metaOk !== estOk;
}
