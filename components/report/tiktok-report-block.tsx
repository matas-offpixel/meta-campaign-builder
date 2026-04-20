"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  TikTokAdRow,
  TikTokDemographicRow,
  TikTokGeoRow,
  TikTokInterestRow,
  TikTokManualReportSnapshot,
  TikTokVertical,
} from "@/lib/types/tiktok";

/**
 * components/report/tiktok-report-block.tsx
 *
 * Single source of truth for the TikTok manual-report rendering. Imported
 * by both the internal dashboard tab (`tiktok-report-tab.tsx#ReportView`)
 * and the public share page (`event-report-view.tsx`) so the two surfaces
 * cannot drift visually — only one place to update column ordering, sort
 * keys, breakdown caveats, and format rules.
 *
 * Read-only by design: no import dropzone, no account linker, no fetch /
 * mutation handlers. The block only knows how to render a snapshot it was
 * handed.
 */

export interface TikTokReportBlockData {
  id: string;
  campaign_name: string;
  date_range_start: string;
  date_range_end: string;
  imported_at: string;
  snapshot: TikTokManualReportSnapshot;
}

export function TikTokReportBlock({ data }: { data: TikTokReportBlockData }) {
  const { snapshot } = data;
  const c = snapshot.campaign;
  const currency = c?.currency ?? "GBP";

  // Three rows tuned for brand + event campaigns. Destination metrics are
  // demoted (most brand campaigns route to a TikTok in-app destination, so
  // dest clicks + CPC are zero or vanishing); Clicks (all) / CTR (all) /
  // Frequency / CP1KR / watch-depth metrics are what actually move.
  const row1 = [
    {
      label: "Impressions",
      value: fmtInt(c?.impressions ?? null, c?.impressions_raw ?? null),
    },
    { label: "Reach", value: fmtInt(c?.reach ?? null) },
    { label: "Spend", value: fmtMoney(c?.cost ?? null, currency) },
    { label: "Frequency", value: fmtFrequency(c?.frequency ?? null) },
  ];
  const row2 = [
    { label: "Clicks (all)", value: fmtInt(c?.clicks_all ?? null) },
    { label: "CTR (all)", value: fmtPct(c?.ctr_all ?? null) },
    { label: "CPM", value: fmtMoney(c?.cpm ?? null, currency) },
    {
      label: "Cost per 1000 reached",
      value: fmtMoney(c?.cost_per_1000_reached ?? null, currency),
    },
  ];
  const row3 = [
    { label: "Video views (2s)", value: fmtInt(c?.video_views_2s ?? null) },
    { label: "Video views (6s)", value: fmtInt(c?.video_views_6s ?? null) },
    { label: "Video views (100%)", value: fmtInt(c?.video_views_p100 ?? null) },
    {
      label: "Avg play time / user",
      value: fmtSeconds(c?.avg_play_time_per_user ?? null),
    },
  ];

  const destClicks = c?.clicks_destination ?? null;
  const destCpc = c?.cpc_destination ?? null;
  const destCtr = c?.ctr_destination ?? null;
  const destCaveat =
    destClicks === 0
      ? "Destination clicks: 0 — campaign had no landing page configured."
      : destClicks != null
        ? `Destination clicks: ${fmtInt(destClicks)} · CPC ${fmtMoney(
            destCpc,
            currency,
          )} · CTR ${fmtPct(destCtr)}`
        : null;

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-heading text-sm tracking-wide">
              {data.campaign_name}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fmtDate(data.date_range_start)} —{" "}
              {fmtDate(data.date_range_end)} · imported{" "}
              {fmtRelative(data.imported_at)}
            </p>
          </div>
          {c?.primary_status && <StatusBadge status={c.primary_status} />}
        </div>
      </section>

      <div className="space-y-3">
        <StatGrid cards={row1} />
        <StatGrid cards={row2} />
        <StatGrid cards={row3} />
        {destCaveat && (
          <p className="px-1 text-[11px] text-muted-foreground">{destCaveat}</p>
        )}
      </div>

      {snapshot.ads.length > 0 && (
        <BreakdownSection title="Ads" defaultOpen>
          <AdsTable rows={snapshot.ads} currency={currency} />
        </BreakdownSection>
      )}

      <BreakdownSection title="Top regions" defaultOpen>
        <GeoTable rows={snapshot.geo} currency={currency} />
      </BreakdownSection>

      <BreakdownSection title="Demographics">
        <DemographicTable rows={snapshot.demographics} currency={currency} />
      </BreakdownSection>

      <BreakdownSection title="Top audiences that engaged">
        <InterestRankedTable rows={snapshot.interests} />
      </BreakdownSection>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal layout primitives
// ─────────────────────────────────────────────────────────────────────────────

function StatGrid({ cards }: { cards: { label: string; value: string }[] }) {
  return (
    <section
      className="grid grid-cols-2 gap-3 md:grid-cols-4"
      aria-label="TikTok campaign stats"
    >
      {cards.map((card) => (
        <StatCard key={card.label} label={card.label} value={card.value} />
      ))}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant: "success" | "warning" | "default" = (() => {
    const s = status.toLowerCase();
    if (s.includes("not delivering")) return "warning";
    if (s.includes("active")) return "success";
    return "default";
  })();
  return (
    <Badge variant={variant} className="text-[10px] uppercase tracking-wider">
      {status}
    </Badge>
  );
}

function BreakdownSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-md border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left"
        onClick={() => setOpen((s) => !s)}
      >
        <h3 className="font-heading text-sm tracking-wide">{title}</h3>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && <div className="border-t border-border px-5 py-4">{children}</div>}
    </section>
  );
}

