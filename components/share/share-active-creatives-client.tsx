"use client";

import { useState } from "react";
import { Layers } from "lucide-react";

import { NoPreviewThumbnailCard } from "@/components/report/no-preview-placeholder";

import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/dashboard/format";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import ShareCreativePreviewModal from "@/components/share/share-creative-preview-modal";
import { HealthBadge } from "@/components/share/health-badge";

/**
 * components/share/share-active-creatives-client.tsx
 *
 * Client island that owns the click-to-expand modal state for the
 * public share report's "Active creatives" grid. The enclosing
 * `ShareActiveCreativesSection` (server component) handles the
 * skip / error / empty branches and the section header / caveat,
 * then hands the resolved `groups` array down to this island for
 * card rendering + modal state.
 *
 * Card visuals match the original server-only version PR #39
 * shipped — same thumbnail, same metric strip, same "{N}× concept"
 * badge — but each card is now a `<button>` that opens the modal
 * instead of a static block. The Ads Manager link is intentionally
 * absent (share viewers don't have Meta seats).
 */

interface Props {
  groups: ConceptGroupRow[];
  kind?: "event" | "brand_campaign";
}

export default function ShareActiveCreativesClient({
  groups,
  kind = "event",
}: Props) {
  const [openGroup, setOpenGroup] = useState<ConceptGroupRow | null>(null);
  const isBrandCampaign = kind === "brand_campaign";

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <ShareCreativeCard
            key={g.group_key}
            row={g}
            isBrandCampaign={isBrandCampaign}
            onClick={() => setOpenGroup(g)}
          />
        ))}
      </div>

      {openGroup && (
        <ShareCreativePreviewModal
          group={openGroup}
          onClose={() => setOpenGroup(null)}
        />
      )}
    </>
  );
}

function ShareCreativeCard({
  row,
  isBrandCampaign,
  onClick,
}: {
  row: ConceptGroupRow;
  isBrandCampaign: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="View full creative"
      className="group flex h-full flex-col gap-3 rounded-md border border-border bg-card p-4 text-left transition hover:border-border-strong hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-3">
        <Thumbnail
          url={row.representative_thumbnail}
          alt={row.display_name}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="line-clamp-1 text-sm font-medium text-foreground">
              {row.display_name || "(no headline)"}
            </div>
            {row.creative_id_count > 1 && (
              // "This concept has N variations under the hood." A
              // single small badge keeps the card visually quiet
              // for the common single-creative case.
              <Badge variant="primary" className="shrink-0">
                {row.creative_id_count}×
              </Badge>
            )}
          </div>
          {row.representative_body_preview && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
              {row.representative_body_preview}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">
          <Layers className="mr-1 h-3 w-3" />
          {row.ad_count} ad{row.ad_count === 1 ? "" : "s"} ·{" "}
          {row.adsets.length} ad set{row.adsets.length === 1 ? "" : "s"}
        </Badge>
        {row.campaigns.length > 1 && (
          <Badge variant="outline">{row.campaigns.length} campaigns</Badge>
        )}
      </div>

      {/*
        Header strip: prominent Spend + fatigue pill on a single
        baseline. CTR drops out of the headline grid (still visible
        in the modal) because the user-facing question on a share
        card is "where is my money going + is the creative still
        fresh", not "how clicky is the impression".
      */}
      <div className="flex items-end justify-between gap-2">
        <Stat label="Spend" value={fmtCurrency(row.spend)} prominent />
        {/*
          PR #56 #4 — replaces the old purchase-CPA fatigue pill
          (which lit up CRITICAL on traffic ads with 0 purchases
          by design). Two-axis scoring (frequency × link CTR) is
          computed in the badge from row data already plumbed
          through both groupers; tooltip exposes the raw numbers
          and which threshold tripped.
        */}
        {!isBrandCampaign ? (
          <HealthBadge
            frequency={row.frequency}
            inlineLinkClicks={row.inline_link_clicks}
            impressions={row.impressions}
            anyAdActive={row.any_ad_active}
          />
        ) : null}
      </div>

      {/*
        Funnel stack: Clicks → LPV → Purchases, each row pairing
        the volume number (left, foreground colour) with its cost
        per (right, muted). Reads top-down as the user's funnel,
        which is more useful than the previous 2×2 metric grid for
        spotting where a creative leaks. CPR shows up as a
        horizontal pair on the Purchases row's lower line so we
        keep registration data without adding a fifth row.
      */}
      <div className="space-y-1.5 text-sm">
        {isBrandCampaign ? (
          <>
            <AwarenessRow label="Impressions" value={fmtInt(row.impressions)} />
            <AwarenessRow label="Reach" value={fmtInt(row.reach)} />
            <AwarenessRow label="CTR" value={fmtPct(row.ctr)} />
            <AwarenessRow label="CPM" value={fmtMoneyOrDash(row.cpm)} />
            <AwarenessRow label="Clicks" value={fmtInt(row.clicks)} />
          </>
        ) : (
          <>
            <FunnelRow
              label="Clicks"
              volume={fmtInt(row.clicks)}
              costLabel="CPC"
              cost={fmtMoneyOrDash(row.cpc)}
            />
            <FunnelRow
              label="LPV"
              volume={fmtInt(row.landingPageViews)}
              costLabel="CPLPV"
              cost={fmtMoneyOrDash(row.cplpv)}
            />
            <FunnelRow
              label="Purchases"
              volume={fmtInt(row.purchases)}
              costLabel="CPP"
              cost={fmtMoneyOrDash(row.cpp)}
            />
            {row.registrations > 0 && (
              <FunnelRow
                label="Regs"
                volume={fmtInt(row.registrations)}
                costLabel="CPR"
                cost={fmtMoneyOrDash(row.cpr)}
              />
            )}
          </>
        )}
      </div>

      <div className="mt-auto pt-1 text-xs font-medium text-primary opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        Click to preview →
      </div>
    </button>
  );
}

function AwarenessRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function FunnelRow({
  label,
  volume,
  costLabel,
  cost,
}: {
  label: string;
  volume: string;
  costLabel: string;
  cost: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-sm font-medium text-foreground">{volume}</span>
      </div>
      <div className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
        <span>{costLabel}</span>
        <span className="text-foreground">{cost}</span>
      </div>
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return <NoPreviewThumbnailCard />;
  }
  return (
    // Plain <img> for the same reason as the internal panel: Meta
    // CDN URLs are signed + short-lived and don't fit next/image's
    // remotePatterns model without per-edge maintenance.
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

function fmtMoneyOrDash(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtCurrency(v);
}

function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}
/**
 * Integer formatter for the funnel volume column. Locale-grouped
 * so 1 234 567 reads cleanly on a card. Returns "—" for null /
 * non-finite — same fallback as the cost cells so the row is
 * visually consistent when an action type isn't pixelled.
 */
function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.round(v).toLocaleString("en-GB");
}
