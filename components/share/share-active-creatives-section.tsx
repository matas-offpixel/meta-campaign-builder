import { ImageOff, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/dashboard/format";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives-by-name";
import type { ShareActiveCreativesResult } from "@/lib/reporting/share-active-creatives";

/**
 * components/share/share-active-creatives-section.tsx
 *
 * Server-rendered "Active creatives" section for the public share
 * report. Same card layout as the internal panel's grouped mode,
 * minus the bits that don't make sense in a client-facing PDF-y
 * surface:
 *   - No "Open in Ads Manager" link (internal-only).
 *   - No Refresh button (server-rendered + cached for 5 min by the
 *     enclosing share page).
 *   - No sort dropdown (fixed: spend DESC, the default users
 *     would land on anyway).
 *
 * Failure handling lives in the parent share page — this component
 * only ever renders when the fetch returned `kind: "ok"`. The
 * `error` / `skip` branches are handled by the page itself so a
 * Meta hiccup downgrades to a muted note instead of bubbling up.
 */

interface Props {
  result: ShareActiveCreativesResult;
}

export function ShareActiveCreativesSection({ result }: Props) {
  if (result.kind === "skip") {
    // No section at all — the event simply isn't running anything.
    // Different from `error`, where we want the muted note so the
    // viewer knows there should be data but Meta wasn't reachable.
    return null;
  }

  if (result.kind === "error") {
    return (
      <section className="space-y-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <p className="text-sm text-muted-foreground">
          Creative breakdown unavailable at the moment.
        </p>
      </section>
    );
  }

  const { groups, meta } = result;
  if (groups.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-heading text-base tracking-wide text-foreground">
          Active creatives
        </h2>
        <span className="text-xs text-muted-foreground">
          {groups.length} concept{groups.length === 1 ? "" : "s"} ·{" "}
          {meta.ads_fetched} ad{meta.ads_fetched === 1 ? "" : "s"} across{" "}
          {meta.campaigns_total} campaign
          {meta.campaigns_total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <ShareCreativeCard key={g.group_key} row={g} />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Spend, registrations and reach are summed across the underlying
        ads in each creative concept. Rate metrics (CTR, CPR, frequency)
        are recomputed from the summed totals — not averaged across ads
        — to avoid the usual ratio-of-rates inflation. Reach is summed
        across ads and may over-count audiences that overlap.
      </p>
    </section>
  );
}

function ShareCreativeCard({ row }: { row: ConceptGroupRow }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
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

      <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <Stat label="Spend" value={fmtCurrency(row.spend)} prominent />
        <Stat label="CTR" value={fmtPct(row.ctr)} />
        <Stat label="CPR" value={fmtMoneyOrDash(row.cpr)} />
        <Stat label="Frequency" value={fmtFreq(row.frequency)} />
      </div>
    </div>
  );
}

function Thumbnail({ url, alt }: { url: string | null; alt: string }) {
  if (!url) {
    return (
      <div className="flex h-16 w-16 flex-none items-center justify-center rounded border border-border bg-muted text-muted-foreground">
        <ImageOff className="h-5 w-5" />
      </div>
    );
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
