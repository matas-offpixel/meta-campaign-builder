import { Sparkles } from "lucide-react";

import {
  buildClientCreativePatterns,
  type CreativePatternPhase,
  type CreativePatternRegionFilter,
} from "@/lib/reporting/creative-patterns-cross-event";
import type { CreativeTagDimension } from "@/lib/db/creative-tags";
import { PatternSummaryTile } from "@/components/dashboard/clients/creative-patterns-tiles";

const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const NUM = new Intl.NumberFormat("en-GB");

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

interface Props {
  clientId: string;
  scopeLabel: string;
  regionFilter?: CreativePatternRegionFilter;
  sinceDays?: number;
  phase?: CreativePatternPhase;
}

export async function CreativePatternsPanel({
  clientId,
  scopeLabel,
  regionFilter,
  sinceDays = 90,
  phase = "ticket_sale",
}: Props) {
  const patterns = await buildClientCreativePatterns(clientId, {
    sinceDays,
    phase,
    regionFilter,
  });
  const hasValues = patterns.dimensions.some((dimension) => dimension.values.length > 0);

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
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
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <MiniKpi label="Ad concepts" value={NUM.format(patterns.summary.totalAdConcepts)} />
            <MiniKpi label="Tag rows" value={NUM.format(patterns.summary.tagAssignmentCount)} />
            <MiniKpi label="Phase spend" value={formatMoney(patterns.summary.phaseSpend)} />
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
          {patterns.dimensions.map((dimension) =>
            dimension.values.length === 0 ? null : (
              <div key={dimension.dimension} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-heading text-xl tracking-wide">
                    {DIMENSION_LABELS[dimension.dimension]}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {NUM.format(dimension.values.length)} tagged values
                  </p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                  {dimension.values.map((row) => (
                    <PatternSummaryTile key={row.value_key} row={row} />
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </section>
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
