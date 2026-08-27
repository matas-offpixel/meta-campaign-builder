import type { ReactNode } from "react";

import {
  EVENT_FUNNEL_SEED_LABEL,
  funnelCostLabel,
  isAmountCell,
  type CrossPlatformComparison,
  type EventFunnelCosts,
  type EventFunnelStage,
  type EventFunnelView,
  type FunnelCostCell,
  type FunnelPlatform,
} from "@/lib/dashboard/event-funnel";
import type { OffFunnelAuditRow } from "@/lib/dashboard/off-funnel-audit";
import { OffFunnelCampaignsCard } from "@/components/dashboard/event-report/off-funnel-campaigns-card";
import { FunnelStageBar } from "@/components/viz/funnel-stage-bar";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import {
  benchmarkDeltaTone,
  formatDeltaPp,
  platformSharePercents,
  proportionalBarWidths,
} from "@/lib/viz/funnel-scale";
import { VIZ_DELTA_TOKEN, type VizPlatform } from "@/lib/viz/tokens";

const NUM = new Intl.NumberFormat("en-GB");

function fmtInt(value: number | null): string {
  if (value == null) return "—";
  return NUM.format(Math.round(value));
}

function fmtPct(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  const pct = rate * 100;
  return `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)}%`;
}

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtCost(cell: FunnelCostCell): string {
  if (isAmountCell(cell)) return GBP.format(cell.value);
  return funnelCostLabel(cell);
}

function CostChip({
  cell,
  label,
  best,
  platform,
}: {
  cell: FunnelCostCell;
  label: string;
  best?: boolean;
  platform?: FunnelPlatform;
}) {
  const named = !isAmountCell(cell);
  return (
    <MetricChip label={named ? funnelCostLabel(cell) : `${label} ${fmtCost(cell)}`}>
      {platform ? (
        <PlatformGlyph
          platform={platform as VizPlatform}
          size="sm"
          className={best ? "text-foreground" : "text-muted-foreground"}
        />
      ) : null}
      {best && platform ? (
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-success"
          aria-label="best value"
        />
      ) : null}
      <span className={named ? "text-muted-foreground" : undefined}>
        {named ? "—" : fmtCost(cell)}
      </span>
    </MetricChip>
  );
}

function FunnelJoin({
  stage,
  chips,
}: {
  stage: EventFunnelStage;
  chips: ReactNode;
}) {
  if (!stage.conversionLabel) return null;
  const tone = benchmarkDeltaTone(stage.conversionFromPrevious, stage.seedRate);
  const delta = formatDeltaPp(stage.conversionFromPrevious, stage.seedRate);
  return (
    <div className="flex flex-wrap items-center gap-2 py-1 pl-1">
      <span
        className={`text-xs tabular-nums ${VIZ_DELTA_TOKEN[tone]}`}
        title={delta ?? stage.conversionLabel}
        aria-label={`${stage.conversionLabel} ${fmtPct(stage.conversionFromPrevious)}${delta ? ` ${delta}` : ""}`}
      >
        {fmtPct(stage.conversionFromPrevious)}
      </span>
      {stage.seedRate != null ? (
        <span
          className="text-[10px] tabular-nums text-muted-foreground/70"
          title={`${fmtPct(stage.seedRate)} ${stage.seedLabel ?? EVENT_FUNNEL_SEED_LABEL}`}
        >
          {fmtPct(stage.seedRate)}
        </span>
      ) : null}
      {chips}
    </div>
  );
}

