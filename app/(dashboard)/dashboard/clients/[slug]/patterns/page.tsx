import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { createClient } from "@/lib/supabase/server";
import type { ClientRow } from "@/lib/db/clients";
import {
  buildClientCreativePatterns,
  type ClientCreativePatternsResult,
  type ConceptThumb,
  type CreativePatternPhase,
  type TileRow,
} from "@/lib/reporting/creative-patterns-cross-event";
import type { CreativeTagDimension } from "@/lib/db/creative-tags";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ window?: string; phase?: string; funnel?: string }>;
}

const WINDOWS = [30, 90, 180] as const;
const PHASES = ["registration", "ticket_sale"] as const;
const FUNNELS = ["top", "mid", "bottom"] as const;

type FunnelView = (typeof FUNNELS)[number];

const DIMENSION_LABELS: Record<CreativeTagDimension, string> = {
  asset_type: "Asset Type",
  hook_tactic: "Hook Tactic",
  messaging_angle: "Messaging Theme",
  intended_audience: "Intended Audience",
  visual_format: "Visual Format",
  headline_tactic: "Headline Tactic",
  offer_type: "Offer Type",
  seasonality: "Seasonality",
};

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

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClientCreativePatternsPage({
  params,
  searchParams,
}: Props) {
  const { slug } = await params;
  const { window, phase: phaseParam, funnel: funnelParam } = await searchParams;
  const sinceDays = parseWindow(window);
  const phase = parsePhase(phaseParam);
  const funnel = parseFunnel(funnelParam);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await loadOwnedClient(slug, user.id);
  if (!client) notFound();

  const patterns = await buildClientCreativePatterns(client.id, {
    sinceDays,
    phase,
  });
  const dateRange = formatDateRange(
    patterns.summary.since,
    patterns.summary.until,
  );
  const hasTags = patterns.summary.tagAssignmentCount > 0;

  return (
    <>
      <PageHeader
        title={`Creative Patterns — ${client.name}`}
        description={`Cross-event intelligence across ${NUM.format(
          patterns.summary.taggedEventCount,
        )} events, ${formatMoney(patterns.summary.totalSpend)} spend, ${phaseLabel(
          phase,
        ).toLowerCase()} phase, ${funnelLabel(funnel).toLowerCase()} funnel view, ${dateRange}.`}
        actions={
          <Link
            href={`/clients/${client.id}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to client
          </Link>
        }
      />

      <main className="flex-1 px-6 py-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav
              aria-label="Breadcrumb"
              className="text-xs text-muted-foreground"
            >
              <Link href="/clients" className="hover:text-foreground">
                Clients
              </Link>
              <span className="mx-1">›</span>
              <Link
                href={`/clients/${client.id}`}
                className="hover:text-foreground"
              >
                {client.name}
              </Link>
              <span className="mx-1">›</span>
              <span className="text-foreground">Creative Patterns</span>
            </nav>
            <div className="flex flex-wrap items-center gap-2">
              <TimeframeToggle
                slug={client.slug ?? client.id}
                active={sinceDays}
                phase={phase}
                funnel={funnel}
              />
              <PhaseToggle
                slug={client.slug ?? client.id}
                windowDays={sinceDays}
                active={phase}
                funnel={funnel}
              />
              <FunnelToggle
                slug={client.slug ?? client.id}
                windowDays={sinceDays}
                phase={phase}
                active={funnel}
              />
            </div>
          </div>

          <SummaryStrip patterns={patterns} funnel={funnel} phase={phase} />

          {!hasTags ? (
            <EmptyState />
          ) : (
            <div className="space-y-8">
              {patterns.dimensions.map((dimension) => (
                <section key={dimension.dimension} className="space-y-3">
                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        Motion Taxonomy
                      </p>
                      <h2 className="font-heading text-xl tracking-wide">
                        {DIMENSION_LABELS[dimension.dimension]}
                      </h2>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {NUM.format(dimension.values.length)} tagged values
                    </p>
                  </div>
                  {dimension.values.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                      No tagged creatives for this dimension in the selected
                      window.
                    </div>
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                      {sortTilesForFunnel(dimension.values, funnel).map((row) => (
                        <PatternTile
                          key={row.value_key}
                          row={row}
                          funnel={funnel}
                          phase={phase}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

async function loadOwnedClient(
  slugOrId: string,
  userId: string,
): Promise<ClientRow | null> {
  const supabase = await createClient();
  const slugResult = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .eq("slug", slugOrId)
    .maybeSingle();

  if (slugResult.error) throw new Error(slugResult.error.message);
  if (slugResult.data) return slugResult.data as ClientRow;

  if (!isUuid(slugOrId)) return null;
  const idResult = await supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .eq("id", slugOrId)
    .maybeSingle();
  if (idResult.error) throw new Error(idResult.error.message);
  return (idResult.data as ClientRow | null) ?? null;
}

function SummaryStrip({
  patterns,
  funnel,
  phase,
}: {
  patterns: ClientCreativePatternsResult;
  funnel: FunnelView;
  phase: CreativePatternPhase;
}) {
  const best = bestDimensionForLens(patterns.dimensions, funnel, phase);
  return (
    <section className="grid gap-3 md:grid-cols-4">
      <KpiTile label="Total spend" value={formatMoney(patterns.summary.totalSpend)} />
      <KpiTile
        label="Events analyzed"
        value={NUM.format(patterns.summary.taggedEventCount)}
        sub={`${NUM.format(patterns.summary.eventCount)} client events`}
      />
      <KpiTile
        label="Ad concepts"
        value={NUM.format(patterns.summary.totalAdConcepts)}
        sub={`${NUM.format(patterns.summary.tagAssignmentCount)} tag rows`}
      />
      <KpiTile
        label={bestDimensionLabel(funnel, phase)}
        value={best ? DIMENSION_LABELS[best.dimension] : "—"}
        sub={best ? best.sub : "No eligible values"}
      />
    </section>
  );
}

function KpiTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-heading text-2xl tracking-wide text-foreground">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function TimeframeToggle({
  slug,
  active,
  phase,
  funnel,
}: {
  slug: string;
  active: number;
  phase: CreativePatternPhase;
  funnel: FunnelView;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1 text-xs">
      {WINDOWS.map((days) => (
        <Link
          key={days}
          href={patternsHref(slug, days, phase, funnel)}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            active === days
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Last {days}
        </Link>
      ))}
    </div>
  );
}

function PhaseToggle({
  slug,
  windowDays,
  active,
  funnel,
}: {
  slug: string;
  windowDays: number;
  active: CreativePatternPhase;
  funnel: FunnelView;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1 text-xs">
      {PHASES.map((phase) => (
        <Link
          key={phase}
          href={patternsHref(slug, windowDays, phase, funnel)}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            active === phase
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {phaseLabel(phase)}
        </Link>
      ))}
    </div>
  );
}

function FunnelToggle({
  slug,
  windowDays,
  phase,
  active,
}: {
  slug: string;
  windowDays: number;
  phase: CreativePatternPhase;
  active: FunnelView;
}) {
  return (
    <div className="inline-flex rounded-full border border-border bg-card p-1 text-xs">
      {FUNNELS.map((funnel) => (
        <Link
          key={funnel}
          href={patternsHref(slug, windowDays, phase, funnel)}
          className={`rounded-full px-3 py-1.5 transition-colors ${
            active === funnel
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {funnelLabel(funnel)}
        </Link>
      ))}
    </div>
  );
}

