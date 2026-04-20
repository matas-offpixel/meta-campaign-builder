"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Pencil } from "lucide-react";

import type { DailyEntry, PortalEvent } from "@/lib/db/client-portal-server";
import { DailyTracker } from "./daily-tracker";

interface SavedSnapshot {
  tickets_sold: number;
  revenue: number | null;
  captured_at: string;
  week_start: string;
}

interface Props {
  token: string;
  events: PortalEvent[];
  /**
   * Lifetime spend of the shared WC26-LONDON-ONSALE campaign. When non-null,
   * the four London venue sections switch from the default `split` spend
   * model to the `add` model (see `venueSpend` below) and an Overall London
   * aggregate row renders ahead of the individual venues.
   */
  londonOnsaleSpend: number | null;
  /**
   * Lifetime spend of the shared WC26-LONDON-PRESALE campaign. Surfaced as
   * an informational badge on the Overall London header — per-event prereg
   * is already split correctly across the venues that ran a presale, so
   * this value is not redistributed by the table.
   */
  londonPresaleSpend: number | null;
  /**
   * All daily tracker rows for the client. Filtered down to the
   * venue's events inside each VenueSection's <DailyTracker />.
   */
  dailyEntries: DailyEntry[];
  onSnapshotSaved: (eventId: string, snapshot: SavedSnapshot) => void;
}

/**
 * Venue-grouped reporting table that replaces the old per-event card list
 * on /share/client/[token]. The shape mirrors the Google Sheets doc the
 * client used to maintain by hand: one section per venue, one data row per
 * event, plus a "Total" row that re-derives CPT / ROAS from the
 * venue-level sums.
 *
 * Two spend models — picked per venue group via `venueSpend()`:
 *   - `split` (default, non-London): meta_spend_cached is treated as the
 *     campaign's *combined* spend (prereg + on-sale rolled into one Meta
 *     campaign). Per-event total = campaignSpend / eventCount; per-event
 *     ad = perEventTotal − prereg. This is the historical model.
 *   - `add` (London venues, when londonOnsaleSpend is provided): the four
 *     London venues share an extra on-sale campaign on top of each
 *     venue's own meta campaign. Per-event ad = ((onsale / 4) + venueMeta)
 *     / eventCount. Per-event total = prereg + perEventAd. This matches
 *     the new WC26 wiring where prereg and on-sale live in distinct Meta
 *     campaigns.
 *
 * Revenue is no longer derived from a stored ticket_price — the client
 * types it in directly through the snapshot row.
 *
 * Edit mode: a single "Edit" button at the top of each venue section
 * flips every Tickets Sold + Revenue cell to inline inputs. Cells save
 * on blur (no per-row Save button). "Done" exits edit mode.
 */

/**
 * Number of London venues sharing the WC26-LONDON-ONSALE campaign.
 * Hard-coded because the divisor is a contractual fact about how the
 * shared spend is allocated, not a count derived from venue rows
 * present in any given snapshot — using `londonGroups.length` would
 * silently rebalance if a venue went missing from the dataset.
 */
const LONDON_VENUE_COUNT = 4;

function isLondonCity(city: string | null | undefined): boolean {
  return (city ?? "").toLowerCase() === "london";
}

/**
 * Region buckets the venue table renders as separate sub-sections.
 * Order here is also the render order top-to-bottom on the page.
 */
type Region = "scotland" | "london" | "england_uk";

const REGION_LABEL: Record<Region, string> = {
  scotland: "Scotland",
  london: "England – London",
  england_uk: "England – UK",
};

const REGION_ORDER: Region[] = ["scotland", "london", "england_uk"];

/**
 * Fixed render order for the four London venues — matches the
 * spreadsheet sheet the client expects to see. Substring matching
 * (case-insensitive) so harmless name variants like "Shepherds Bush"
 * vs "Shepherd's Bush" both anchor to the same slot.
 */
const LONDON_VENUE_ORDER = [
  "kentish",
  "shepherd",
  "shoreditch",
  "tottenham",
] as const;

function londonOrderIndex(displayName: string): number {
  const lower = displayName.toLowerCase();
  for (let i = 0; i < LONDON_VENUE_ORDER.length; i++) {
    if (lower.includes(LONDON_VENUE_ORDER[i])) return i;
  }
  // Anything not on the canonical list lands at the end. Defensive — a
  // new London venue we haven't slotted yet shouldn't disappear.
  return LONDON_VENUE_ORDER.length;
}

function regionForGroup(group: VenueGroup): Region {
  // Scotland is country-driven (Aberdeen / Edinburgh have no city
  // signal that distinguishes them from English cities). Spec calls
  // out reading from group.events[0].venue_country specifically; every
  // event in a group shares a venue, so [0] is sufficient.
  if (group.events[0]?.venue_country === "Scotland") return "scotland";
  if (isLondonCity(group.city)) return "london";
  return "england_uk";
}

function compareByCityThenName(a: VenueGroup, b: VenueGroup): number {
  const cityCmp = (a.city ?? "").localeCompare(b.city ?? "");
  if (cityCmp !== 0) return cityCmp;
  return a.displayName.localeCompare(b.displayName);
}

