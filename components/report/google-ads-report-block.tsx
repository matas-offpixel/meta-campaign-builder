"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

import type {
  GoogleAdsBreakdownRow,
  GoogleAdsCreativeRow,
  GoogleAdsReportBlockData,
} from "@/lib/reporting/google-ads-share-types";
import type { CampaignInsightsRow } from "@/lib/reporting/event-insights";
export type { GoogleAdsReportBlockData };

export function GoogleAdsReportBlock({ data }: { data: GoogleAdsReportBlockData }) {
  const t = data.totals;
  const hasVideo = data.campaigns.some((c) => c.campaign_type?.includes("VIDEO"));
  const row1 = [
    { label: "Impressions", value: fmtInt(t.impressions) },
    { label: "Spend", value: fmtMoney(t.spend) },
    { label: "Clicks (all)", value: fmtInt(t.clicks) },
    { label: "CTR (all)", value: fmtPct(t.ctr) },
  ];
  const row2 = [
    { label: "Engagements", value: fmtInt(t.engagements) },
    { label: "Avg CPC", value: fmtMoney(t.averageCpc) },
    { label: "Cost per video view", value: fmtMoney(t.costPerVideoView) },
    { label: "View-through rate", value: fmtPct(t.viewThroughRate) },
  ];
  const row3 = [
    { label: "Video views (25%)", value: fmtNullableInt(t.videoViews25) },
    { label: "Video views (50%)", value: fmtNullableInt(t.videoViews50) },
    { label: "Video views (75%)", value: fmtNullableInt(t.videoViews75) },
    { label: "Video views (100%)", value: fmtNullableInt(t.videoViews100) },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-md border border-border bg-card p-5">
        <h3 className="font-heading text-sm tracking-wide">Google Ads</h3>
        <p className="mt-1 text-xs text-muted-foreground">{data.sourceLabel}</p>
      </section>
      <div className="space-y-3">
        <StatGrid cards={row1} />
        <StatGrid cards={row2} />
        {hasVideo ? <StatGrid cards={row3} /> : null}
        {t.cpm != null || t.costPerEngagement != null ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            CPM {fmtMoney(t.cpm)} · CPE {fmtMoney(t.costPerEngagement)}
          </p>
        ) : null}
      </div>
      <details open className="rounded-md border border-border bg-card">
        <summary className="cursor-pointer px-5 py-3 font-heading text-sm tracking-wide">
          Top campaigns
        </summary>
        <div className="border-t border-border px-5 py-4">
          <CampaignTable rows={data.campaigns} />
        </div>
      </details>
      {data.creatives?.length ? (
        <BreakdownSection title="Active creatives" defaultOpen>
          <CreativeCards rows={data.creatives} />
        </BreakdownSection>
      ) : null}
      <BreakdownSection title="Top regions" defaultOpen>
        <BreakdownTable rows={data.demographics?.regions ?? []} />
      </BreakdownSection>
      <BreakdownSection title="Demographics — Age" defaultOpen>
        <BreakdownTable rows={data.demographics?.ageRanges ?? []} />
      </BreakdownSection>
      <BreakdownSection title="Demographics — Gender" defaultOpen>
        <BreakdownTable rows={data.demographics?.genders ?? []} />
      </BreakdownSection>
    </div>
  );
}

function StatGrid({ cards }: { cards: { label: string; value: string }[] }) {
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Google Ads campaign stats">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border border-border bg-card p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{card.label}</p>
          <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">{card.value}</p>
        </div>
      ))}
    </section>
  );
}

function CampaignTable({ rows }: { rows: CampaignInsightsRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No Google Ads campaigns matched.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-2">Campaign</th>
            <th className="pb-2 text-right">Spend</th>
            <th className="pb-2 text-right">Impr.</th>
            <th className="pb-2 text-right">Eng.</th>
            <th className="pb-2 text-right">CTR</th>
            <th className="pb-2 text-right">CPE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border/40 text-foreground">
              <td className="py-1.5 pr-3">{r.name}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.spend)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(r.impressions)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(r.video_views ?? r.results)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtPct(r.ctr)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(r.cost_per_view ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

function CreativeCards({ rows }: { rows: GoogleAdsCreativeRow[] }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <a
          key={row.id}
          href={row.youtubeUrl ?? `https://ads.google.com/aw/campaigns?campaignId=${row.campaignId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex gap-4 rounded-md border border-border bg-background p-3 transition hover:border-foreground/30"
        >
          <div className="flex h-[120px] w-[120px] shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-2xl">
            {row.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span aria-hidden>▶</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-heading text-sm tracking-wide">
              <span className="truncate">{row.name || row.campaignName}</span>
              <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{row.campaignName}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <MiniStat label="Spend" value={fmtMoney(row.spend)} />
              <MiniStat label="Impr." value={fmtInt(row.impressions)} />
              <MiniStat label="Clicks" value={fmtInt(row.clicks)} />
              <MiniStat label="CTR" value={fmtPct(row.ctr)} />
              <MiniStat label="Video views" value={fmtNullableInt(row.videoViews)} />
              <MiniStat label="Engagements" value={fmtInt(row.engagements)} />
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function BreakdownTable({ rows }: { rows: GoogleAdsBreakdownRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows available.</p>;
  const top = rows.slice(0, 10);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="pb-2">Segment</th>
            <th className="pb-2 text-right">Spend</th>
            <th className="pb-2 text-right">Impr.</th>
            <th className="pb-2 text-right">Clicks</th>
            <th className="pb-2 text-right">CTR</th>
          </tr>
        </thead>
        <tbody>
          {top.map((row) => (
            <tr key={row.label} className="border-t border-border/40 text-foreground">
              <td className="py-1.5 pr-3">{row.label}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtMoney(row.spend)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(row.impressions)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(row.clicks)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtPct(row.impressions > 0 ? (row.clicks / row.impressions) * 100 : null)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const fmtMoney = (value: number | null) => (value == null ? "—" : GBP.format(value));
const fmtInt = (value: number) => Math.round(value).toLocaleString("en-GB");
const fmtNullableInt = (value: number | null) => (value == null ? "—" : fmtInt(value));
const fmtPct = (value: number | null) => (value == null ? "—" : `${value.toFixed(2)}%`);
