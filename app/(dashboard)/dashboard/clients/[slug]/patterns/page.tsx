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
import {
  rankByMetricQuartile,
  type PerformanceQuartile,
} from "@/lib/reporting/patterns-quartile-rank";

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ window?: string; phase?: string; funnel?: string }>;
}

const WINDOWS = [30, 90, 180] as const;
const PHASES = ["registration", "ticket_sale"] as const;
const FUNNELS = ["top", "mid", "bottom"] as const;

type FunnelView = (typeof FUNNELS)[number];
type MetricDirection = "higher" | "lower";
type MetricKey =
  | "cpa"
  | "cpp"
  | "roas"
  | "cpm"
  | "ctr"
  | "reach"
  | "spend"
  | "clicks"
  | "cpc"
  | "cplpv"
  | "lpv"
  | "purchases";

interface MiniStatRow {
  key: MetricKey;
  label: string;
  value: string;
  rawValue: number | null;
  direction: MetricDirection;
  help: string;
}

interface MetricContext {
  bestValue: number | null;
  quartiles: Map<string, PerformanceQuartile>;
}

interface RankedTile {
  row: TileRow;
  quartile: PerformanceQuartile;
}

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
                <DimensionSection
                  key={dimension.dimension}
                  dimension={dimension}
                  funnel={funnel}
                />
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
      <KpiTile
        label="Total spend"
        value={formatMoney(patterns.summary.totalSpend)}
        help="Total paid media spend across this client's events in the selected timeframe. It does not change when you switch creative phase."
      />
      <KpiTile
        label="Events analyzed"
        value={NUM.format(patterns.summary.taggedEventCount)}
        sub={`${NUM.format(patterns.summary.eventCount)} client events`}
        help="Events with creative tag assignments available for pattern analysis, compared with the full client event list."
      />
      <KpiTile
        label="Ad concepts"
        value={NUM.format(patterns.summary.totalAdConcepts)}
        sub={`${NUM.format(patterns.summary.tagAssignmentCount)} tag rows`}
        help="Creative concepts with matching tags in the selected phase. Tag rows are the underlying creative-tag assignments."
      />
      <KpiTile
        label={bestDimensionLabel(funnel, phase)}
        value={best ? DIMENSION_LABELS[best.dimension] : "—"}
        sub={best ? best.sub : "No eligible values"}
        help={bestDimensionHelp(funnel, phase)}
      />
    </section>
  );
}

