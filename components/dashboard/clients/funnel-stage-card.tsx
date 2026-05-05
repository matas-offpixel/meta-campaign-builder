import type { FunnelStage } from "@/lib/reporting/funnel-pacing";

const NUM = new Intl.NumberFormat("en-GB");
const GBP = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function FunnelStageCard({ stage }: { stage: FunnelStage }) {
  const fillPct =
    stage.pacingPct == null ? 0 : Math.min(100, Math.max(0, stage.pacingPct));
  return (
    <article className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {stage.label}
          </p>
          <h3 className="mt-1 font-heading text-xl tracking-wide">
            {stage.metricLabel}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {stage.description}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${statusClass(
            stage.status,
          )}`}
        >
          {pacingStatusLabel(stage.status, stage.pacingPct)}
        </span>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm">
            <span className="font-semibold">{NUM.format(stage.actual)}</span>
            {" / "}
            <span className="font-semibold">
              {stage.target == null ? "—" : NUM.format(stage.target)}
            </span>{" "}
            {stage.metricLabel.toLowerCase()}
            {stage.pacingPct != null && (
              <span className="text-muted-foreground">
                {stage.pacingPct > 100 ? (
                  <>
                    {" "}
                    — {Math.round(stage.pacingPct)}% of target — ahead
                  </>
                ) : (
                  <>
                    {" "}
                    ({Math.round(stage.pacingPct)}%)
                  </>
                )}
              </span>
            )}
          </p>
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${barClass(stage.status)}`}
              style={{ width: `${fillPct}%` }}
            />
            <div className="absolute right-0 top-0 h-full w-px bg-foreground/60" />
          </div>
        </div>
        <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
          <p className="text-muted-foreground">Spend</p>
          <p className="mt-1 font-medium tabular-nums">
            {GBP.format(stage.spendActual)}
            {stage.spendTarget != null && ` of ${GBP.format(stage.spendTarget)} est.`}
          </p>
        </div>
      </div>
    </article>
  );
}

function pacingStatusLabel(
  status: FunnelStage["status"],
  pacingPct: number | null,
): string {
  if (status === "green" && pacingPct != null && pacingPct >= 130) {
    return "🟢🟢 EXCEEDED";
  }
  if (status === "green") return "🟢 ON TRACK";
  if (status === "amber") return "🟡 BEHIND";
  return "🔴 OFF TRACK";
}

function statusClass(status: FunnelStage["status"]): string {
  if (status === "green") return "bg-green-100 text-green-800";
  if (status === "amber") return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-800";
}

function barClass(status: FunnelStage["status"]): string {
  if (status === "green") return "bg-green-500";
  if (status === "amber") return "bg-amber-500";
  return "bg-red-500";
}