function partitionByRegion(venues: VenueGroup[]): Record<Region, VenueGroup[]> {
  const out: Record<Region, VenueGroup[]> = {
    scotland: [],
    london: [],
    england_uk: [],
  };
  for (const group of venues) {
    out[regionForGroup(group)].push(group);
  }
  out.scotland.sort(compareByCityThenName);
  out.london.sort(
    (a, b) => londonOrderIndex(a.displayName) - londonOrderIndex(b.displayName),
  );
  out.england_uk.sort(compareByCityThenName);
  return out;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("en-GB");

function formatGBP(n: number | null, dp: 0 | 2 = 0): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (dp === 2 ? GBP2 : GBP).format(n);
}

function formatNumber(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return NUM.format(n);
}

function formatChange(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : ""}${NUM.format(n)}`;
}

function formatRoas(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)}×`;
}

function roasClass(n: number | null): string {
  if (n === null) return "text-zinc-500";
  if (n >= 3) return "text-emerald-600 font-semibold";
  if (n < 1) return "text-red-600 font-semibold";
  return "text-zinc-700";
}

/**
 * CPT change is a *signed* delta in GBP. Convention:
 *   - negative = CPT fell (more tickets per pound) → good, render green
 *   - positive = CPT rose (each ticket costs more) → bad, render amber
 *   - null     = previous-week CPT can't be computed (no prior tickets
 *                or no spend yet) → muted
 *
 * The leading `+` / `−` characters are the typographic sign glyphs (real
 * Unicode minus, not ASCII hyphen) so the column visually aligns even
 * when a row has no sign prefix.
 */
function formatCptChange(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n === 0) return GBP2.format(0);
  const abs = GBP2.format(Math.abs(n));
  return n > 0 ? `+${abs}` : `−${abs}`;
}

function cptChangeClass(n: number | null): string {
  if (n === null) return "text-zinc-500";
  if (n < 0) return "text-emerald-600 font-semibold";
  if (n > 0) return "text-amber-600 font-semibold";
  return "text-zinc-700";
}

interface VenueGroup {
  key: string;
  displayName: string;
  city: string | null;
  budget: number | null;
  /** First non-null meta_spend_cached across the group's events. */
  campaignSpend: number | null;
  /** Number of events in the group — divisor for per-event total. */
  eventCount: number;
  events: PortalEvent[];
}

