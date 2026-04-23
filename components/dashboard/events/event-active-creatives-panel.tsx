"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Layers, RefreshCw } from "lucide-react";

import { NoPreviewThumbnailCard } from "@/components/report/no-preview-placeholder";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { fmtCurrency } from "@/lib/dashboard/format";
import {
  groupByAssetSignature,
  pickDisplayName,
  type ConceptGroupRow,
  type ConceptInputPreview,
} from "@/lib/reporting/group-creatives";
import CreativePreviewModal from "@/components/dashboard/events/creative-preview-modal";

/**
 * components/dashboard/events/event-active-creatives-panel.tsx
 *
 * "Active Creatives" tab on the event detail page. One card per
 * creative (not per ad — a single creative typically powers
 * several ad sets, sometimes several campaigns), with aggregated
 * spend / CTR / CPR / frequency and a deep link to Ads Manager.
 *
 * Data is fetched live from /api/events/[id]/active-creatives
 * (no client cache); the route is per-event so payloads stay
 * small and the up-to-10-second wait is acceptable when the user
 * clicks into the tab. The "Refresh" button re-calls the route.
 *
 * Sort happens client-side over the already-grouped row set so
 * switching ordering doesn't require another round-trip.
 *
 * Co-located with the other event-* panels rather than a new
 * top-level components/event/ folder so the dashboard-boundaries
 * rule (`components/dashboard/**` is write-freely) keeps holding.
 */

interface AdsetRef {
  id: string;
  name: string | null;
}
interface CampaignRef {
  id: string;
  name: string | null;
}

interface CreativeRow {
  creative_id: string;
  creative_name: string | null;
  /** Distinct ad-level names for this creative, spend-DESC ordered. */
  ad_names: string[];
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  /** Asset-grouping signals — present on every API row (see PR #40). */
  effective_object_story_id: string | null;
  object_story_id: string | null;
  primary_asset_signature: string | null;
  /** Modal preview payload — top-spend ad's copy on the underlying creative. */
  preview: ConceptInputPreview;
  ad_count: number;
  adsets: AdsetRef[];
  campaigns: CampaignRef[];
  representative_ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number | null;
  cpm: number | null;
  cpc: number | null;
  registrations: number;
  cpr: number | null;
  purchases: number;
  cpp: number | null;
  /** Landing-page views — see active-creatives-group.ts JSDoc. */
  landingPageViews: number;
  /** Cost per landing-page view. null when LPVs = 0. */
  cplpv: number | null;
  frequency: number | null;
  /** Plumbed PR #56 — sum of inline_link_clicks across underlying ads. */
  inline_link_clicks?: number;
  /** Plumbed PR #56 — true iff any underlying ad is currently ACTIVE. */
  any_ad_active?: boolean;
}

interface SuccessResponse {
  ok: true;
  creatives: CreativeRow[];
  ad_account_id: string | null;
  event_code: string | null;
  fetched_at: string;
  reason?:
    | "no_event_code"
    | "no_ad_account"
    | "no_linked_campaigns";
  meta: {
    campaigns_total: number;
    campaigns_failed: number;
    ads_fetched: number;
    dropped_no_creative: number;
    truncated: boolean;
    /**
     * Spend / volume from per-ad insight rows that had no AdInput
     * to stitch onto. PR #56 backstop so total creative spend
     * reconciles to total campaign spend on events with paused or
     * archived ads carrying historical cost.
     */
    unattributed?: {
      ads_count: number;
      spend: number;
      impressions: number;
      clicks: number;
      inline_link_clicks: number;
      landingPageViews: number;
      registrations: number;
      purchases: number;
    };
  };
}

interface FailureResponse {
  ok: false;
  reason?: string;
  error?: string;
}

type SortKey = "spend_desc" | "ctr_desc" | "cpr_asc" | "freq_desc";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "spend_desc", label: "Spend (high → low)" },
  { value: "ctr_desc", label: "CTR (high → low)" },
  { value: "cpr_asc", label: "CPR (low → high)" },
  { value: "freq_desc", label: "Frequency (high → low)" },
];

