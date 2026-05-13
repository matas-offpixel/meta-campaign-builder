import Link from "next/link";
import { Sparkles } from "lucide-react";

import {
  buildClientCreativePatterns,
  type CreativePatternPhase,
  type CreativePatternRegionFilter,
  type TileRow,
} from "@/lib/reporting/creative-patterns-cross-event";
import {
  buildCreativePatternsInsightsHref,
  computeBestDimensionByFunnel,
  computeMetricPerfByKey,
  DIMENSION_LABELS,
  funnelMiniStatDefs,
  primaryQuartileForSortedIndex,
  sortTilesForView,
  type CreativePatternFunnel,
  type CreativePatternsInsightsLinkCtx,
} from "@/lib/dashboard/creative-patterns-funnel-view";
import { PatternSummaryTile } from "@/components/dashboard/clients/creative-patterns-tiles";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("en-GB");

interface Props {
  clientId: string;
  scopeLabel: string;
  regionFilter?: CreativePatternRegionFilter;
  sinceDays?: number;
  phase?: CreativePatternPhase;
  funnel?: CreativePatternFunnel;
  dashboardInsights?: {
    region?: string;
    token?: string;
    isShared?: boolean;
  };
  venueEventCode?: string;
  /** Venue-scoped share token; threaded to phase/funnel pill hrefs on share-surface venue pages. */
  venueShareToken?: string;
  isShared?: boolean;
}

