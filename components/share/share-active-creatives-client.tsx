"use client";

import { useState } from "react";
import { ImageOff, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { fmtCurrency } from "@/lib/dashboard/format";
import type { ConceptGroupRow } from "@/lib/reporting/group-creatives";
import ShareCreativePreviewModal from "@/components/share/share-creative-preview-modal";

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
}

export default function ShareActiveCreativesClient({ groups }: Props) {
  const [openGroup, setOpenGroup] = useState<ConceptGroupRow | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <ShareCreativeCard
            key={g.group_key}
            row={g}
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
  onClick,
}: {
  row: ConceptGroupRow;
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
