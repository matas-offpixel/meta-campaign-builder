import {
  EVENT_FUNNEL_SEED_LABEL,
  type EventFunnelStage,
  type EventFunnelView,
  type FunnelProvenance,
} from "@/lib/dashboard/event-funnel";

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

export function EventFunnelCard({ funnel }: { funnel: EventFunnelView }) {
  return (
    <section data-testid="event-funnel" className="space-y-3">
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
    </section>
  );
}
