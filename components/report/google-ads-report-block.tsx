import type { CampaignInsightsRow } from "@/lib/reporting/event-insights";

export interface GoogleAdsReportBlockData {
  sourceLabel: string;
  totals: {
    spend: number;
    impressions: number;
    clicks: number;
    engagements: number;
    reach: number | null;
    frequency: number | null;
    cpm: number | null;
    ctr: number | null;
    costPerEngagement: number | null;
    costPer1000Reached: number | null;
    videoViews25: number | null;
    videoViews50: number | null;
    videoViews75: number | null;
    videoViews100: number | null;
  };
  campaigns: CampaignInsightsRow[];
}

export function GoogleAdsReportBlock({ data }: { data: GoogleAdsReportBlockData }) {
  const t = data.totals;
  const hasVideo = data.campaigns.some((c) => c.campaign_type?.includes("VIDEO"));
  const row1 = [
    { label: "Impressions", value: fmtInt(t.impressions) },
    { label: "Reach", value: fmtNullableInt(t.reach) },
    { label: "Spend", value: fmtMoney(t.spend) },
    { label: "Frequency", value: fmtFrequency(t.frequency) },
  ];
  const row2 = [
    { label: "Clicks (all)", value: fmtInt(t.clicks) },
    { label: "CTR (all)", value: fmtPct(t.ctr) },
    { label: "CPM", value: fmtMoney(t.cpm) },
    { label: "Cost per 1000 reached", value: fmtMoney(t.costPer1000Reached) },
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
        {t.engagements > 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            Engagements: {fmtInt(t.engagements)} · CPE {fmtMoney(t.costPerEngagement)}
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

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const fmtMoney = (value: number | null) => (value == null ? "—" : GBP.format(value));
const fmtInt = (value: number) => Math.round(value).toLocaleString("en-GB");
const fmtNullableInt = (value: number | null) => (value == null ? "—" : fmtInt(value));
const fmtFrequency = (value: number | null) => (value == null ? "—" : value.toFixed(2));
const fmtPct = (value: number | null) => (value == null ? "—" : `${value.toFixed(2)}%`);