function groupByVenue(events: PortalEvent[]): VenueGroup[] {
  const map = new Map<string, VenueGroup>();
  for (const ev of events) {
    const name = ev.venue_name ?? "Unknown venue";
    const city = ev.venue_city ?? "";
    const key = `${name}||${city}`;
    const existing = map.get(key);
    if (existing) {
      existing.events.push(ev);
      existing.eventCount += 1;
      if (existing.budget === null && ev.budget_marketing !== null) {
        existing.budget = ev.budget_marketing;
      }
      if (existing.campaignSpend === null && ev.meta_spend_cached !== null) {
        existing.campaignSpend = ev.meta_spend_cached;
      }
    } else {
      map.set(key, {
        key,
        displayName: name,
        city: ev.venue_city,
        budget: ev.budget_marketing,
        campaignSpend: ev.meta_spend_cached,
        eventCount: 1,
        events: [ev],
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

/**
 * Per-venue spend model. `split` is the legacy shape (campaign total
 * is one number, prereg is carved out of it). `add` is the WC26 London
 * shape (prereg and on-sale spend live in different Meta campaigns and
 * are *added* to produce the per-event total).
 */
type GroupSpend =
  | { kind: "split"; perEventTotal: number | null }
  | { kind: "add"; perEventAd: number | null };

function venueSpend(
  group: VenueGroup,
  londonOnsaleSpend: number | null,
): GroupSpend {
  if (isLondonCity(group.city) && londonOnsaleSpend !== null) {
    // London additive model. Either input may be null in transitional
    // states (e.g. admin has refreshed onsale but not yet the venue
    // campaign). Treat null as 0 for the sum so a half-populated state
    // still surfaces whichever half is known. Returns null only when
    // the venue truly has no spend signal *and* no event count to
    // divide by.
    const onsaleShare = londonOnsaleSpend / LONDON_VENUE_COUNT;
    const venueMeta = group.campaignSpend ?? 0;
    const perEventAd =
      group.eventCount > 0 ? (onsaleShare + venueMeta) / group.eventCount : null;
    return { kind: "add", perEventAd };
  }
  const perEventTotal =
    group.campaignSpend !== null && group.eventCount > 0
      ? group.campaignSpend / group.eventCount
      : null;
  return { kind: "split", perEventTotal };
}

interface EventMetrics {
  prereg: number | null;
  perEventTotal: number | null;
  perEventAd: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  /** perEventTotal / prevTickets — null when prevTickets is 0 or spend is null. */
  cptPrevious: number | null;
  /** cpt − cptPrevious — null when either side is null. */
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
}

function computeEventMetrics(
  ev: PortalEvent,
  spend: GroupSpend,
): EventMetrics {
  const prereg = ev.prereg_spend;

  // Resolve perEventAd / perEventTotal pair from the two spend models.
  // The "ad / total / prereg" triangle is consistent in both: total =
  // prereg + ad. The models differ only in *which* of (ad, total) is the
  // independent input the venue carries.
  let perEventAd: number | null;
  let perEventTotal: number | null;
  if (spend.kind === "split") {
    perEventTotal = spend.perEventTotal;
    perEventAd =
      perEventTotal !== null ? perEventTotal - (prereg ?? 0) : null;
  } else {
    perEventAd = spend.perEventAd;
    perEventTotal = perEventAd !== null ? (prereg ?? 0) + perEventAd : null;
  }

  const tickets = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
  const prev = ev.tickets_sold_previous ?? 0;
  const cpt =
    perEventTotal !== null && perEventTotal > 0 && tickets > 0
      ? perEventTotal / tickets
      : null;
  // Prev-week CPT uses the *same* per-event spend as the current row —
  // the campaign-level cache doesn't carry a historical snapshot, so
  // this is "what last week's tickets would cost at today's spend".
  // Same trade-off the Excel sheet had; it's the only honest option
  // until we start snapshotting meta_spend_cached too.
  const cptPrevious =
    perEventTotal !== null && perEventTotal > 0 && prev > 0
      ? perEventTotal / prev
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const revenue = ev.latest_snapshot?.revenue ?? null;
  const roas =
    revenue !== null && perEventTotal !== null && perEventTotal > 0
      ? revenue / perEventTotal
      : null;
  return {
    prereg,
    perEventTotal,
    perEventAd,
    tickets,
    prevTickets: prev,
    change: tickets - prev,
    cpt,
    cptPrevious,
    cptChange,
    revenue,
    roas,
  };
}

interface VenueTotals {
  prereg: number;
  ad: number | null;
  total: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  cptPrevious: number | null;
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
}

function sumVenue(group: VenueGroup, spend: GroupSpend): VenueTotals {
  let prereg = 0;
  let tickets = 0;
  let prevTickets = 0;
  let revenue = 0;
  let hasRevenue = false;
  for (const ev of group.events) {
    prereg += ev.prereg_spend ?? 0;
    const sold = ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
    tickets += sold;
    prevTickets += ev.tickets_sold_previous ?? 0;
    const r = ev.latest_snapshot?.revenue;
    if (r !== null && r !== undefined) {
      hasRevenue = true;
      revenue += r;
    }
  }

  let total: number | null;
  let ad: number | null;
  if (spend.kind === "split") {
    // Legacy: campaign value already includes prereg, so ad = total − prereg.
    total = group.campaignSpend;
    ad = total !== null ? total - prereg : null;
  } else {
    // London: venue ad = perEventAd × eventCount (== onsaleShare + venueMeta).
    // Total = prereg + venueAd. Re-multiplying perEventAd preserves the
    // exact same arithmetic the per-row cells use, so the venue total
    // matches the visible sum of its rows without floating-point drift.
    const venueAd =
      spend.perEventAd !== null ? spend.perEventAd * group.eventCount : null;
    ad = venueAd;
    total = venueAd !== null ? prereg + venueAd : null;
  }

  const cpt = total !== null && total > 0 && tickets > 0 ? total / tickets : null;
  const cptPrevious =
    total !== null && total > 0 && prevTickets > 0
      ? total / prevTickets
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const finalRevenue = hasRevenue ? revenue : null;
  const roas =
    finalRevenue !== null && total !== null && total > 0
      ? finalRevenue / total
      : null;
  return {
    prereg,
    ad,
    total,
    tickets,
    prevTickets,
    change: tickets - prevTickets,
    cpt,
    cptPrevious,
    cptChange,
    revenue: finalRevenue,
    roas,
  };
}

export function ClientPortalVenueTable({
  token,
  events,
  londonOnsaleSpend,
  londonPresaleSpend,
  dailyEntries,
  onSnapshotSaved,
}: Props) {
  const venues = useMemo(() => groupByVenue(events), [events]);
  const regions = useMemo(() => partitionByRegion(venues), [venues]);

  if (venues.length === 0) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-8 text-center">
        <p className="text-sm text-zinc-600">
          No events to report on yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {REGION_ORDER.map((region) => {
        const groups = regions[region];
        if (groups.length === 0) return null;
        return (
          <div key={region} className="space-y-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">
              {REGION_LABEL[region]}
            </h2>
            {/* Overall London aggregate sits at the top of the London
                region, mirroring the spreadsheet layout the client uses
                offline. Other regions don't have a shared-campaign
                aggregate so this only fires for `london`. */}
            {region === "london" && (
              <OverallLondonSection
                groups={groups}
                onsaleSpend={londonOnsaleSpend}
                presaleSpend={londonPresaleSpend}
              />
            )}
            {groups.map((group) => (
              <VenueSection
                key={group.key}
                token={token}
                group={group}
                spend={venueSpend(group, londonOnsaleSpend)}
                dailyEntries={dailyEntries}
                onSnapshotSaved={onSnapshotSaved}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface OverallLondonSectionProps {
  groups: VenueGroup[];
  onsaleSpend: number | null;
  presaleSpend: number | null;
}

interface OverallLondonTotals {
  prereg: number;
  ad: number | null;
  total: number | null;
  tickets: number;
  prevTickets: number;
  change: number;
  cpt: number | null;
  cptPrevious: number | null;
  cptChange: number | null;
  revenue: number | null;
  roas: number | null;
  /** Sum of meta_spend_cached across the London venue groups (display only). */
  venueMetaSum: number | null;
  /** Number of underlying London match events (sanity-check / footnote). */
  eventCount: number;
}

function computeOverallLondon(
  groups: VenueGroup[],
  onsaleSpend: number | null,
): OverallLondonTotals {
  let prereg = 0;
  let tickets = 0;
  let prevTickets = 0;
  let revenue = 0;
  let hasRevenue = false;
  let venueMetaSum = 0;
  let venueMetaCount = 0;
  let eventCount = 0;
  for (const group of groups) {
    eventCount += group.eventCount;
    if (group.campaignSpend !== null) {
      venueMetaSum += group.campaignSpend;
      venueMetaCount += 1;
    }
    for (const ev of group.events) {
      prereg += ev.prereg_spend ?? 0;
      tickets += ev.latest_snapshot?.tickets_sold ?? ev.tickets_sold ?? 0;
      prevTickets += ev.tickets_sold_previous ?? 0;
      const r = ev.latest_snapshot?.revenue;
      if (r !== null && r !== undefined) {
        hasRevenue = true;
        revenue += r;
      }
    }
  }

  // Ad Spend column = onsale shared campaign only — matches the
  // spreadsheet OVERALL row where "Ad Spend" is the on-sale campaign
  // total (£1,108.89), not the sum of all London meta activity.
  // Total Spend = everything: presale (prereg) + onsale + venue metas,
  // computed separately so the column triangle is: Total ≠ Pre-reg + Ad.
  const venueMetaTotal = venueMetaCount > 0 ? venueMetaSum : null;
  const adSpend = onsaleSpend;
  const total =
    onsaleSpend !== null || venueMetaTotal !== null
      ? prereg + (onsaleSpend ?? 0) + (venueMetaTotal ?? 0)
      : null;
  const cpt = total !== null && total > 0 && tickets > 0 ? total / tickets : null;
  const cptPrevious =
    total !== null && total > 0 && prevTickets > 0
      ? total / prevTickets
      : null;
  const cptChange =
    cpt !== null && cptPrevious !== null ? cpt - cptPrevious : null;
  const finalRevenue = hasRevenue ? revenue : null;
  const roas =
    finalRevenue !== null && total !== null && total > 0
      ? finalRevenue / total
      : null;

  return {
    prereg,
    ad: adSpend,
    total,
    tickets,
    prevTickets,
    change: tickets - prevTickets,
    cpt,
    cptPrevious,
    cptChange,
    revenue: finalRevenue,
    roas,
    venueMetaSum: venueMetaTotal,
    eventCount,
  };
}

/**
 * Roll-up for all London venues. Single-row aggregate that matches the
 * "OVERALL" line in the England London Ticketing spreadsheet — *not* a
 * venue table. Deliberately drops the prev / change / CPT-prev / CPT-
 * change columns: the spreadsheet treats those as per-venue detail
 * only, and showing them here would imply a level of period-on-period
 * accuracy this row doesn't have (campaign-level spend is not
 * snapshotted historically).
 *
 * Numbers come from `computeOverallLondon`, which over-computes a few
 * fields the JSX no longer renders (prevTickets, change, cptPrevious,
 * cptChange). Left in place to avoid touching shared totals plumbing
 * for a presentational change — the unused fields cost nothing.
 */
function OverallLondonSection({
  groups,
  onsaleSpend,
  presaleSpend,
}: OverallLondonSectionProps) {
  const totals = useMemo(
    () => computeOverallLondon(groups, onsaleSpend),
    [groups, onsaleSpend],
  );

  return (
    <section className="rounded-md border-2 border-zinc-900 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
        <h2 className="font-heading text-lg tracking-wide text-zinc-900">
          Overall London
        </h2>
        {/* Header badges intentionally surface the *source* shared-
            campaign totals (presale + on-sale) rather than the derived
            per-event splits — these are the two numbers the client
            keeps in the spreadsheet header, so matching them lets the
            admin reconcile at a glance. Hidden when null so an
            unrefreshed state doesn't render "Pre-reg: —". */}
        {presaleSpend !== null && (
          <p className="text-xs text-zinc-600">
            Pre-reg:{" "}
            <span className="font-semibold text-zinc-900">
              {formatGBP(presaleSpend, 2)}
            </span>
          </p>
        )}
        {presaleSpend !== null && onsaleSpend !== null && (
          <span className="text-xs text-zinc-400" aria-hidden="true">
            ·
          </span>
        )}
        {onsaleSpend !== null && (
          <p className="text-xs text-zinc-600">
            On-sale:{" "}
            <span className="font-semibold text-zinc-900">
              {formatGBP(onsaleSpend, 2)}
            </span>
          </p>
        )}
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-900 text-left text-xs font-medium uppercase tracking-wide text-white">
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5 text-right">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad Spend</th>
              <th className="px-3 py-2.5 text-right">Total Spend</th>
              <th className="px-3 py-2.5 text-right">Tickets Sold</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
              <th className="px-3 py-2.5 text-right">Ticket Revenue</th>
              <th className="px-3 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-zinc-100 text-zinc-900">
              <td className="px-3 py-2.5 font-semibold">All London</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.ad)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.total)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatNumber(totals.tickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cpt, 2)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.revenue)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${roasClass(totals.roas)}`}
              >
                {formatRoas(totals.roas)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface VenueSectionProps {
  token: string;
  group: VenueGroup;
  /**
   * Spend model for this venue. Computed once by the parent via
   * `venueSpend()` so the model selection lives in one place and the
   * Overall London row + venue rows draw from identical arithmetic.
   */
  spend: GroupSpend;
  /** All daily tracker rows for the client. Filtered to this venue's
   *  events by the embedded <DailyTracker />. */
  dailyEntries: DailyEntry[];
  onSnapshotSaved: Props["onSnapshotSaved"];
}

/**
 * Daily-entry rollup keyed by date. Drives the trend chart's X axis.
 *
 * Source values stay null when the venue's events report no value for
 * that field on that date — distinct from "value is 0". The chart
 * uses null to *break* lines rather than draw misleading zero
 * segments, and the latest-value pill labels suppress similarly.
 */
interface ChartDay {
  date: string;
  spend: number | null;
  tickets: number | null;
  revenue: number | null;
  linkClicks: number | null;
  cpt: number | null;
  roas: number | null;
  cpc: number | null;
}

type MetricKey = "spend" | "tickets" | "cpt" | "roas" | "linkClicks" | "cpc";

interface MetricDef {
  key: MetricKey;
  label: string;
  /** Hex colour used for the SVG line + the HTML pill swatch. Kept
   *  as a single literal so the two surfaces never drift. */
  colour: string;
  format: (n: number) => string;
}

const METRICS: MetricDef[] = [
  { key: "spend", label: "Spend", colour: "#27272a", format: (n) => GBP2.format(n) },
  { key: "tickets", label: "Tickets", colour: "#10b981", format: (n) => NUM.format(n) },
  { key: "cpt", label: "CPT", colour: "#f59e0b", format: (n) => GBP2.format(n) },
  { key: "roas", label: "ROAS", colour: "#8b5cf6", format: (n) => `${n.toFixed(2)}×` },
  { key: "linkClicks", label: "Clicks", colour: "#0ea5e9", format: (n) => NUM.format(n) },
  { key: "cpc", label: "CPC", colour: "#f43f5e", format: (n) => GBP2.format(n) },
];

/**
 * Aggregate per-event tracker rows down to one row per date. Sums
 * propagate nullness: a date where every contributing entry has a
 * null spend stays null (rather than collapsing to 0) so downstream
 * code can distinguish "no data" from "spent nothing".
 *
 * Output is sorted by date ASC for direct consumption by the chart.
 */
function aggregateEntriesByDate(entries: DailyEntry[]): ChartDay[] {
  type Acc = {
    spend: number | null;
    tickets: number | null;
    revenue: number | null;
    linkClicks: number | null;
  };
  const map = new Map<string, Acc>();
  for (const e of entries) {
    const cur =
      map.get(e.date) ??
      ({ spend: null, tickets: null, revenue: null, linkClicks: null } as Acc);
    if (e.day_spend !== null) cur.spend = (cur.spend ?? 0) + e.day_spend;
    if (e.tickets !== null) cur.tickets = (cur.tickets ?? 0) + e.tickets;
    if (e.revenue !== null) cur.revenue = (cur.revenue ?? 0) + e.revenue;
    if (e.link_clicks !== null)
      cur.linkClicks = (cur.linkClicks ?? 0) + e.link_clicks;
    map.set(e.date, cur);
  }
  return [...map.keys()]
    .sort()
    .map((date) => {
      const v = map.get(date)!;
      const cpt =
        v.spend !== null && v.spend > 0 && v.tickets !== null && v.tickets > 0
          ? v.spend / v.tickets
          : null;
      const roas =
        v.revenue !== null && v.revenue > 0 && v.spend !== null && v.spend > 0
          ? v.revenue / v.spend
          : null;
      const cpc =
        v.spend !== null &&
        v.spend > 0 &&
        v.linkClicks !== null &&
        v.linkClicks > 0
          ? v.spend / v.linkClicks
          : null;
      return {
        date,
        spend: v.spend,
        tickets: v.tickets,
        revenue: v.revenue,
        linkClicks: v.linkClicks,
        cpt,
        roas,
        cpc,
      };
    });
}

/**
 * Format YYYY-MM-DD as `14 Apr` in en-GB. UTC-anchored — the API
 * persists ISO date strings, not timestamps, so the local timezone
 * mustn't shift the rendered day.
 */
function chartShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** Last non-null value of a metric across the day series, or null
 *  when the metric has no data points at all. Powers the latest-
 *  value badge inside each pill so the toggle row is also a legend. */
function latestMetricValue(days: ChartDay[], key: MetricKey): number | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][key];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Multi-metric time-series chart for a venue's daily tracker entries.
 *
 * Self-hides when fewer than two distinct days of data exist — a
 * single point can't draw a meaningful line and the empty plot would
 * imply data we don't have.
 *
 * Each metric has its own implicit Y scale (max-normalised to the plot
 * height independently), so absolute values across series aren't
 * comparable but trends are. The pills under the title double as the
 * legend (colour swatch + metric name + latest value) and the toggle
 * surface — clicking adds/removes a series. Refusing to deselect the
 * last active metric keeps the plot from going visually empty
 * mid-interaction; the user can always swap to a different metric in
 * a single click.
 *
 * Implementation detail: SVG draws lines + dots in a stretched
 * `preserveAspectRatio="none"` viewport so the geometry fills any
 * container width. Date labels are HTML overlaid below the SVG so
 * they don't get horizontally squished by the viewport stretch.
 */
function CptTrendChart({ entries }: { entries: DailyEntry[] }) {
  const days = useMemo(() => aggregateEntriesByDate(entries), [entries]);
  const [active, setActive] = useState<Set<MetricKey>>(
    () => new Set<MetricKey>(["cpt"]),
  );

  if (days.length < 2) return null;

  const toggle = (key: MetricKey) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Refuse to deselect the only remaining metric — the plot
        // would otherwise render an empty axis frame which reads as
        // a bug rather than a state.
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Stretchable plot area. Geometry only — text lives in HTML below.
  const VB_W = 600;
  const VB_H = 150;
  const PAD_T = 8;
  const PAD_R = 8;
  const PAD_B = 8;
  const PAD_L = 8;
  const plotW = VB_W - PAD_L - PAD_R;
  const plotH = VB_H - PAD_T - PAD_B;

  const xAt = (i: number): number =>
    days.length === 1
      ? PAD_L + plotW / 2
      : PAD_L + (i / (days.length - 1)) * plotW;

  // For each active metric build (a) a per-metric max for normalisation
  // and (b) polyline segments split on null gaps. A single polyline
  // through nulls would draw straight across missing days and lie
  // about the trend; segmenting preserves the gap visually.
  type SeriesPoint = { x: number; y: number; v: number };
  type Series = {
    metric: MetricDef;
    segments: SeriesPoint[][];
    points: SeriesPoint[];
  };
  const series: Series[] = METRICS.filter((m) => active.has(m.key)).map((m) => {
    const raw = days.map((d) => d[m.key]);
    const nonNull = raw.filter(
      (v): v is number => v !== null && Number.isFinite(v),
    );
    const max = nonNull.length > 0 ? Math.max(...nonNull) : 0;
    // Headroom keeps the topmost point off the upper edge.
    const yMax = max > 0 ? max * 1.1 : 1;
    const segments: SeriesPoint[][] = [];
    const points: SeriesPoint[] = [];
    let cur: SeriesPoint[] = [];
    raw.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (cur.length > 0) {
          segments.push(cur);
          cur = [];
        }
        return;
      }
      const y = PAD_T + plotH - (v / yMax) * plotH;
      const point: SeriesPoint = { x: xAt(i), y, v };
      cur.push(point);
      points.push(point);
    });
    if (cur.length > 0) segments.push(cur);
    return { metric: m, segments, points };
  });

  // Date label cadence: cap at ~6 visible labels regardless of point
  // count so the row stays readable on mobile. Always include first
  // and last so the timeline endpoints are anchored.
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));
  const labelDays = days.filter(
    (_, i) => i === 0 || i === days.length - 1 || i % labelEvery === 0,
  );

  return (
    <div className="border-t border-zinc-200 px-4 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          Daily trend
        </p>
        <p className="text-[10px] text-zinc-400">
          {days.length} day{days.length === 1 ? "" : "s"} · click pills to
          toggle
        </p>
      </div>
      {/* Pill toggles double as legend. Latest non-null value is shown
          alongside the metric name so the pill carries information
          even before you read the chart. */}
      <div className="mb-3 flex flex-wrap gap-1.5">
        {METRICS.map((m) => {
          const isActive = active.has(m.key);
          const latest = latestMetricValue(days, m.key);
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => toggle(m.key)}
              aria-pressed={isActive}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white text-zinc-600 hover:border-zinc-500"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: m.colour }}
                aria-hidden="true"
              />
              {m.label}
              {latest !== null && (
                <span
                  className={`tabular-nums ${isActive ? "text-zinc-300" : "text-zinc-500"}`}
                >
                  {m.format(latest)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          width="100%"
          height={150}
          role="img"
          aria-label="Daily metric trend chart"
          className="overflow-visible"
        >
          {/* Baseline + top reference for visual grounding. */}
          <line
            x1={PAD_L}
            x2={VB_W - PAD_R}
            y1={PAD_T + plotH}
            y2={PAD_T + plotH}
            stroke="#e4e4e7"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {series.map((s) =>
            s.segments.map((seg, i) => (
              <polyline
                key={`${s.metric.key}-${i}`}
                points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={s.metric.colour}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )),
          )}
          {series.map((s) =>
            s.points.map((p, i) => (
              <circle
                key={`${s.metric.key}-pt-${i}`}
                cx={p.x}
                cy={p.y}
                r={2.5}
                fill={s.metric.colour}
                stroke="#ffffff"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )),
          )}
        </svg>
        {/* HTML date labels overlaid below — kept out of SVG so the
            stretched viewport doesn't squish the text horizontally. */}
        <div className="pointer-events-none mt-1 flex justify-between text-[10px] tabular-nums text-zinc-500">
          {labelDays.map((d) => (
            <span key={d.date}>{chartShortDate(d.date)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const COL_COUNT = 12;

function VenueSection({
  token,
  group,
  spend,
  dailyEntries,
  onSnapshotSaved,
}: VenueSectionProps) {
  const [editMode, setEditMode] = useState(false);
  const totals = useMemo(() => sumVenue(group, spend), [group, spend]);
  const headerLabel = group.city
    ? `${group.displayName}, ${group.city}`
    : group.displayName;
  // Pre-filter the client-wide tracker rows down to this venue's
  // events. Done here (cheap) rather than passing the full set into
  // every DailyTracker so the per-event grouping inside the tracker
  // doesn't have to also discriminate by venue.
  const venueEventIds = useMemo(
    () => new Set(group.events.map((e) => e.id)),
    [group.events],
  );
  const venueEntries = useMemo(
    () => dailyEntries.filter((e) => venueEventIds.has(e.event_id)),
    [dailyEntries, venueEventIds],
  );

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-zinc-200 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-heading text-lg tracking-wide text-zinc-900">
            {headerLabel}
          </h2>
          {group.budget !== null && (
            <p className="text-xs text-zinc-600">
              Ad Budget:{" "}
              <span className="font-semibold text-zinc-900">
                {formatGBP(group.budget)}
              </span>
            </p>
          )}
          {group.budget !== null && group.campaignSpend !== null && (
            <span className="text-xs text-zinc-400" aria-hidden="true">
              ·
            </span>
          )}
          {group.campaignSpend !== null && (
            <p className="text-xs text-zinc-600">
              Meta Spend:{" "}
              <span className="font-semibold text-zinc-900">
                {formatGBP(group.campaignSpend)}
              </span>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditMode((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            editMode
              ? "bg-zinc-900 text-white hover:bg-zinc-800"
              : "border border-zinc-300 text-zinc-700 hover:bg-zinc-100"
          }`}
          aria-pressed={editMode}
        >
          {editMode ? (
            "Done"
          ) : (
            <>
              <Pencil className="h-3 w-3" />
              Edit
            </>
          )}
        </button>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="bg-zinc-900 text-left text-xs font-medium uppercase tracking-wide text-white">
              <th className="px-3 py-2.5">Event</th>
              <th className="px-3 py-2.5 text-right">Pre-reg</th>
              <th className="px-3 py-2.5 text-right">Ad Spend</th>
              <th className="px-3 py-2.5 text-right">Total Spend</th>
              <th className="px-3 py-2.5 text-right">Tickets Sold</th>
              <th className="px-3 py-2.5 text-right">Tickets Prev</th>
              <th className="px-3 py-2.5 text-right">Tickets Change</th>
              <th className="px-3 py-2.5 text-right">CPT</th>
              <th className="px-3 py-2.5 text-right">CPT Prev</th>
              <th className="px-3 py-2.5 text-right">CPT Change</th>
              <th className="px-3 py-2.5 text-right">Ticket Revenue</th>
              <th className="px-3 py-2.5 text-right">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {group.events.map((ev, i) => (
              <EventRow
                key={ev.id}
                token={token}
                event={ev}
                striped={i % 2 === 1}
                editMode={editMode}
                spend={spend}
                onSnapshotSaved={onSnapshotSaved}
              />
            ))}
            <tr className="border-t border-zinc-300 bg-zinc-100 text-zinc-900">
              <td className="px-3 py-2.5 font-semibold">Total</td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.prereg)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.ad)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.total)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatNumber(totals.tickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-zinc-500">
                {formatNumber(totals.prevTickets)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatChange(totals.change)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cpt, 2)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.cptPrevious, 2)}
              </td>
              <td
                className={`px-3 py-2.5 text-right font-semibold tabular-nums ${cptChangeClass(totals.cptChange)}`}
              >
                {formatCptChange(totals.cptChange)}
              </td>
              <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                {formatGBP(totals.revenue)}
              </td>
              <td
                className={`px-3 py-2.5 text-right tabular-nums ${roasClass(totals.roas)}`}
              >
                {formatRoas(totals.roas)}
              </td>
            </tr>
          </tbody>
        </table>
        {/* Defensive: keep the column count in sync with the header so a
            future edit doesn't silently desync the grid. */}
        <span aria-hidden="true" className="sr-only" data-col-count={COL_COUNT} />
      </div>
      {/* Multi-metric time-series fed by the venue's daily tracker
          rows. Self-hides when fewer than two distinct days exist —
          new venues without a tracker history won't render anything,
          which is the correct empty state. */}
      <CptTrendChart entries={venueEntries} />
      {/* Collapsed-by-default daily tracker mirrors the Excel sheet
          the client team currently keeps by hand. Read-only on the
          public portal; the underlying /daily POST route exists for a
          future internal admin UI. */}
      <DailyTracker
        token={token}
        events={group.events}
        entries={venueEntries}
      />
    </section>
  );
}

interface EventRowProps {
  token: string;
  event: PortalEvent;
  striped: boolean;
  editMode: boolean;
  spend: GroupSpend;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

function EventRow({
  token,
  event,
  striped,
  editMode,
  spend,
  onSnapshotSaved,
}: EventRowProps) {
  const m = computeEventMetrics(event, spend);
  const rowBg = striped ? "bg-zinc-50" : "bg-white";

  return (
    <tr className={`border-t border-zinc-200 ${rowBg} hover:bg-zinc-100/50`}>
      <td className="px-3 py-2.5 align-top">
        <span className="block font-medium text-zinc-900">{event.name}</span>
        {event.event_code && (
          <span className="block text-[11px] text-zinc-500">
            {event.event_code}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {formatGBP(m.prereg)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {formatGBP(m.perEventAd)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-zinc-900">
        {formatGBP(m.perEventTotal)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <NumericCell
          // Remount when the saved value changes (snapshot upserts) so
          // the uncontrolled input picks up the new defaultValue.
          key={`tickets:${m.tickets}`}
          token={token}
          event={event}
          field="tickets_sold"
          editMode={editMode}
          currentValue={m.tickets}
          onSnapshotSaved={onSnapshotSaved}
        />
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-500">
        {event.tickets_sold_previous === null
          ? "—"
          : formatNumber(m.prevTickets)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {event.tickets_sold_previous === null ? "—" : formatChange(m.change)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-900">
        {formatGBP(m.cpt, 2)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
        {formatGBP(m.cptPrevious, 2)}
      </td>
      <td
        className={`px-3 py-2.5 text-right tabular-nums ${cptChangeClass(m.cptChange)}`}
      >
        {formatCptChange(m.cptChange)}
      </td>
      <td className="px-3 py-2.5 text-right">
        <NumericCell
          key={`revenue:${m.revenue ?? "null"}`}
          token={token}
          event={event}
          field="revenue"
          editMode={editMode}
          currentValue={m.revenue}
          onSnapshotSaved={onSnapshotSaved}
        />
      </td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${roasClass(m.roas)}`}>
        {formatRoas(m.roas)}
      </td>
    </tr>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

interface NumericCellProps {
  token: string;
  event: PortalEvent;
  field: "tickets_sold" | "revenue";
  editMode: boolean;
  /** Current rendered value — null means "not set yet" (display "—"). */
  currentValue: number | null;
  onSnapshotSaved: Props["onSnapshotSaved"];
}

/**
 * Editable numeric cell shared between Tickets Sold and Revenue.
 *
 * In view mode: renders the formatted value (or "—" when null) and a
 * subtle ✓ badge after a successful save.
 * In edit mode: renders an inline number input that persists on blur
 * (or Enter). Esc cancels and reverts to the last saved value.
 *
 * Both fields hit the same /api/share/client/[token]/tickets endpoint —
 * the API persists tickets_sold + revenue in one snapshot row, so we
 * always send the *other* field's current value through unchanged to
 * avoid accidentally clobbering it back to null.
 */
function NumericCell({
  token,
  event,
  field,
  editMode,
  currentValue,
  onSnapshotSaved,
}: NumericCellProps) {
  // The input is uncontrolled — `defaultValue` reflects the prop and the
  // ref reads the current text on blur. This sidesteps the "stale draft
  // after a sibling save" trap controlled inputs hit, and the
  // `key={currentValue}` on the parent <td> remounts the input when the
  // server-side value changes via a different field's save.
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const isCurrency = field === "revenue";

  const submit = async () => {
    const raw = inputRef.current?.value ?? "";
    const trimmed = raw.trim();
    // Empty input on a never-set value is a no-op; clearing a previously
    // saved value writes through as null (only relevant for revenue —
    // tickets_sold goes through the integer guard below).
    if (trimmed === "") {
      if (currentValue === null) return;
      // Tickets are required by the API; refuse to clear.
      if (field === "tickets_sold") {
        setSave({ kind: "error", message: "Required" });
        return;
      }
    }

    let parsedTickets: number;
    let parsedRevenue: number | null;

    if (field === "tickets_sold") {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        setSave({ kind: "error", message: "Whole numbers only" });
        return;
      }
      parsedTickets = n;
      parsedRevenue = event.latest_snapshot?.revenue ?? null;
    } else {
      // Revenue may have been left blank to clear; otherwise validate.
      if (trimmed === "") {
        parsedRevenue = null;
      } else {
        const n = Number(trimmed);
        if (!Number.isFinite(n) || n < 0) {
          setSave({ kind: "error", message: "Numbers ≥ 0 only" });
          return;
        }
        parsedRevenue = n;
      }
      parsedTickets =
        event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0;
    }

    // No-op if nothing actually changed — avoids hammering the API
    // every time a user tabs through the table.
    const ticketsUnchanged =
      field === "tickets_sold" &&
      parsedTickets ===
        (event.latest_snapshot?.tickets_sold ?? event.tickets_sold ?? 0);
    const revenueUnchanged =
      field === "revenue" &&
      parsedRevenue === (event.latest_snapshot?.revenue ?? null);
    if (ticketsUnchanged || revenueUnchanged) {
      return;
    }

    setSave({ kind: "saving" });
    try {
      const res = await fetch(`/api/share/client/${token}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          tickets_sold: parsedTickets,
          revenue: parsedRevenue,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        snapshot?: {
          tickets_sold: number | null;
          revenue: number | null;
          captured_at: string;
          week_start: string;
        };
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.snapshot) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      onSnapshotSaved(event.id, {
        tickets_sold: parsedTickets,
        revenue: parsedRevenue,
        captured_at: json.snapshot.captured_at,
        week_start: json.snapshot.week_start,
      });
      setSave({ kind: "saved", at: Date.now() });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setSave({ kind: "error", message });
    }
  };

  if (editMode) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        {isCurrency && (
          <span className="text-xs text-zinc-500" aria-hidden="true">
            £
          </span>
        )}
        <input
          ref={inputRef}
          type="number"
          inputMode={isCurrency ? "decimal" : "numeric"}
          min={0}
          step={isCurrency ? "0.01" : 1}
          defaultValue={currentValue === null ? "" : String(currentValue)}
          onBlur={() => {
            void submit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
            if (e.key === "Escape") {
              if (inputRef.current) {
                inputRef.current.value =
                  currentValue === null ? "" : String(currentValue);
              }
              setSave({ kind: "idle" });
              e.currentTarget.blur();
            }
          }}
          disabled={save.kind === "saving"}
          aria-label={
            field === "tickets_sold"
              ? `Tickets sold for ${event.name}`
              : `Revenue for ${event.name}`
          }
          className={`h-7 ${isCurrency ? "w-24" : "w-20"} rounded border border-zinc-300 bg-white px-2 text-right text-sm tabular-nums text-zinc-900 focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 disabled:bg-zinc-50`}
        />
        {save.kind === "saving" && (
          <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
        )}
        {save.kind === "saved" && (
          <span className="text-[11px] font-medium text-emerald-600">✓</span>
        )}
        {save.kind === "error" && (
          <span className="ml-1 text-[11px] text-red-600">{save.message}</span>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex items-center justify-end gap-1.5 tabular-nums text-zinc-900">
      <span className="font-medium">
        {currentValue === null
          ? "—"
          : isCurrency
            ? formatGBP(currentValue, 2)
            : formatNumber(currentValue)}
      </span>
      {save.kind === "saved" && (
        <span className="text-[11px] font-medium text-emerald-600">✓</span>
      )}
    </div>
  );
}
