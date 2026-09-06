"use client";

import { InfoTip } from "@/components/viz/info-tip";
import { Locked } from "@/components/viz/locked";
import { MetricChip } from "@/components/viz/metric-chip";
import {
  LEARN_CREATIVE_LOCK,
  LEARN_INFO_VARIANT,
  LEARN_NO_PREDICTION,
  LEARN_PACE_KEPT,
  LEARN_PACE_KEPT_TIP,
  LEARN_PHASE_LABEL,
  formatArchiveHeader,
  formatColumnHeads,
  formatGbp,
  formatLearnSentence,
  formatPaceHeads,
  formatPastIdentity,
  learnControlsVisible,
  learnCreativeLock,
  type CampaignPlanPrediction,
} from "@/lib/plan/learn-face";
import { VIZ_TYPE, VIZ_ZONE_GUTTER } from "@/lib/viz/tokens";

/**
 * LEARN — after close. Predicted → actual → next-time.
 * PR 3 unmerged: the prediction row is passed as a fixture-shaped prop.
 */
export function CanvasLearn({
  role = "operator",
  eventName,
  venueLabel = "NX",
  unitWord = "signup",
  prediction = null,
  actual = null,
  nextTime = null,
  nextN = 0,
  nextBand = null,
  archivedAt = null,
  identity = null,
  locked = null,
  paceDaily = 35,
  extrapolatedTitle = null,
}: {
  role?: "operator" | "client";
  eventName: string;
  venueLabel?: string;
  unitWord?: string;
  prediction?: CampaignPlanPrediction | null;
  actual?: number | null;
  nextTime?: number | null;
  nextN?: number;
  nextBand?: [number, number] | null;
  archivedAt?: Date | string | null;
  identity?: { metaName: string | null; tiktokRan: boolean; googleRan: boolean } | null;
  locked?: { days?: number; n?: number; of?: number } | null;
  paceDaily?: number;
  extrapolatedTitle?: string | null;
}) {
  const controls = learnControlsVisible(role);
  const heads = formatColumnHeads(eventName);
  const paceHeads = formatPaceHeads(eventName);
  const closed = locked == null;

  return (
    <section aria-label="learn" className={`space-y-4 ${VIZ_ZONE_GUTTER.normal}`}>
      {archivedAt ? (
        <span className={`block ${VIZ_TYPE.body}`}>{formatArchiveHeader(archivedAt)}</span>
      ) : null}
      {identity ? (
        <span className={`block ${VIZ_TYPE.body}`}>{formatPastIdentity(identity)}</span>
      ) : null}
      {extrapolatedTitle ? (
        <span className={`block ${VIZ_TYPE.label} text-muted-foreground`}>{extrapolatedTitle}</span>
      ) : null}

      {locked ? (
        <div className="space-y-2">
          <Locked
            role={role}
            reason={{
              kind: "history",
              sentence: `opens when ${eventName} closes`,
              progress: locked.days != null ? { days: locked.days } : undefined,
            }}
          >
            <span className={VIZ_TYPE.label}>Locked</span>
          </Locked>
          <Locked
            role={role}
            reason={{
              kind: "history",
              sentence: `opens after your 3rd ${venueLabel} show`,
              progress:
                locked.n != null && locked.of != null ? { n: locked.n, of: locked.of } : undefined,
            }}
          >
            <span className={VIZ_TYPE.label}>Locked</span>
          </Locked>
          <Locked
            role={role}
            reason={{ kind: "system", sentence: learnCreativeLock(role) }}
          >
            <span className={VIZ_TYPE.label}>Locked</span>
          </Locked>
        </div>
      ) : null}

      {closed ? (
        <div className="space-y-2">
          <div className={`flex flex-wrap gap-3 ${VIZ_TYPE.label} text-muted-foreground`}>
            <span>{heads.assumed}</span>
            <span>{heads.cameIn}</span>
            {controls.nextTimeColumn ? <span>{heads.next}</span> : null}
          </div>
          {prediction ? (
            <div className="flex flex-wrap items-baseline gap-3">
              <span className={VIZ_TYPE.display}>{formatGbp(prediction.value)}</span>
              {actual != null ? (
                <span className={VIZ_TYPE.display}>{formatGbp(actual)}</span>
              ) : null}
              {controls.nextTimeColumn && nextTime != null ? (
                <span className={VIZ_TYPE.display}>{formatGbp(nextTime)}</span>
              ) : null}
            </div>
          ) : (
            <span className={`block ${VIZ_TYPE.body}`}>{LEARN_NO_PREDICTION}</span>
          )}
          {prediction && actual != null && nextTime != null ? (
            <span className={`block ${VIZ_TYPE.body}`}>
              {formatLearnSentence({
                predicted: prediction.value,
                unitWord,
                n: prediction.n,
                venueLabel,
                eventName,
                actual,
                phaseLabel: LEARN_PHASE_LABEL,
                nextTime,
                nextN,
              })}
            </span>
          ) : null}
          {nextBand && controls.nextTimeColumn ? (
            <MetricChip
              label="next time"
              value={nextTime}
              benchmark={{
                value: nextTime ?? 0,
                band: nextBand,
                lineKind: "estimated",
                sentence: `from ${nextN} other shows at ${venueLabel}`,
                runsUsed: prediction?.runsUsed ?? [],
                bandWord: "your middle half",
                n: nextN,
                direction: "lower-is-better",
              }}
              infoHeader="ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND"
            />
          ) : null}
        </div>
      ) : null}

      {closed ? (
        <div className="space-y-1">
          <div className={`flex flex-wrap gap-3 ${VIZ_TYPE.label} text-muted-foreground`}>
            <span>{paceHeads.plan}</span>
            <span>{paceHeads.spent}</span>
            {controls.nextTimeColumn ? <span>{paceHeads.next}</span> : null}
          </div>
          <span className={VIZ_TYPE.body}>{LEARN_PACE_KEPT}</span>
          <InfoTip variant={LEARN_INFO_VARIANT} label={`${LEARN_PACE_KEPT_TIP} · ${formatGbp(paceDaily)} per day`} />
        </div>
      ) : null}

      {closed ? (
        <Locked role={role} reason={{ kind: "system", sentence: LEARN_CREATIVE_LOCK }}>
          <span className={VIZ_TYPE.label}>Locked</span>
        </Locked>
      ) : null}
    </section>
  );
}