function PatternTile({
  row,
  funnel,
  phase,
}: {
  row: TileRow;
  funnel: FunnelView;
  phase: CreativePatternPhase;
}) {
  const stats = miniStatsForLens(row, funnel, phase);
  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg tracking-wide">
            {row.value_label}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {NUM.format(row.event_count)} events · {NUM.format(row.ad_count)} ads
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
          {row.value_key}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2 text-xs">
        {stats.map((stat) => (
          <MiniStat key={stat.label} label={stat.label} value={stat.value} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        {row.top_creatives.map((creative) => (
          <ConceptThumbCard key={`${creative.event_id}-${creative.creative_name}`} creative={creative} />
        ))}
      </div>
    </article>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ConceptThumbCard({ creative }: { creative: ConceptThumb }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-border bg-background">
      {creative.thumbnail_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={creative.thumbnail_url}
          alt=""
          className="aspect-square w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-square items-center justify-center bg-muted">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <div className="space-y-1 p-2">
        <p className="truncate text-[11px] font-medium" title={creative.creative_name}>
          {creative.creative_name}
        </p>
        <p className="truncate text-[10px] text-muted-foreground" title={creative.event_name ?? ""}>
          {creative.event_name ?? "Untitled event"}
        </p>
        <p className="text-[10px] tabular-nums text-muted-foreground">
          {formatMoney(creative.spend)}
        </p>
      </div>
    </div>
  );
}

function EmptyState() {
  const flag = process.env.ENABLE_AI_AUTOTAG === "1" ? "enabled" : "disabled";
  return (
    <section className="rounded-lg border border-dashed border-border bg-card p-8">
      <div className="flex max-w-3xl gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
          <Bot className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <h2 className="font-heading text-xl tracking-wide">
            No creative tags found for this client yet
          </h2>
          <p className="text-sm text-muted-foreground">
            Seed manual Motion assignments first, or run the AI auto-tagger from
            the active-creatives cron once the validation gate has passed.
            `ENABLE_AI_AUTOTAG` is currently {flag}.
          </p>
        </div>
      </div>
    </section>
  );
}

function parseWindow(value: string | undefined): number {
  const parsed = Number(value);
  return WINDOWS.includes(parsed as (typeof WINDOWS)[number]) ? parsed : 90;
}

function parsePhase(value: string | undefined): CreativePatternPhase {
  return PHASES.includes(value as CreativePatternPhase)
    ? (value as CreativePatternPhase)
    : "ticket_sale";
}

function parseFunnel(value: string | undefined): FunnelView {
  return FUNNELS.includes(value as FunnelView) ? (value as FunnelView) : "bottom";
}

function patternsHref(
  slug: string,
  windowDays: number,
  phase: CreativePatternPhase,
  funnel: FunnelView,
): string {
  const sp = new URLSearchParams({
    window: String(windowDays),
    phase,
    funnel,
  });
  return `/dashboard/clients/${slug}/patterns?${sp.toString()}`;
}

function phaseLabel(phase: CreativePatternPhase): string {
  return phase === "registration" ? "Registration" : "Ticket Sale";
}

function funnelLabel(funnel: FunnelView): string {
  if (funnel === "top") return "Top";
  if (funnel === "mid") return "Mid";
  return "Bottom";
}

function sortTilesForFunnel(tiles: TileRow[], funnel: FunnelView): TileRow[] {
  return [...tiles].sort((a, b) => {
    const primary = compareFunnelMetric(a, b, funnel);
    if (primary !== 0) return primary;
    return b.total_spend - a.total_spend;
  });
}

function compareFunnelMetric(
  a: TileRow,
  b: TileRow,
  funnel: FunnelView,
): number {
  return ascMetric(metricForSort(a, funnel), metricForSort(b, funnel));
}

function metricForSort(tile: TileRow, funnel: FunnelView): number | null {
  if (tile.total_spend <= 0) return null;
  if (funnel === "top") return tile.cpm;
  if (funnel === "mid") return tile.cpc;
  return tile.cpa;
}

function ascMetric(a: number | null, b: number | null): number {
  const aValid = a != null && Number.isFinite(a);
  const bValid = b != null && Number.isFinite(b);
  if (!aValid && !bValid) return 0;
  if (!aValid) return 1;
  if (!bValid) return -1;
  return a! - b!;
}

function miniStatsForLens(
  row: TileRow,
  funnel: FunnelView,
  phase: CreativePatternPhase,
): Array<{ label: string; value: string }> {
  if (funnel === "top") {
    return [
      { label: "CPM", value: moneyOrDash(row.cpm) },
      { label: "CTR", value: pctOrDash(row.ctr) },
      { label: "Freq", value: numberOrDash(row.frequency, 2) },
      { label: "Reach", value: NUM.format(row.total_reach) },
    ];
  }
  if (funnel === "mid") {
    return [
      { label: "CPC", value: moneyOrDash(row.cpc) },
      { label: "CPLPV", value: moneyOrDash(row.cplpv) },
      { label: "CTR", value: pctOrDash(row.ctr) },
      { label: "LPV", value: NUM.format(row.lpv_count) },
    ];
  }
  if (phase === "registration") {
    return [
      { label: "CPReg", value: moneyOrDash(row.cpreg) },
      { label: "CPP", value: moneyOrDash(row.cpp) },
      { label: "ROAS", value: roasOrDash(row.roas) },
      { label: "Regs", value: NUM.format(row.total_regs) },
    ];
  }
  return [
    { label: "CPA", value: moneyOrDash(row.cpa) },
    { label: "CPP", value: moneyOrDash(row.cpp) },
    { label: "ROAS", value: roasOrDash(row.roas) },
    { label: "Purch", value: NUM.format(row.total_purchases) },
  ];
}

function bestDimensionLabel(
  funnel: FunnelView,
  phase: CreativePatternPhase,
): string {
  if (funnel === "top") return "Cheapest CPM dimension";
  if (funnel === "mid") return "Lowest CPC dimension";
  return phase === "registration"
    ? "Lowest CPReg dimension"
    : "Lowest CPA dimension";
}

function bestDimensionForLens(
  dimensions: ClientCreativePatternsResult["dimensions"],
  funnel: FunnelView,
  phase: CreativePatternPhase,
): { dimension: CreativeTagDimension; sub: string } | null {
  let best: { dimension: CreativeTagDimension; value: number; sub: string } | null =
    null;
  for (const dimension of dimensions) {
    const value = dimensionMetricForLens(dimension.values, funnel, phase);
    if (value == null) continue;
    if (!best || value < best.value) {
      best = {
        dimension: dimension.dimension,
        value,
        sub: dimensionMetricLabel(value, funnel, phase),
      };
    }
  }
  return best;
}

function dimensionMetricForLens(
  rows: TileRow[],
  funnel: FunnelView,
  phase: CreativePatternPhase,
): number | null {
  const spend = rows.reduce((sum, row) => sum + row.total_spend, 0);
  if (spend <= 0) return null;
  if (funnel === "top") {
    const impressions = rows.reduce((sum, row) => sum + row.total_impressions, 0);
    return impressions > 0 ? (spend / impressions) * 1000 : null;
  }
  if (funnel === "mid") {
    const clicks = rows.reduce((sum, row) => sum + row.total_clicks, 0);
    return clicks > 0 ? spend / clicks : null;
  }
  if (phase === "registration") {
    const regs = rows.reduce((sum, row) => sum + row.total_regs, 0);
    return regs > 0 ? spend / regs : null;
  }
  const acquisitions = rows.reduce(
    (sum, row) => sum + row.total_purchases + row.total_regs,
    0,
  );
  return acquisitions > 0 ? spend / acquisitions : null;
}

function dimensionMetricLabel(
  value: number,
  funnel: FunnelView,
  phase: CreativePatternPhase,
): string {
  if (funnel === "top") return `${GBP2.format(value)} CPM`;
  if (funnel === "mid") return `${GBP2.format(value)} CPC`;
  return phase === "registration"
    ? `${GBP2.format(value)} CPReg`
    : `${GBP2.format(value)} CPA`;
}

function formatMoney(value: number): string {
  return GBP.format(value);
}

function moneyOrDash(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : GBP2.format(value);
}

function pctOrDash(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function numberOrDash(value: number | null, digits: number): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function roasOrDash(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}×`;
}

function formatDateRange(since: string, until: string): string {
  return `${formatYmd(since)}–${formatYmd(until)}`;
}

function formatYmd(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