// Both per-creative_id rows and concept-grouped rows expose the same
// metric field names — the sorter is therefore generic over the row
// shape so the same comparator runs in either mode without a second
// switch statement.
interface SortableRow {
  spend: number;
  ctr: number | null;
  cpr: number | null;
  frequency: number | null;
}

function sortRows<T extends SortableRow>(
  rows: readonly T[],
  key: SortKey,
): T[] {
  const out = [...rows];
  const cmp = (a: number | null, b: number | null, asc: boolean): number => {
    // Nulls always sort to the bottom regardless of direction so a
    // creative with no registrations doesn't claim the "best CPR"
    // slot when the user picks CPR ASC.
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return asc ? a - b : b - a;
  };
  switch (key) {
    case "spend_desc":
      out.sort((a, b) => cmp(a.spend, b.spend, false));
      break;
    case "ctr_desc":
      out.sort((a, b) => cmp(a.ctr, b.ctr, false));
      break;
    case "cpr_asc":
      out.sort((a, b) => cmp(a.cpr, b.cpr, true));
      break;
    case "freq_desc":
      out.sort((a, b) => cmp(a.frequency, b.frequency, false));
      break;
  }
  return out;
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}
function fmtMoneyOrDash(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtCurrency(v);
}
function fmtFreq(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}

/**
 * Build a synthetic ConceptGroupRow from a single per-creative_id
 * row. Used when the "Group by concept" toggle is OFF — the modal
 * always takes a ConceptGroupRow so we don't have to maintain two
 * preview surfaces. Aggregation math collapses to identity (one row
 * in, one row out) so the metrics displayed match the card.
 */
function rowToSyntheticGroup(row: CreativeRow): ConceptGroupRow {
  // Display name reuses the same waterfall as the grouped path
  // (dominant ad.name → sanitised creative.name → semantic
  // fallback) so toggling "Group by concept" never makes the title
  // worse for the same underlying ad.
  const groupKey = `c:${row.creative_id}`;
  const display = pickDisplayName(
    row.ad_names,
    row.creative_name,
    "creative_id",
    groupKey,
    0,
  );
  return {
    group_key: groupKey,
    display_name: display,
    creative_id_count: 1,
    ad_count: row.ad_count,
    adsets: row.adsets,
    campaigns: row.campaigns,
    representative_ad_id: row.representative_ad_id,
    representative_thumbnail: row.thumbnail_url,
    representative_headline: row.headline,
    representative_body_preview: row.body,
    representative_preview: row.preview,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    reach: row.reach,
    registrations: row.registrations,
    purchases: row.purchases,
    landingPageViews: row.landingPageViews,
    ctr: row.ctr,
    cpm: row.cpm,
    cpc: row.cpc,
    cpr: row.cpr,
    cpp: row.cpp,
    cplpv: row.cplpv,
    frequency: row.frequency,
    // Mirror the bucket-level scale used by groupByAssetSignature so
    // toggling "Group by concept" off doesn't change the pill value
    // for the same single-creative case.
    fatigueScore:
      row.frequency == null || !Number.isFinite(row.frequency) || row.frequency < 3
        ? "ok"
        : row.frequency <= 5
          ? "warning"
          : "critical",
    inline_link_clicks: row.inline_link_clicks ?? 0,
    any_ad_active: row.any_ad_active ?? true,
    ad_names: row.ad_names,
    underlying_creative_ids: [row.creative_id],
    reasons: ["creative_id"],
  };
}

interface Props {
  eventId: string;
}