function AdsTable({
  rows,
  currency,
}: {
  rows: TikTokAdRow[];
  currency: string;
}) {
  const sorted = [...rows].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-2">Ad</th>
            <th className="pb-2">Status</th>
            <th className="pb-2 text-right">Spend</th>
            <th className="pb-2 text-right">Impr.</th>
            <th className="pb-2 text-right">Reach</th>
            <th className="pb-2 text-right">Clicks (all)</th>
            <th className="pb-2 text-right">CTR (all)</th>
            <th className="pb-2 text-right">2s views</th>
            <th className="pb-2 text-right">100% views</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr
              key={`${r.ad_name}-${i}`}
              className="border-t border-border/40 text-foreground"
            >
              <td className="py-1.5 pr-3">{r.ad_name}</td>
              <td className="py-1.5 pr-3">
                <StatusBadge status={r.primary_status} />
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtMoney(r.cost, currency)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtInt(r.impressions, r.impressions_raw)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtInt(r.reach)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtInt(r.clicks_all)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtPct(r.ctr_all)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtInt(r.video_views_2s)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtInt(r.video_views_p100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GeoTable({
  rows,
  currency,
}: {
  rows: TikTokGeoRow[];
  currency: string;
}) {
  if (rows.length === 0)
    return <EmptyBreakdown label="No geo rows in snapshot." />;
  const top = [...rows]
    .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))
    .slice(0, 10);
  return (
    <BreakdownTable
      headers={["Region", "Type", "Spend", "Impr.", "Clicks", "CTR"]}
      rows={top.map((r) => [
        r.region_name,
        r.region_type,
        fmtMoney(r.cost, currency),
        fmtInt(r.impressions, r.impressions_raw),
        fmtInt(r.clicks_destination),
        fmtPct(r.ctr_destination),
      ])}
    />
  );
}

function DemographicTable({
  rows,
  currency,
}: {
  rows: TikTokDemographicRow[];
  currency: string;
}) {
  if (rows.length === 0)
    return <EmptyBreakdown label="No demographic rows in snapshot." />;
  const sorted = [...rows].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
  return (
    <BreakdownTable
      headers={["Age", "Gender", "Spend", "Impr.", "Clicks", "CTR"]}
      rows={sorted.map((r) => [
        r.age_bucket,
        r.gender,
        fmtMoney(r.cost, currency),
        fmtInt(r.impressions, r.impressions_raw),
        fmtInt(r.clicks_destination),
        fmtPct(r.ctr_destination),
      ])}
    />
  );
}

/**
 * Flat ranked interest table sorted by 2-second views desc.
 *
 * TikTok auto-distributes spend nearly evenly across linked interests, so
 * spend / reach / clicks columns produce a meaningless near-flat list.
 * Watch depth (2s plays + avg play time per video view) is the only signal
 * that actually separates audiences here — vertical is demoted to a chip
 * for grouping context without dictating the ranking.
 */
function InterestRankedTable({ rows }: { rows: TikTokInterestRow[] }) {
  if (rows.length === 0)
    return <EmptyBreakdown label="No interest rows in snapshot." />;
  const top = [...rows]
    .sort((a, b) => (b.video_views_2s ?? 0) - (a.video_views_2s ?? 0))
    .slice(0, 15);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted-foreground">
        These are the interest audiences TikTok&apos;s algorithm attributed
        engagement to — not the interests we targeted. Ranked by watch
        depth (2-second video plays).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2">Audience</th>
              <th className="pb-2 text-right">Video plays (2s)</th>
              <th className="pb-2 text-right">Avg play time / view</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r, i) => (
              <tr
                key={`${r.audience_label}-${i}`}
                className="border-t border-border/40 text-foreground"
              >
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-2">
                    <span>{r.audience_label}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      {labelForVertical(r.vertical ?? "other")}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {fmtInt(r.video_views_2s)}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {fmtSeconds(r.avg_play_time_per_video_view)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BreakdownTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            {headers.map((h, i) => (
              <th key={h} className={`pb-2 ${i === 0 ? "" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-t border-border/40 text-foreground"
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 tabular-nums ${ci === 0 ? "" : "text-right"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyBreakdown({ label }: { label: string }) {
  return <p className="text-xs text-muted-foreground">{label}</p>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtInt(n: number | null, raw?: string | null): string {
  if (raw) return raw; // preserve TikTok's "<5" mask verbatim
  if (n == null) return "—";
  return Math.round(n).toLocaleString();
}

function fmtMoney(n: number | null, currency: string): string {
  if (n == null) return "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return n.toLocaleString();
  }
}

function fmtPct(n: number | null): string {
  // TikTok exports already encode percentages on the display scale
  // (e.g. "1.23%" → 1.23), so we just append "%".
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtFrequency(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

function fmtSeconds(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}s`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

const VERTICAL_LABELS: Record<TikTokVertical | "other", string> = {
  music_entertainment: "Music & entertainment",
  games: "Games",
  lifestyle: "Lifestyle",
  food_drink: "Food & drink",
  beauty_fashion: "Beauty & fashion",
  travel: "Travel",
  shopping_commerce: "Shopping",
  tech: "Tech",
  sports_fitness: "Sports & fitness",
  other: "Other",
};

function labelForVertical(value: string): string {
  if (value in VERTICAL_LABELS) {
    return VERTICAL_LABELS[value as keyof typeof VERTICAL_LABELS];
  }
  return value;
}
