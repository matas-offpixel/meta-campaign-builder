export interface GoogleAdsReportBlockData {
  sourceLabel: string;
  totals: {
    spend: number;
    impressions: number;
    videoViews: number;
    clicks: number;
    reach: number | null;
    frequency: number | null;
    costPerView: number | null;
  };
}

export function GoogleAdsReportBlock({ data }: { data: GoogleAdsReportBlockData }) {
  const cards = [
    ["Impressions", fmtInt(data.totals.impressions)],
    ["Engagements", fmtInt(data.totals.videoViews)],
    ["Spend", fmtMoney(data.totals.spend)],
    ["CPE", fmtMoney(data.totals.costPerView)],
    ["Reach", data.totals.reach == null ? "—" : fmtInt(data.totals.reach)],
    ["Frequency", data.totals.frequency == null ? "—" : data.totals.frequency.toFixed(2)],
  ];
  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border bg-card p-5">
        <h3 className="font-heading text-sm tracking-wide">Google Ads</h3>
        <p className="mt-1 text-xs text-muted-foreground">{data.sourceLabel}</p>
      </section>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Google Ads campaign stats">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">{value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

const GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
const fmtMoney = (value: number | null) => (value == null ? "—" : GBP.format(value));
const fmtInt = (value: number) => Math.round(value).toLocaleString("en-GB");