export async function CreativePatternsPanel({
  clientId,
  scopeLabel,
  regionFilter,
  sinceDays = 90,
  phase: phaseProp,
  funnel: funnelProp,
  dashboardInsights,
  venueEventCode,
  venueShareToken,
  isShared = false,
}: Props) {
  const phase = phaseProp ?? "ticket_sale";
  const funnel = funnelProp ?? "bottom";

  const patterns = await buildClientCreativePatterns(clientId, {
    sinceDays,
    phase,
    regionFilter,
    useServiceRole: isShared,
  });

  const defs = funnelMiniStatDefs(funnel, phase);
  const sortedDimensions = patterns.dimensions.map((dimension) => ({
    ...dimension,
    values: sortTilesForView(dimension.values, funnel, phase),
  }));

  const bestDim = computeBestDimensionByFunnel(sortedDimensions, funnel, phase);
  const hasValues = sortedDimensions.some((dimension) => dimension.values.length > 0);

  const pillCtx: CreativePatternsInsightsLinkCtx =
    venueEventCode != null
      ? {
          surface: "venue",
          clientId,
          eventCode: venueEventCode,
          token: venueShareToken,
          isShared,
          phase,
          funnel,
        }
      : {
          surface: "dashboard",
          clientId,
          region: dashboardInsights?.region,
          token: dashboardInsights?.token,
          isShared: dashboardInsights?.isShared,
          phase,
          funnel,
        };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Creative Insights
            </p>
            <h2 className="mt-1 font-heading text-2xl tracking-wide">
              Patterns for {scopeLabel}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {NUM.format(patterns.summary.taggedEventCount)} tagged events ·{" "}
              {formatMoney(patterns.summary.totalSpend)} spend · last{" "}
              {patterns.summary.sinceDays} days · {phaseLabel(phase)} phase.
            </p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Phase
              </span>
              <PhasePills ctx={pillCtx} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Funnel
              </span>
              <FunnelPills ctx={pillCtx} />
            </div>
          </div>

          <div className="flex w-full max-w-md flex-col gap-3 sm:w-auto sm:items-end">
            {bestDim ? (
              <div className="w-full rounded-md border border-border bg-muted/40 px-3 py-2 text-right sm:max-w-sm">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {bestDim.metricLabel}
                </p>
                <p className="mt-1 font-heading text-sm tracking-wide text-foreground">
                  {bestDim.label}
                </p>
              </div>
            ) : null}
            <div className="grid w-full grid-cols-3 gap-2 text-xs sm:w-auto">
              <MiniKpi label="Ad concepts" value={NUM.format(patterns.summary.totalAdConcepts)} />
              <MiniKpi label="Tag rows" value={NUM.format(patterns.summary.tagAssignmentCount)} />
              <MiniKpi label="Phase spend" value={formatMoney(patterns.summary.phaseSpend)} />
            </div>
          </div>
        </div>
      </div>

      {!hasValues ? (
        <div className="rounded-lg border border-dashed border-border bg-card p-8">
          <div className="flex max-w-2xl gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <Sparkles className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-heading text-lg tracking-wide">
                No tagged creative patterns in this scope yet
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Once this region or venue has active creative snapshots and tag
                assignments, the taxonomy breakdown will appear here.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-7">
          {sortedDimensions.map((dimension) =>
            dimension.values.length === 0 ? null : (
              <DimensionSection
                key={dimension.dimension}
                dimensionLabel={DIMENSION_LABELS[dimension.dimension]}
                rows={dimension.values}
                phase={phase}
                funnel={funnel}
                defs={defs}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

function DimensionSection({
  dimensionLabel,
  rows,
  phase,
  funnel,
  defs,
}: {
  dimensionLabel: string;
  rows: TileRow[];
  phase: CreativePatternPhase;
  funnel: CreativePatternFunnel;
  defs: ReturnType<typeof funnelMiniStatDefs>;
}) {
  const perfByTile = computeMetricPerfByKey(rows, defs, phase);
  const showSpotlight = rows.length > 3;
  const spotlightRows = showSpotlight ? rows.slice(0, 3) : [];
  const gridRows = showSpotlight ? rows.slice(3) : rows;
  const tiers = ["gold", "silver", "bronze"] as const;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-heading text-xl tracking-wide">{dimensionLabel}</h3>
        <p className="text-xs text-muted-foreground">
          {NUM.format(rows.length)} tagged values
        </p>
      </div>

      {showSpotlight ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {spotlightRows.map((row, idx) => (
            <PatternSummaryTile
              key={`spot-${row.value_key}`}
              row={row}
              phase={phase}
              funnel={funnel}
              spotlight={tiers[idx]}
              primaryQuartile={primaryQuartileForSortedIndex(idx, rows.length)}
              metricPerf={perfByTile.get(row.value_key) ?? {}}
            />
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {gridRows.map((row) => {
          const sortedIdx = rows.findIndex((r) => r.value_key === row.value_key);
          return (
            <PatternSummaryTile
              key={row.value_key}
              row={row}
              phase={phase}
              funnel={funnel}
              primaryQuartile={primaryQuartileForSortedIndex(
                sortedIdx >= 0 ? sortedIdx : 0,
                rows.length,
              )}
              metricPerf={perfByTile.get(row.value_key) ?? {}}
            />
          );
        })}
      </div>
    </div>
  );
}

function PhasePills({ ctx }: { ctx: CreativePatternsInsightsLinkCtx }) {
  const phases: CreativePatternPhase[] = ["ticket_sale", "registration"];
  return (
    <>
      {phases.map((phase) => {
        const href = buildCreativePatternsInsightsHref({ ...ctx, phase });
        const isOn = phase === ctx.phase;
        return (
          <Link
            key={phase}
            href={href}
            scroll={false}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              isOn
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
          >
            {phase === "registration" ? "Registration" : "Ticket Sale"}
          </Link>
        );
      })}
    </>
  );
}

function FunnelPills({ ctx }: { ctx: CreativePatternsInsightsLinkCtx }) {
  const opts: { id: CreativePatternFunnel; label: string }[] = [
    { id: "top", label: "Top" },
    { id: "mid", label: "Mid" },
    { id: "bottom", label: "Bottom" },
  ];
  return (
    <>
      {opts.map(({ id, label }) => {
        const href = buildCreativePatternsInsightsHref({ ...ctx, funnel: id });
        const isOn = id === ctx.funnel;
        return (
          <Link
            key={id}
            href={href}
            scroll={false}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              isOn
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </>
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

function phaseLabel(phase: CreativePatternPhase): string {
  return phase === "registration" ? "Registration" : "Ticket Sale";
}

function formatMoney(value: number): string {
  return GBP.format(value);
}

export {
  parseCreativePatternPhase,
  parseCreativePatternFunnel,
} from "@/lib/dashboard/creative-patterns-funnel-view";

export type { CreativePatternFunnel } from "@/lib/dashboard/creative-patterns-funnel-view";
