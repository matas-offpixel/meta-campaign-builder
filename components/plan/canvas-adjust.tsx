"use client";

import { InfoTip } from "@/components/viz/info-tip";
import { Locked } from "@/components/viz/locked";
import { MetricChip } from "@/components/viz/metric-chip";
import { WindowBar } from "@/components/viz/window-bar";
import {
  ADJUST_INFO_VARIANT,
  ADJUST_LOG_TITLE,
  ADJUST_PLACEMENT_EMPTY,
  adjustControlsVisible,
  adjustFaceView,
  formatLogDid,
  formatLeftAlone,
  formatRefusal,
  formatUndoUntil,
  logDayHeading,
  nextCheckClock,
  type AdjustChannelRead,
  type AdjustDecisionRow,
} from "@/lib/plan/adjust-face";
import type { MetricChipBenchmark } from "@/lib/viz/metric-chip";
import { VIZ_TICKET_LINE_WORD, VIZ_TYPE, VIZ_TYPE_NUM, VIZ_ZONE_GUTTER } from "@/lib/viz/tokens";
import type { WindowMoment } from "@/lib/viz/window-bar";

/**
 * ADJUST — the morning read. Four exhibits, then the log.
 * Decisions sheet stays on `N changes ▸`.
 */
export function CanvasAdjust({
  role = "operator",
  spent = 0,
  planned = 0,
  unitWord = "signup",
  benchmark,
  suggestionUsual,
  writeGates = { writesEnabled: false, enabled: false, live: false },
  channels = [],
  placementsEmpty = true,
  metaSignups = null,
  tagDomain = null,
  metaPurchases = null,
  tickets = null,
  ticketSource = "none",
  funnelLifetimeTip = null,
  decisions = [],
  moments,
  start,
  end,
  endSet = true,
  launchedAt = null,
  venueName = null,
  generalSaleAt = null,
  lastCreativeSnapshotAt = null,
  trend = null,
  reach = null,
  clicks = null,
  pageViews = null,
  now,
  onWindowChange,
  onDoIt,
  onNotNow,
  onUndo,
}: {
  role?: "operator" | "client";
  spent?: number;
  planned?: number;
  unitWord?: string;
  benchmark?: MetricChipBenchmark;
  suggestionUsual?: number | null;
  writeGates?: { writesEnabled: boolean; enabled: boolean; live: boolean };
  channels?: AdjustChannelRead[];
  placementsEmpty?: boolean;
  metaSignups?: number | null;
  tagDomain?: string | null;
  metaPurchases?: number | null;
  tickets?: number | null;
  ticketSource?: keyof typeof VIZ_TICKET_LINE_WORD;
  funnelLifetimeTip?: string | null;
  decisions?: AdjustDecisionRow[];
  moments?: WindowMoment[];
  start?: Date;
  end?: Date;
  endSet?: boolean;
  launchedAt?: string | null;
  venueName?: string | null;
  generalSaleAt?: string | Date | null;
  lastCreativeSnapshotAt?: string | null;
  trend?: number[] | null;
  reach?: number | null;
  clicks?: number | null;
  pageViews?: number | null;
  now?: Date;
  onWindowChange?: (next: { start: Date; end: Date }) => void;
  onDoIt?: () => void;
  onNotNow?: () => void;
  onUndo?: () => void;
}) {
  const face = adjustFaceView({
    role,
    spent,
    planned,
    metaSignups,
    metaPurchases,
    tickets,
    ticketSource,
    venueName,
    launchedAt,
    now,
    generalSaleAt,
    benchmark: suggestionUsual != null && !benchmark
      ? undefined
      : benchmark,
    decisions,
    writeGates,
    operatorApplyPath: false,
    channels,
    reach,
    clicks,
    pageViews,
    tagDomain,
    lastCreativeSnapshotAt,
    trend,
    endSet,
    windowStart: start,
    unitWord,
  });
  const controls = adjustControlsVisible(role);
  const nextCheck = nextCheckClock(now);
  const tipParts = [face.paceSentence, funnelLifetimeTip, face.applyTip].filter(Boolean);
  const windowStart = face.windowStart ?? start;

  return (
    <section aria-label="adjust" className={`space-y-4 ${VIZ_ZONE_GUTTER.normal}`}>
      <div className="space-y-1.5">
        {moments && windowStart && end ? (
          <WindowBar
            moments={moments}
            start={windowStart}
            end={end}
            now={now ?? new Date()}
            empty={face.windowEmpty}
            emptyLabel="end not set"
            endLabel={face.endLabel}
            onChange={onWindowChange ?? (() => undefined)}
            pace={
              planned > 0
                ? {
                    spent,
                    planned,
                    currency: "GBP",
                    lineKind: "measured",
                    tone: face.paceTone,
                  }
                : undefined
            }
          />
        ) : null}
        <span className={`block ${VIZ_TYPE.body}`}>{face.paceSentence}</span>
        <InfoTip variant={ADJUST_INFO_VARIANT} label={tipParts.join(" · ")} />
      </div>

      <div className="flex flex-wrap items-start gap-4 max-md:flex max-md:flex-col">
        {face.signupLine ? (
          <MetricChip
            label="cost per signup"
            value={face.signupCost}
            benchmark={benchmark}
            phaseLabel={face.signupPhaseLabel}
            trend={face.trend}
            lineKind={face.lineKind}
            direction={benchmark?.direction}
            infoHeader={face.infoHeader}
          >
            <span className={VIZ_TYPE.display}>{face.signupLine}</span>
          </MetricChip>
        ) : (
          <MetricChip
            label="cost per signup"
            value={null}
            emptySentence={face.paceSentence}
            lineKind="not-yet"
            infoHeader={face.infoHeader}
          />
        )}
        {face.purchaseLine ? (
          <MetricChip
            label="cost per purchase"
            value={face.purchaseCost}
            lineKind="measured"
            infoHeader={face.purchaseInfoHeader}
          >
            <span className={VIZ_TYPE.display}>{face.purchaseLine}</span>
          </MetricChip>
        ) : null}
        {face.noUsual && face.signupLine ? (
          <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{face.noUsual}</span>
        ) : null}
      </div>

      {face.suggestionSentence ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={VIZ_TYPE.body}>{face.suggestionSentence}</span>
          {face.doIt ? (
            <button type="button" className={`min-h-11 px-2 ${VIZ_TYPE.label}`} onClick={onDoIt}>
              do it
            </button>
          ) : null}
          {face.notNow ? (
            <button type="button" className={`min-h-11 px-2 ${VIZ_TYPE.label}`} onClick={onNotNow}>
              not now
            </button>
          ) : null}
        </div>
      ) : null}

      {face.earnedNothingSentence ? (
        <span className={`block ${VIZ_TYPE.body}`}>{face.earnedNothingSentence}</span>
      ) : null}

      <div className="space-y-1">
        {face.channelLines.map((line) => (
          <span key={line} className={`block ${VIZ_TYPE_NUM.body}`}>
            {line}
          </span>
        ))}
        <Locked
          role={role}
          reason={{
            kind: "system",
            sentence: face.creativeSentence,
          }}
        >
          <span className={`block ${VIZ_TYPE.label} text-foreground/35`} aria-hidden="true">
            by creative name
          </span>
          <span className="mt-1 block h-2 w-24 bg-foreground/10" aria-hidden="true" />
        </Locked>
        {placementsEmpty ? (
          <span className={`block ${VIZ_TYPE.label} text-muted-foreground`}>{ADJUST_PLACEMENT_EMPTY}</span>
        ) : null}
      </div>

      <div className="space-y-1 max-md:flex max-md:flex-col">
        {face.stageLines.map((line) => (
          <span key={line} className={`block ${VIZ_TYPE_NUM.body}`}>
            {line}
          </span>
        ))}
        {face.purchaseDisagreement ? (
          <span className={`block ${VIZ_TYPE_NUM.body}`}>{face.purchaseDisagreement}</span>
        ) : null}
      </div>

      <div className="space-y-2">
        <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{ADJUST_LOG_TITLE}</span>
        {face.logDays.length === 0 ? (
          <span className={`block ${VIZ_TYPE.body}`}>{face.logEmpty}</span>
        ) : (
          face.logDays.map((day) => (
            <div key={day.at} className="space-y-1">
              <span className={`${VIZ_TYPE.label}`}>{logDayHeading(day.at)}</span>
              {day.rows.map((row, index) => (
                <div key={`${day.at}-${index}`} className="flex flex-wrap items-center gap-1.5">
                  <span className={VIZ_TYPE.body}>
                    {row.kind === "did"
                      ? formatLogDid(row)
                      : row.kind === "refusal"
                        ? formatRefusal(row.adSetName, row.needed, row.have, row.unitWord)
                        : formatLeftAlone(row.count)}
                  </span>
                  {row.kind === "did" && row.undo && controls.undo ? (
                    <button type="button" className={`min-h-11 ${VIZ_TYPE.label}`} onClick={onUndo}>
                      {formatUndoUntil(nextCheck)}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