export function EventActiveCreativesPanel({ eventId }: Props) {
  const [data, setData] = useState<SuccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("spend_desc");
  // "Group by concept" defaults ON — Matas's main complaint with PR
  // #38 was that re-uploaded creatives (Meta mints a new creative_id
  // on duplicate) showed up as N separate rows. v1 stores in local
  // state only; we'll consider URL-persistence if it shows up in the
  // "I keep toggling this" feedback loop. Internally the grouper now
  // runs on Meta asset signals (post id / image hash / video id) —
  // the label stays "Group by concept" because that matches users'
  // mental model regardless of which signal collapsed the bucket.
  const [groupByConcept, setGroupByConcept] = useState(true);
  // Modal state — null when no preview open. We always normalise to
  // a ConceptGroupRow so the modal has one shape to render against
  // (per-creative_id rows are wrapped via rowToSyntheticGroup).
  const [openGroup, setOpenGroup] = useState<ConceptGroupRow | null>(null);

  const load = useCallback(
    async (opts: { refresh: boolean }) => {
      if (opts.refresh) setRefreshing(true);
      else setLoading(true);
      setTopError(null);
      setAuthExpired(false);
      try {
        const res = await fetch(`/api/events/${eventId}/active-creatives`, {
          method: "GET",
          cache: "no-store",
        });
        const j = (await res.json()) as SuccessResponse | FailureResponse;
        if (res.status === 401 || res.status === 403) {
          if ("reason" in j && j.reason === "auth_expired") {
            setAuthExpired(true);
          } else if ("error" in j && j.error) {
            setTopError(j.error);
          } else {
            setTopError("Not signed in.");
          }
          return;
        }
        if (!res.ok || !("ok" in j) || !j.ok) {
          const msg =
            "error" in j && j.error ? j.error : `HTTP ${res.status}`;
          setTopError(msg);
          return;
        }
        setData(j);
      } catch (err) {
        setTopError(
          err instanceof Error ? err.message : "Failed to load active creatives",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [eventId],
  );

  useEffect(() => {
    void load({ refresh: false });
  }, [load]);

  // When grouping is ON, collapse same-concept re-uploads first then
  // sort. When OFF, sort the per-creative_id rows the route returned.
  // Both branches share the same SortableRow comparator.
  const groupedRows = useMemo(
    () => (data ? groupByAssetSignature(data.creatives) : []),
    [data],
  );
  const visibleRows: Array<CreativeRow | ConceptGroupRow> = useMemo(() => {
    if (!data) return [];
    if (groupByConcept) return sortRows(groupedRows, sortKey);
    return sortRows(data.creatives, sortKey);
  }, [data, groupedRows, groupByConcept, sortKey]);

  const handleSortChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSortKey(e.target.value as SortKey);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="font-heading text-xl tracking-wide text-foreground">
            Active Creatives
          </h2>
          {data && data.creatives.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {groupByConcept
                ? `${groupedRows.length} concept${groupedRows.length === 1 ? "" : "s"}`
                : `${data.creatives.length} creative${data.creatives.length === 1 ? "" : "s"}`}
              {" · "}
              {data.meta.ads_fetched} ad
              {data.meta.ads_fetched === 1 ? "" : "s"} across{" "}
              {data.meta.campaigns_total} campaign
              {data.meta.campaigns_total === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Group-by toggle. Plain checkbox over a custom UI primitive
              because we don't have a Switch component yet and the
              existing Checkbox primitive's label support is enough. */}
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={groupByConcept}
              onChange={(e) => setGroupByConcept(e.target.checked)}
              className="h-4 w-4 rounded border-border-strong"
            />
            Group by concept
          </label>
          {data && visibleRows.length > 1 && (
            <div className="w-56">
              <Select
                aria-label="Sort by"
                options={SORT_OPTIONS.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                value={sortKey}
                onChange={handleSortChange}
              />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ refresh: true })}
            disabled={loading || refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {data?.meta.truncated && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          Showing the first 200 creatives. The remainder were trimmed to keep
          this view responsive — narrow your campaigns or use Ads Manager
          for the full list.
        </div>
      )}

      {data && data.meta.campaigns_failed > 0 && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
          {data.meta.campaigns_failed} of {data.meta.campaigns_total} linked
          campaign
          {data.meta.campaigns_failed === 1 ? "" : "s"} failed to load.
          Showing creatives from the rest.
        </div>
      )}

      {loading && !data && (
        <div className="rounded-md border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          <RefreshCw className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Fetching live from Meta — up to 10s.
        </div>
      )}

      {!loading && authExpired && (
        <ErrorBox
          title="Your Facebook session expired."
          body="Reconnect to refresh the live ad list."
        >
          <Link
            href="/auth/facebook-start"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            Reconnect Facebook
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </ErrorBox>
      )}

      {!loading && !authExpired && topError && (
        <ErrorBox title="Couldn't load active creatives." body={topError}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load({ refresh: false })}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        </ErrorBox>
      )}

      {!loading && !topError && !authExpired && data && (
        <EmptyOrGrid
          data={data}
          sorted={visibleRows}
          eventId={eventId}
          groupByConcept={groupByConcept}
          onOpen={(row) => {
            setOpenGroup(
              isConceptRow(row) ? row : rowToSyntheticGroup(row),
            );
          }}
        />
      )}

      {openGroup && (
        <CreativePreviewModal
          group={openGroup}
          adAccountId={data?.ad_account_id ?? null}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </div>
  );
}

function EmptyOrGrid({
  data,
  sorted,
  eventId,
  groupByConcept,
  onOpen,
}: {
  data: SuccessResponse;
  sorted: Array<CreativeRow | ConceptGroupRow>;
  eventId: string;
  groupByConcept: boolean;
  onOpen: (row: CreativeRow | ConceptGroupRow) => void;
}) {
  if (data.reason === "no_event_code") {
    return (
      <EmptyBox
        title="This event has no event code yet."
        body="Add an event code so we can find the live Meta campaigns linked to it."
      />
    );
  }
  if (data.reason === "no_ad_account") {
    return (
      <EmptyBox
        title="No Meta ad account on this client."
        body="Set the client's default ad account to enable live ad reporting."
      />
    );
  }
  if (data.reason === "no_linked_campaigns") {
    return (
      <EmptyBox
        title="No Meta campaigns linked to this event yet."
        body="Link one in the wizard to start tracking its creatives here."
      >
        <Link
          href={`/campaign/new?eventId=${encodeURIComponent(eventId)}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          Open the campaign wizard
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </EmptyBox>
    );
  }
  if (sorted.length === 0) {
    return (
      <EmptyBox
        title="No ads are currently active for this event."
        body={
          data.meta.dropped_no_creative > 0
            ? `Found ${data.meta.dropped_no_creative} active ad${data.meta.dropped_no_creative === 1 ? "" : "s"} without a creative attached. Cached insights for paused ads aren't shown here.`
            : "Cached insights for paused ads aren't shown here. Activate an ad to see it appear."
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((row) => (
        <CreativeCard
          key={isConceptRow(row) ? `g:${row.group_key}` : `c:${row.creative_id}`}
          row={toCardModel(row, groupByConcept)}
          onClick={() => onOpen(row)}
        />
      ))}
    </div>
  );
}

// Discriminated-union narrowing helper. ConceptGroupRow has
// `group_key`; CreativeRow doesn't — so checking that field is a
// safe runtime distinguisher without relying on a tagged union.
function isConceptRow(
  row: CreativeRow | ConceptGroupRow,
): row is ConceptGroupRow {
  return "group_key" in row;
}

interface CardModel {
  thumbnail: string | null;
  altText: string;
  headline: string | null;
  body: string | null;
  adCount: number;
  adsetCount: number;
  campaignCount: number;
  /** Defined only when grouping is on AND the group has > 1 underlying creative_id. */
  conceptMultiplier: number | null;
  spend: number;
  ctr: number | null;
  cpr: number | null;
  frequency: number | null;
  representativeAdId: string;
}

function toCardModel(
  row: CreativeRow | ConceptGroupRow,
  groupByConcept: boolean,
): CardModel {
  if (isConceptRow(row)) {
    return {
      thumbnail: row.representative_thumbnail,
      altText: row.display_name,
      headline: row.display_name,
      body: row.representative_body_preview,
      adCount: row.ad_count,
      adsetCount: row.adsets.length,
      campaignCount: row.campaigns.length,
      conceptMultiplier:
        groupByConcept && row.creative_id_count > 1 ? row.creative_id_count : null,
      spend: row.spend,
      ctr: row.ctr,
      cpr: row.cpr,
      frequency: row.frequency,
      representativeAdId: row.representative_ad_id,
    };
  }
  // Same waterfall as rowToSyntheticGroup / the modal so the
  // un-grouped card title reads like the modal it opens — and never
  // surfaces "{{product.name}}…" feed-template noise.
  const display = pickDisplayName(
    row.ad_names,
    row.creative_name,
    "creative_id",
    `c:${row.creative_id}`,
    0,
  );
  return {
    thumbnail: row.thumbnail_url,
    altText: display,
    headline: display,
    body: row.body,
    adCount: row.ad_count,
    adsetCount: row.adsets.length,
    campaignCount: row.campaigns.length,
    conceptMultiplier: null,
    spend: row.spend,
    ctr: row.ctr,
    cpr: row.cpr,
    frequency: row.frequency,
    representativeAdId: row.representative_ad_id,
  };
}

function CreativeCard({
  row,
  onClick,
}: {
  row: CardModel;
  onClick: () => void;
}) {
  // Card is the primary affordance — clicking anywhere opens the
  // preview modal. Rendered as a real <button> (not a div with
  // onClick) so keyboard users get focus / Enter / Space for free.
  // The Ads Manager deep link moved into the modal footer to avoid
  // a nested <a> inside the button.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="View full creative"
      className="group flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4 text-left transition hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <Thumbnail url={row.thumbnail} alt={row.altText} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="line-clamp-1 text-sm font-medium text-foreground">
              {row.headline ?? "(no headline)"}
            </div>
            {row.conceptMultiplier && (
              // Tiny "this concept was uploaded N times" indicator —
              // appears only in grouped mode and only when the bucket
              // collapses more than one creative_id.
              <Badge variant="primary" className="shrink-0">
                {row.conceptMultiplier}×
              </Badge>
            )}
          </div>
          <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {row.body ?? "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          <Layers className="mr-1 h-3 w-3" />
          {row.adCount} ad{row.adCount === 1 ? "" : "s"} ·{" "}
          {row.adsetCount} ad set{row.adsetCount === 1 ? "" : "s"}
        </Badge>
        {row.campaignCount > 1 && (
          <Badge variant="outline">{row.campaignCount} campaigns</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat label="Spend" value={fmtCurrency(row.spend)} prominent />
        <Stat label="CTR" value={fmtPct(row.ctr)} />
        <Stat label="CPR" value={fmtMoneyOrDash(row.cpr)} />
        <Stat label="Frequency" value={fmtFreq(row.frequency)} />
      </div>

      <div className="mt-auto pt-1 text-xs font-medium text-primary opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        Click to preview →
      </div>
    </button>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return <NoPreviewThumbnailCard />;
  }
  return (
    // Plain <img> instead of next/image because Meta's CDN URLs are
    // signed and short-lived — the next/image loader can't cache or
    // optimise them, and configuring a remotePatterns entry per
    // edge subdomain isn't worth the maintenance burden.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      width={64}
      height={64}
      className="h-16 w-16 flex-none rounded border border-border object-cover"
      loading="lazy"
    />
  );
}

function Stat({
  label,
  value,
  prominent = false,
}: {
  label: string;
  value: string;
  prominent?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={
          prominent
            ? "text-base font-semibold text-foreground"
            : "text-sm text-foreground"
        }
      >
        {value}
      </div>
    </div>
  );
}

function ErrorBox({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertTriangle className="h-4 w-4 text-destructive" />
        {title}
      </div>
      <p className="mb-3 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

function EmptyBox({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-6 text-center">
      <div className="mb-1 text-sm font-medium text-foreground">{title}</div>
      <p className="mb-3 text-sm text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