function KpiTile({
  label,
  value,
  sub,
  help,
}: {
  label: string;
  value: string;
  sub?: string;
  help?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        {help && (
          <button
            type="button"
            title={help}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] text-muted-foreground hover:text-foreground"
          >
            ?
          </button>
        )}
      </div>
      <p className="mt-2 font-heading text-2xl tracking-wide text-foreground">
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function DimensionSection({
  dimension,
  funnel,
}: {
  dimension: ClientCreativePatternsResult["dimensions"][number];
  funnel: FunnelView;
}) {
  const rankedTiles = rankTilesForFunnel(dimension.values, funnel);
  const metricContexts = buildMetricContexts(dimension.values);
  const showSpotlight = rankedTiles.length > 3;
  const spotlight = showSpotlight ? rankedTiles.slice(0, 3) : [];
  const gridTiles = showSpotlight ? rankedTiles.slice(3) : rankedTiles;
  const enableQuartileStripe = rankedTiles.length >= 4;

  return (
    <section className="space-y-4">
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
          No tagged creatives for this dimension in the selected window.
        </div>
      ) : (
        <div className="space-y-4">
          {showSpotlight && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Spotlight · best by {spotlightMetricLabel(funnel)}
              </p>
              <div className="grid gap-4 lg:grid-cols-3">
                {spotlight.map((tile, index) => (
                  <PatternTile
                    key={tile.row.value_key}
                    row={tile.row}
                    funnel={funnel}
                    metricContexts={metricContexts}
                    quartile={tile.quartile}
                    enableQuartileStripe={enableQuartileStripe}
                    size="lg"
                    spotlightRank={(index + 1) as 1 | 2 | 3}
                  />
                ))}
              </div>
            </div>
          )}
          {gridTiles.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {gridTiles.map((tile) => (
                <PatternTile
                  key={tile.row.value_key}
                  row={tile.row}
                  funnel={funnel}
                  metricContexts={metricContexts}
                  quartile={tile.quartile}
                  enableQuartileStripe={enableQuartileStripe}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
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
  metricContexts,
  quartile,
  enableQuartileStripe,
  size = "md",
  spotlightRank,
}: {
  row: TileRow;
  funnel: FunnelView;
  metricContexts: Map<MetricKey, MetricContext>;
  quartile: PerformanceQuartile;
  enableQuartileStripe: boolean;
  size?: "md" | "lg";
  spotlightRank?: 1 | 2 | 3;
}) {
  const stats = miniStatsForLens(row, funnel);
  const articleClassName = [
    "rounded-lg border bg-card shadow-sm",
    size === "lg" ? "p-5" : "p-4",
    spotlightRank ? spotlightBorderClass(spotlightRank) : "border-border",
    !spotlightRank && enableQuartileStripe ? quartileStripeClass(quartile) : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={articleClassName}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {spotlightRank === 1 && (
            <span className="mb-2 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-amber-800">
              TOP PERFORMER
            </span>
          )}
          <h3
            className={`flex flex-wrap items-center gap-2 font-heading tracking-wide ${
              size === "lg" ? "text-xl" : "text-lg"
            }`}
          >
            {row.value_label}
            <PerformanceBadge quartile={quartile} />
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {NUM.format(row.event_count)} events · {NUM.format(row.ad_count)} ads
          </p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
          {row.value_key}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
        {stats.map((stat) => (
          <MiniStat
            key={stat.key}
            stat={stat}
            context={metricContexts.get(stat.key)}
            tileKey={row.value_key}
          />
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

function MiniStat({
  stat,
  context,
  tileKey,
}: {
  stat: MiniStatRow;
  context: MetricContext | undefined;
  tileKey: string;
}) {
  const bar = statBar(stat, context, tileKey);
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <div className="flex items-center gap-1">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {stat.label}
        </p>
        <button
          type="button"
          title={stat.help}
          className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border text-[9px] text-muted-foreground hover:text-foreground"
        >
          ?
        </button>
      </div>
      <p className="mt-1 font-medium tabular-nums text-foreground">
        {stat.value}
      </p>
      {bar && (
        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-1 rounded-full ${bar.colorClass}`}
            style={{ width: `${bar.widthPct}%` }}
          />
        </div>
      )}
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

function rankTilesForFunnel(
  tiles: readonly TileRow[],
  funnel: FunnelView,
): RankedTile[] {
  return rankByMetricQuartile(
    tiles,
    (tile) => metricForSort(tile, funnel),
    (tile) => tile.total_spend,
  ).map((ranked) => ({
    row: ranked.item,
    quartile: ranked.quartile,
  }));
}

function metricForSort(tile: TileRow, funnel: FunnelView): number | null {
  if (tile.total_spend <= 0) return null;
  if (funnel === "top") return tile.cpm;
  if (funnel === "mid") return tile.cpc;
  return tile.cpa;
}

function buildMetricContexts(tiles: readonly TileRow[]): Map<MetricKey, MetricContext> {
  const contexts = new Map<MetricKey, MetricContext>();
  const keys: MetricKey[] = [
    "cpa",
    "cpp",
    "roas",
    "cpm",
    "ctr",
    "reach",
    "spend",
    "clicks",
    "cpc",
    "cplpv",
    "lpv",
    "purchases",
  ];

  for (const key of keys) {
    const direction = metricDirection(key);
    const values = tiles
      .map((tile) => metricRawValue(tile, key))
      .filter((value): value is number => value != null && Number.isFinite(value));
    const bestValue =
      values.length === 0
        ? null
        : direction === "lower"
          ? Math.min(...values)
          : Math.max(...values);
    const ranked = rankByMetricQuartile(
      tiles,
      (tile) => {
        const value = metricRawValue(tile, key);
        if (value == null) return null;
        return direction === "lower" ? value : -value;
      },
      (tile) => tile.total_spend,
    );
    contexts.set(key, {
      bestValue,
      quartiles: new Map(
        ranked.map((row) => [row.item.value_key, row.quartile] as const),
      ),
    });
  }

  return contexts;
}

function miniStatsForLens(row: TileRow, funnel: FunnelView): MiniStatRow[] {
  if (funnel === "top") {
    return compactStats([
      miniStat("cpm", "CPM", row.cpm, moneyOrDash(row.cpm), "lower"),
      miniStat("ctr", "CTR", row.ctr, pctOrDash(row.ctr), "higher"),
      miniStat("reach", "Reach", row.total_reach, NUM.format(row.total_reach), "higher"),
      miniStat("spend", "Spend", row.total_spend, formatMoney(row.total_spend), "higher"),
      miniStat("clicks", "Clicks", row.total_clicks, NUM.format(row.total_clicks), "higher"),
      miniStat("cpc", "CPC", row.cpc, moneyOrDash(row.cpc), "lower"),
    ]);
  }
  if (funnel === "mid") {
    return compactStats([
      miniStat("cpc", "CPC", row.cpc, moneyOrDash(row.cpc), "lower"),
      miniStat("cplpv", "CPLPV", row.cplpv, moneyOrDash(row.cplpv), "lower"),
      miniStat("lpv", "LPV", row.lpv_count, NUM.format(row.lpv_count), "higher"),
      miniStat("spend", "Spend", row.total_spend, formatMoney(row.total_spend), "higher"),
      miniStat("clicks", "Clicks", row.total_clicks, NUM.format(row.total_clicks), "higher"),
      miniStat("ctr", "CTR", row.ctr, pctOrDash(row.ctr), "higher"),
    ]);
  }
  return compactStats([
    miniStat("cpa", "CPA", row.cpa, moneyOrDash(row.cpa), "lower"),
    miniStat("cpp", "CPP", row.cpp, moneyOrDash(row.cpp), "lower"),
    miniStat("roas", "ROAS", row.roas, roasOrDash(row.roas), "higher"),
    miniStat("spend", "Spend", row.total_spend, formatMoney(row.total_spend), "higher"),
    miniStat("purchases", "Purch", row.total_purchases, NUM.format(row.total_purchases), "higher"),
    miniStat("clicks", "Clicks", row.total_clicks, NUM.format(row.total_clicks), "higher"),
  ]);
}

function miniStat(
  key: MetricKey,
  label: string,
  rawValue: number | null,
  value: string,
  direction: MetricDirection,
): MiniStatRow {
  return {
    key,
    label,
    rawValue,
    value,
    direction,
    help: metricHelp(key),
  };
}

function compactStats(stats: MiniStatRow[]): MiniStatRow[] {
  return stats.filter((stat) => stat.rawValue != null);
}

function metricRawValue(tile: TileRow, key: MetricKey): number | null {
  switch (key) {
    case "cpa":
      return tile.cpa;
    case "cpp":
      return tile.cpp;
    case "roas":
      return tile.roas;
    case "cpm":
      return tile.cpm;
    case "ctr":
      return tile.ctr;
    case "reach":
      return tile.total_reach;
    case "spend":
      return tile.total_spend;
    case "clicks":
      return tile.total_clicks;
    case "cpc":
      return tile.cpc;
    case "cplpv":
      return tile.cplpv;
    case "lpv":
      return tile.lpv_count;
    case "purchases":
      return tile.total_purchases;
  }
}

function metricDirection(key: MetricKey): MetricDirection {
  return ["cpa", "cpp", "cpm", "cpc", "cplpv"].includes(key)
    ? "lower"
    : "higher";
}

function metricHelp(key: MetricKey): string {
  switch (key) {
    case "cpa":
      return "Cost per acquisition — average cost per sale or registration from this creative tag. Lower is better.";
    case "cpp":
      return "Cost per purchase — average ad spend needed for one ticket purchase. Lower is better.";
    case "roas":
      return "Return on ad spend — tracked purchase value divided by spend. Higher is better.";
    case "cpm":
      return "Cost per thousand impressions — how cheaply this tag reached people. Lower is better.";
    case "ctr":
      return "Click-through rate — share of impressions that became clicks. Higher is better.";
    case "reach":
      return "Reach — summed audience reached by creatives with this tag. Higher means more scale.";
    case "spend":
      return "Spend — total ad spend behind this tag. Use it to judge whether the result has enough scale.";
    case "clicks":
      return "Clicks — total clicks generated by creatives with this tag. Higher means more traffic volume.";
    case "cpc":
      return "Cost per click — average ad spend needed for one click. Lower is better.";
    case "cplpv":
      return "Cost per landing-page view — average spend needed for one landing-page visit. Lower is better.";
    case "lpv":
      return "Landing-page views — visits generated after people clicked through. Higher means more traffic quality.";
    case "purchases":
      return "Purchases — ticket purchases attributed to creatives with this tag. Higher means more conversion volume.";
  }
}

function statBar(
  stat: MiniStatRow,
  context: MetricContext | undefined,
  tileKey: string,
): { widthPct: number; colorClass: string } | null {
  if (!context?.bestValue || stat.rawValue == null || stat.rawValue < 0) {
    return null;
  }
  const rawPct =
    stat.direction === "lower"
      ? (context.bestValue / stat.rawValue) * 100
      : (stat.rawValue / context.bestValue) * 100;
  const widthPct = clamp(rawPct, 0, 100);
  return {
    widthPct,
    colorClass: quartileBarClass(context.quartiles.get(tileKey) ?? 4),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function PerformanceBadge({ quartile }: { quartile: PerformanceQuartile }) {
  const config = {
    1: {
      label: "🟢 Strong",
      className: "bg-green-100 text-green-800",
    },
    2: {
      label: "🟡 OK",
      className: "bg-amber-100 text-amber-800",
    },
    3: {
      label: "🟠 Watch",
      className: "bg-orange-100 text-orange-800",
    },
    4: {
      label: "🔴 Weak",
      className: "bg-red-100 text-red-800",
    },
  }[quartile];

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function quartileBarClass(quartile: PerformanceQuartile): string {
  if (quartile === 1) return "bg-green-500";
  if (quartile === 4) return "bg-red-500";
  return "bg-amber-500";
}

function quartileStripeClass(quartile: PerformanceQuartile): string {
  if (quartile === 1) return "border-l-4 border-l-green-500";
  if (quartile === 4) return "border-l-4 border-l-red-400";
  return "";
}

function spotlightBorderClass(rank: 1 | 2 | 3): string {
  if (rank === 1) return "border-amber-300 ring-1 ring-amber-200";
  if (rank === 2) return "border-slate-300 ring-1 ring-slate-200";
  return "border-orange-300 ring-1 ring-orange-200";
}

function spotlightMetricLabel(funnel: FunnelView): string {
  if (funnel === "top") return "cheapest CPM";
  if (funnel === "mid") return "lowest CPC";
  return "lowest CPA";
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

function bestDimensionHelp(
  funnel: FunnelView,
  phase: CreativePatternPhase,
): string {
  if (funnel === "top") {
    return "The taxonomy dimension with the cheapest CPM across its tagged creative values. Lower is better.";
  }
  if (funnel === "mid") {
    return "The taxonomy dimension with the lowest cost per click across its tagged creative values. Lower is better.";
  }
  return phase === "registration"
    ? "The taxonomy dimension with the lowest cost per registration across its tagged creative values. Lower is better."
    : "The taxonomy dimension with the lowest cost per acquisition across its tagged creative values. Lower is better.";
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