function EventFunnelVisual({
  funnel,
}: {
  funnel: EventFunnelView;
}) {
  const widths = proportionalBarWidths(funnel.stages.map((stage) => stage.value));

  return (
    <div className="space-y-1">
      {funnel.stages.map((stage, index) => {
        const bar = widths[index] ?? { widthPct: 0, dashed: stage.value == null };
        const shares = stage.platformSplit
          ? platformSharePercents(stage.platformSplit)
          : [];
        const joinChips =
          stage.key === "clicks" ? (
            <>
              {funnel.costs.platforms.map((row) => (
                <CostChip
                  key={row.platform}
                  cell={row.cpc}
                  label={`${row.label} CPC`}
                  platform={row.platform}
                  best={funnel.costs.bestCpc === row.platform}
                />
              ))}
            </>
          ) : stage.key === "lpv" ? (
            <CostChip cell={funnel.costs.costPerLpv} label="Cost per LPV" />
          ) : stage.key === "signups" ? (
            <CostChip cell={funnel.costs.costPerSignup} label="Cost per signup" />
          ) : stage.key === "purchases" ? (
            <span className="inline-flex items-center gap-1">
              <CostChip cell={funnel.costs.costPerTicket} label="Cost per ticket" />
              <ProvenanceBadge provenance={funnel.costs.ticketProvenance} />
            </span>
          ) : null;

        return (
          <div key={stage.key}>
            {stage.conversionLabel ? (
              <FunnelJoin stage={stage} chips={joinChips} />
            ) : null}
            <FunnelStageBar
              label={stage.label}
              valueLabel={fmtInt(stage.value)}
              widthPct={bar.widthPct}
              dashed={bar.dashed || stage.provenance === "not instrumented"}
              segments={shares}
              provenance={stage.provenance}
              title={stage.provenanceDetail}
            />
            {stage.key === "lpv" && funnel.metaReportedLpv > 0 ? (
              <div className="mt-0.5 flex justify-end">
                <InfoTip
                  label={`Meta reports ${fmtInt(funnel.metaReportedLpv)} landing_page_views (platform action). That is not first-party LPV.`}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function EventFunnelCostStrip({
  costs,
  tonality,
}: {
  costs: EventFunnelCosts;
  tonality: "internal" | "share";
}) {
  if (costs.platforms.length === 0) return null;
  const subtitle =
    tonality === "share"
      ? "What each paid channel costs at the stages we can actually measure. Signup and ticket costs are blended — we do not invent per-platform purchase attribution."
      : "CPM, cost-per-reach and CPC per platform. Signup and ticket costs are blended (first-party / manual), not attributed. Best-value highlight only when two or more platforms have both spend and the metric.";

  return (
    <div className="space-y-2" data-testid="event-funnel-costs">
      <div className="flex items-center gap-1.5">
        <h3 className="font-heading text-base tracking-wide">Cost per stage</h3>
        <InfoTip label={subtitle} />
      </div>
      <ul className="flex flex-wrap gap-2">
        {costs.platforms.map((row) => (
          <li key={row.platform} className="inline-flex flex-wrap items-center gap-1.5">
            <PlatformGlyph platform={row.platform} size="sm" />
            <MetricChip label={`${row.label} spend`}>{GBP.format(row.spend)}</MetricChip>
            <CostChip
              cell={row.cpm}
              label={`${row.label} CPM`}
              platform={row.platform}
              best={costs.bestCpm === row.platform}
            />
            <CostChip
              cell={row.costPerReach}
              label={`${row.label} cost per reach`}
              platform={row.platform}
              best={costs.bestCostPerReach === row.platform}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CostCell({
  cell,
  best,
}: {
  cell: FunnelCostCell;
  best: boolean;
}) {
  return (
    <td
      className={`px-3 py-2 tabular-nums ${
        best ? "bg-emerald-500/10 font-medium text-emerald-900 dark:text-emerald-100" : ""
      }`}
    >
      {fmtCost(cell)}
      {best ? (
        <span className="ml-1 text-[10px] uppercase tracking-[0.12em]">best</span>
      ) : null}
    </td>
  );
}

function CrossPlatformComparisonCard({
  comparison,
  showDiagnostics,
}: {
  comparison: CrossPlatformComparison;
  showDiagnostics: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="cross-platform-comparison">
      <div className="flex items-center gap-1.5">
        <h3 className="font-heading text-base tracking-wide">
          Last {comparison.windowDays} days by platform
        </h3>
        <InfoTip
          label={`CPM, CPC, and cost-per-reach from event_daily_rollups since ${comparison.sinceDate}. Recommend-only — nothing is auto-applied.`}
        />
      </div>
      {comparison.emptyReason ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-4 text-sm text-muted-foreground">
          {comparison.emptyReason}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Channel</th>
                <th className="px-3 py-2 font-medium">Spend</th>
                <th className="px-3 py-2 font-medium">CPM</th>
                <th className="px-3 py-2 font-medium">Cost / reach</th>
                <th className="px-3 py-2 font-medium">CPC</th>
              </tr>
            </thead>
            <tbody>
              {comparison.platforms.map((row) => (
                <tr key={row.platform} className="border-t border-border">
                  <th className="px-3 py-2 font-medium">{row.label}</th>
                  <td className="px-3 py-2 tabular-nums">{GBP.format(row.spend)}</td>
                  <CostCell cell={row.cpm} best={comparison.bestCpm === row.platform} />
                  <CostCell
                    cell={row.costPerReach}
                    best={comparison.bestCostPerReach === row.platform}
                  />
                  <CostCell cell={row.cpc} best={comparison.bestCpc === row.platform} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showDiagnostics ? (
        comparison.diagnostics.length === 0 ? (
          comparison.emptyReason ? null : (
            <p className="text-xs text-muted-foreground">
              No sustained stage-cost gap large enough to recommend a shift.
            </p>
          )
        ) : (
          <ul className="space-y-2" data-testid="funnel-diagnostics">
            {comparison.diagnostics.map((row) => (
              <li
                key={`${row.evidence.metric}-${row.createdAt}`}
                className="rounded-lg border border-border bg-card px-4 py-3 text-sm"
              >
                <p>{row.recommendation}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {row.provenance} · {row.createdAt} · recommend-only (never
                  auto-applied)
                </p>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

export function EventFunnelCard({
  funnel,
  tonality = "internal",
  offFunnelRows = [],
  comparison = null,
}: {
  funnel: EventFunnelView;
  tonality?: "internal" | "share";
  offFunnelRows?: OffFunnelAuditRow[];
  comparison?: CrossPlatformComparison | null;
}) {
  return (
    <section data-testid="event-funnel" className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h2 className="font-heading text-lg tracking-wide">Funnel</h2>
          <InfoTip
            label={`Reach → clicks → landing-page views → signups → purchases. Empty middle stages are the Phase B landing-page gap, not missing spend. Seeds are ${EVENT_FUNNEL_SEED_LABEL}.`}
          />
        </div>
        <EventFunnelVisual funnel={funnel} />
      </div>
      <EventFunnelCostStrip costs={funnel.costs} tonality={tonality} />
      {comparison ? (
        <CrossPlatformComparisonCard
          comparison={comparison}
          showDiagnostics={tonality === "internal"}
        />
      ) : null}
      {tonality === "internal" ? (
        <OffFunnelCampaignsCard rows={offFunnelRows} />
      ) : null}
    </section>
  );
}
