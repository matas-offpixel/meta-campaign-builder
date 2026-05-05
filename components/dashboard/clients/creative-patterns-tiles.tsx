"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, ImageIcon, X } from "lucide-react";

import type {
  ConceptThumb,
  CreativePatternPhase,
  TileRow,
} from "@/lib/reporting/creative-patterns-cross-event";
import {
  barColorClass,
  funnelMiniStatDefs,
  quartileBadge,
  quartileStripeClass,
  type CreativePatternFunnel,
  type PatternFormatters,
} from "@/lib/dashboard/creative-patterns-funnel-view";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const GBP2 = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-GB");

const FMT: PatternFormatters = {
  money0: GBP,
  money2: GBP2,
  num: NUM,
};

export function PatternSummaryTile({
  row,
  phase,
  funnel,
  spotlight,
  primaryQuartile,
  metricPerf,
}: {
  row: TileRow;
  phase: CreativePatternPhase;
  funnel: CreativePatternFunnel;
  spotlight?: "gold" | "silver" | "bronze";
  primaryQuartile: 1 | 2 | 3 | 4;
  metricPerf: Record<string, { ratio: number; quartile: 1 | 2 | 3 | 4 }>;
}) {
  const [openCreative, setOpenCreative] = useState<ConceptThumb | null>(null);
  const defs = funnelMiniStatDefs(funnel, phase);
  const stripe = quartileStripeClass(primaryQuartile);
  const badge = quartileBadge(primaryQuartile);
  const spotlightRing =
    spotlight === "gold"
      ? "ring-2 ring-amber-400 shadow-md shadow-amber-400/20"
      : spotlight === "silver"
        ? "ring-2 ring-slate-300 shadow-md"
        : spotlight === "bronze"
          ? "ring-2 ring-amber-800/70 shadow-md"
          : "";

  return (
    <article
      className={`rounded-lg border-y border-r border-border bg-card p-4 shadow-sm ${stripe} border-l-4 ${spotlightRing} ${spotlight ? "lg:p-5" : ""}`}
    >
      <CreativePreviewStrip
        row={row}
        onOpen={setOpenCreative}
        tall={Boolean(spotlight)}
      />

      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-heading text-lg tracking-wide">{row.value_label}</h4>
            {spotlight === "gold" ? (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                Top performer
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {NUM.format(row.event_count)} events · {NUM.format(row.ad_count)} ads
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            <span className="mr-1">{badge.emoji}</span>
            {badge.label}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
          {row.value_key}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        {defs.map((def) => {
          const raw = def.pick(row, phase);
          const perf = metricPerf[def.key] ?? { ratio: 0, quartile: 4 as const };
          const display =
            raw == null || !Number.isFinite(raw)
              ? "—"
              : def.format(raw, phase, FMT);
          return (
            <MiniStatWithBar
              key={def.key}
              label={def.label}
              value={display}
              ratio={perf.ratio}
              quartile={perf.quartile}
            />
          );
        })}
      </div>

      {openCreative ? (
        <CreativePreviewModal
          creative={openCreative}
          onClose={() => setOpenCreative(null)}
        />
      ) : null}
    </article>
  );
}

function MiniStatWithBar({
  label,
  value,
  ratio,
  quartile,
}: {
  label: string;
  value: string;
  ratio: number;
  quartile: 1 | 2 | 3 | 4;
}) {
  const widthPct = Math.round(Math.min(100, Math.max(0, ratio * 100)));
  const barColor = barColorClass(quartile);

  return (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-[width] ${barColor}`}
          style={{ width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}

function CreativePreviewStrip({
  row,
  onOpen,
  tall,
}: {
  row: TileRow;
  onOpen: (creative: ConceptThumb) => void;
  tall: boolean;
}) {
  const previews = row.top_creatives.filter((creative) => creative.thumbnail_url);
  const heightClass = tall ? "h-32" : "h-24";

  if (previews.length === 0) {
    return (
      <div
        className={`flex ${heightClass} items-center justify-center rounded-md border border-dashed border-border bg-muted/50 text-xs font-medium text-muted-foreground`}
      >
        <ImageIcon className="mr-2 h-4 w-4" />
        No preview available
      </div>
    );
  }

  return (
    <div className={`grid ${heightClass} grid-cols-3 gap-2`}>
      {previews.map((creative) => (
        <button
          key={`${creative.event_id}:${creative.ad_id}:${creative.creative_name}`}
          type="button"
          onClick={() => onOpen(creative)}
          className="group relative overflow-hidden rounded-md border border-border bg-muted text-left transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          title={`Preview ${creative.creative_name}`}
        >
          <CreativeImage
            src={creative.thumbnail_url}
            alt={creative.creative_name}
            className="h-full w-full object-cover transition group-hover:scale-105"
          />
          <span className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 text-[10px] font-medium text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
            View creative
          </span>
        </button>
      ))}
    </div>
  );
}

function CreativePreviewModal({
  creative,
  onClose,
}: {
  creative: ConceptThumb;
  onClose: () => void;
}) {
  const imageUrl = creative.preview_image_url ?? creative.thumbnail_url;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Creative preview"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Close creative preview"
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-background shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="line-clamp-2 font-heading text-lg tracking-wide">
              {creative.creative_name}
            </h2>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {creative.event_name ?? "Unknown event"}
              {creative.event_code ? ` · ${creative.event_code}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.65fr)]">
          <div className="overflow-hidden rounded-lg border border-border bg-muted">
            {imageUrl ? (
              <CreativeImage
                src={imageUrl}
                alt={creative.creative_name}
                className="max-h-[64vh] w-full object-contain"
              />
            ) : (
              <div className="flex aspect-[4/3] items-center justify-center text-sm text-muted-foreground">
                No preview available
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <MiniKpi label="Spend" value={formatMoney(creative.spend)} />
              <MiniKpi
                label="CPM"
                value={creative.cpm == null ? "—" : GBP2.format(creative.cpm)}
              />
              <MiniKpi
                label="CTR"
                value={creative.ctr == null ? "—" : `${creative.ctr.toFixed(2)}%`}
              />
              <MiniKpi
                label="CPA"
                value={creative.cpa == null ? "—" : GBP2.format(creative.cpa)}
              />
            </div>

            <InfoBlock label="Linked event">
              {creative.event_name ?? "Unknown event"}
              {creative.event_code ? ` (${creative.event_code})` : ""}
            </InfoBlock>

            <InfoBlock label="Active date range">
              {formatDateRange(creative.active_since, creative.active_until)}
            </InfoBlock>

            <InfoBlock label="Tagged under">
              <div className="flex flex-wrap gap-1.5">
                {creative.tags.map((tag) => (
                  <span
                    key={`${tag.dimension}:${tag.value_key}`}
                    className="rounded-full bg-muted px-2 py-1 text-[11px] text-foreground"
                  >
                    {tag.value_label}
                  </span>
                ))}
              </div>
            </InfoBlock>

            <InfoBlock label="Ad names">
              {creative.ad_names.length > 0
                ? creative.ad_names.slice(0, 3).join(", ")
                : creative.creative_name}
              {creative.ad_names.length > 3
                ? ` +${creative.ad_names.length - 3} more`
                : ""}
            </InfoBlock>

            <InfoBlock label="Meta ad ID">{creative.ad_id}</InfoBlock>

            {creative.preview_permalink_url ? (
              <a
                href={creative.preview_permalink_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Open post
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function CreativeImage({
  src,
  alt,
  className,
}: {
  src: string | null;
  alt: string;
  className: string;
}) {
  if (!src) return null;
  return (
    // Meta CDN URLs are signed/short-lived, so use a plain image rather
    // than routing them through Next image optimisation.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} loading="lazy" />
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium tabular-nums">{value}</p>
    </div>
  );
}

function formatMoney(value: number): string {
  return GBP.format(value);
}

function formatDateRange(since: string, until: string): string {
  return `${formatDate(since)} to ${formatDate(until)}`;
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
