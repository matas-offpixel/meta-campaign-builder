import {
  EVENT_FUNNEL_SEED_LABEL,
  funnelCostLabel,
  isAmountCell,
  type CrossPlatformComparison,
  type EventFunnelCosts,
  type EventFunnelStage,
  type EventFunnelView,
  type FunnelCostCell,
  type FunnelProvenance,
} from "@/lib/dashboard/event-funnel";
import type { OffFunnelAuditRow } from "@/lib/dashboard/off-funnel-audit";
import { OffFunnelCampaignsCard } from "@/components/dashboard/event-report/off-funnel-campaigns-card";

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

function vsSeed(observed: number | null, seed: number | null): string | null {
  if (observed == null || seed == null) return null;
  const deltaPp = (observed - seed) * 100;
  if (Math.abs(deltaPp) < 0.5) return "at seed";
  const abs = Math.abs(deltaPp);
  const pretty = abs < 10 ? abs.toFixed(1) : abs.toFixed(0);
  return deltaPp > 0 ? `${pretty}pp above seed` : `${pretty}pp below seed`;
}

const PROVENANCE_CLASS: Record<FunnelProvenance, string> = {
  "platform-reported": "bg-sky-500/10 text-sky-800 dark:text-sky-200",
  "first-party": "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  "manual entry": "bg-amber-500/10 text-amber-900 dark:text-amber-200",
  modelled: "bg-violet-500/10 text-violet-800 dark:text-violet-200",
  "not instrumented": "border border-dashed border-border bg-muted/40 text-muted-foreground",
};

function ProvenanceBadge({
  provenance,
}: {
  provenance: FunnelProvenance;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${PROVENANCE_CLASS[provenance]}`}
    >
      {provenance}
    </span>
  );
}

function StageCard({
  stage,
  metaReportedLpv,
}: {
  stage: EventFunnelStage;
  metaReportedLpv: number;
}) {
  const seedCompare = vsSeed(stage.conversionFromPrevious, stage.seedRate);
  const empty = stage.value == null;

  return (
    <article className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          {stage.label}
        </p>
        <ProvenanceBadge provenance={stage.provenance} />
      </div>
      <p className="mt-2 font-heading text-2xl tabular-nums tracking-wide">
        {empty ? "—" : fmtInt(stage.value)}
      </p>
      {empty ? (
        <p className="mt-2 text-xs text-muted-foreground">{stage.provenanceDetail}</p>
      ) : (
        <p className="mt-1 text-[11px] text-muted-foreground">{stage.provenanceDetail}</p>
      )}

      {stage.conversionLabel ? (
        <div className="mt-3 border-t border-border pt-3 text-xs">
          <p className="text-muted-foreground">{stage.conversionLabel}</p>
          <p className="mt-0.5 tabular-nums">
            <span className="font-medium">{fmtPct(stage.conversionFromPrevious)}</span>
            {stage.seedRate != null ? (
              <span className="text-muted-foreground">
                {" "}
                vs {fmtPct(stage.seedRate)} seed
                {seedCompare ? ` · ${seedCompare}` : ""}
              </span>
            ) : null}
          </p>
          {stage.seedLabel ? (
            <p className="mt-1 text-[11px] text-muted-foreground">{stage.seedLabel}</p>
          ) : null}
        </div>
      ) : null}

      {stage.platformSplit && stage.platformSplit.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs">
          {stage.platformSplit.map((row) => (
            <li key={row.platform} className="flex justify-between gap-3 tabular-nums">
              <span className="text-muted-foreground">{row.label}</span>
              <span>
                {row.tracked ? fmtInt(row.value) : "not tracked"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {stage.key === "lpv" && metaReportedLpv > 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Meta reports {fmtInt(metaReportedLpv)} landing_page_views (platform
          action). That is not first-party LPV.
        </p>
      ) : null}
    </article>
  );
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

function EventFunnelCostTable({
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
    <div className="space-y-3" data-testid="event-funnel-costs">
      <div>
        <h3 className="font-heading text-base tracking-wide">Cost per stage</h3>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
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
            {costs.platforms.map((row) => (
              <tr key={row.platform} className="border-t border-border">
                <th className="px-3 py-2 font-medium">{row.label}</th>
                <td className="px-3 py-2 tabular-nums">{GBP.format(row.spend)}</td>
                <CostCell cell={row.cpm} best={costs.bestCpm === row.platform} />
                <CostCell
                  cell={row.costPerReach}
                  best={costs.bestCostPerReach === row.platform}
                />
                <CostCell cell={row.cpc} best={costs.bestCpc === row.platform} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 text-sm">
        <li className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Cost per LPV
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {funnelCostLabel(costs.costPerLpv)}
          </p>
        </li>
        <li className="rounded-lg border border-border bg-card p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            Cost per signup
          </p>
          <p className="mt-1 font-medium tabular-nums">{fmtCost(costs.costPerSignup)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">blended · first-party</p>
        </li>
        <li className="rounded-lg border border-border bg-card p-3">
          <p className="flex items-center justify-between gap-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>Cost per ticket</span>
            <ProvenanceBadge provenance={costs.ticketProvenance} />
          </p>
          <p className="mt-1 font-medium tabular-nums">{fmtCost(costs.costPerTicket)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">blended</p>
        </li>
      </ul>
    </div>
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
      <div>
        <h3 className="font-heading text-base tracking-wide">
          Last {comparison.windowDays} days by platform
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          CPM, CPC, and cost-per-reach from event_daily_rollups since{" "}
          {comparison.sinceDate}. Recommend-only — nothing is auto-applied.
        </p>
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
        <div>
          <h2 className="font-heading text-lg tracking-wide">Funnel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Reach → clicks → landing-page views → signups → purchases.
            Empty middle stages are the Phase B landing-page gap, not missing
            spend. Seeds are {EVENT_FUNNEL_SEED_LABEL}.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {funnel.stages.map((stage) => (
            <StageCard
              key={stage.key}
              stage={stage}
              metaReportedLpv={funnel.metaReportedLpv}
            />
          ))}
        </div>
      </div>
      <EventFunnelCostTable costs={funnel.costs} tonality={tonality} />
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
