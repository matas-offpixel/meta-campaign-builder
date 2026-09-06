"use client";

import { InfoTip } from "@/components/viz/info-tip";
import { Locked } from "@/components/viz/locked";
import { MetricChip } from "@/components/viz/metric-chip";
import { WindowBar } from "@/components/viz/window-bar";
import {
  ADJUST_INFO_VARIANT,
  ADJUST_LOG_EMPTY,
  ADJUST_LOG_TITLE,
  ADJUST_NO_READS,
  ADJUST_NO_USUAL,
  ADJUST_PHASE_LABEL,
  ADJUST_PLACEMENT_EMPTY,
  adjustControlsVisible,
  formatAgainstUsual,
  formatChannelEarnedNothing,
  formatCreativeLocked,
  formatLeftAlone,
  formatLogDid,
  formatMetaSays,
  formatOurTagNotMeasured,
  formatPaceSums,
  formatPurchaseDisagreement,
  formatRefusal,
  formatSuggestion,
  formatTicketLine,
  formatCostPerUnit,
  formatUndoUntil,
  logDayHeading,
  nextCheckClock,
  type AdjustLogDay,
} from "@/lib/plan/adjust-face";
import type { MetricChipBenchmark } from "@/lib/viz/metric-chip";
import { VIZ_TYPE, VIZ_TYPE_NUM, VIZ_ZONE_GUTTER } from "@/lib/viz/tokens";
import type { WindowMoment } from "@/lib/viz/window-bar";

/**
 * ADJUST — the morning read. Four exhibits, then the log.
 * Decisions sheet stays on `N changes ▸`.
 */
export function CanvasAdjust({
  role = "operator",
  spent = 0,
  planned = 0,
  cost = null,
  unitWord = "signup",
  benchmark,
  phaseKept = false,
  suggestion = null,
  writeGatesOpen = false,
  earnedNothing = null,
  channels = [],
  placementsEmpty = true,
  metaSignups = null,
  tagDomain = null,
  metaPurchases = null,
  tickets = null,
  ticketSource = "none",
  funnelLifetimeTip = null,
  logDays = [],
  moments,
  start,
  end,
  endSet = true,
  onWindowChange,
  onDoIt,
  onNotNow,
  onUndo,
}: {
  role?: "operator" | "client";
  spent?: number;
  planned?: number;
  cost?: number | null;
  unitWord?: string;
  benchmark?: MetricChipBenchmark;
  phaseKept?: boolean;
  suggestion?: {
    action: "scale_up" | "scale_down" | "pause";
    adSetName: string;
    deltaPercent: number;
    cost: number;
    usual: number;
    results: number;
    windowWord: string;
  } | null;
  writeGatesOpen?: boolean;
  earnedNothing?: { channel: string; spend: number; spendSharePct: number } | null;
  channels?: Array<{ name: string; resultShare: number | null; spendShare: number | null }>;
  placementsEmpty?: boolean;
  metaSignups?: number | null;
  tagDomain?: string | null;
  metaPurchases?: number | null;
  tickets?: number | null;
  ticketSource?: "manual" | "xlsx_import" | "eventbrite" | "fourthefans" | "none" | "unknown";
  funnelLifetimeTip?: string | null;
  logDays?: AdjustLogDay[];
  moments?: WindowMoment[];
  start?: Date;
  end?: Date;
  endSet?: boolean;
  onWindowChange?: (next: { start: Date; end: Date }) => void;
  onDoIt?: () => void;
  onNotNow?: () => void;
  onUndo?: () => void;
}) {
  const controls = adjustControlsVisible(role);
  const nextCheck = nextCheckClock();
  const noReads = cost == null && spent <= 0;
  const paceSentence = noReads ? ADJUST_NO_READS : formatPaceSums(spent, planned);
  const tipLabel = funnelLifetimeTip ? `${paceSentence} · ${funnelLifetimeTip}` : paceSentence;

  return (
    <section aria-label="adjust" className={`space-y-4 ${VIZ_ZONE_GUTTER.normal}`}>
      <div className="space-y-1.5">
        {moments && start && end ? (
          <WindowBar
            moments={moments}
            start={start}
            end={end}
            now={new Date()}
            empty={!endSet}
            emptyLabel="end not set"
            onChange={onWindowChange ?? (() => undefined)}
            pace={
              planned > 0
                ? { spent, planned, currency: "GBP", lineKind: "measured", tone: spent > planned ? "below" : "above" }
                : undefined
            }
          />
        ) : null}
        <span className={`block ${VIZ_TYPE.body}`}>{paceSentence}</span>
        <InfoTip variant={ADJUST_INFO_VARIANT} label={tipLabel} />
      </div>

      <div className="max-md:flex max-md:flex-col">
        <MetricChip
          label={`cost per ${unitWord}`}
          value={cost}
          benchmark={benchmark}
          phaseLabel={phaseKept ? ADJUST_PHASE_LABEL : undefined}
          emptySentence={noReads ? ADJUST_NO_READS : !benchmark ? ADJUST_NO_USUAL : undefined}
          lineKind={benchmark ? benchmark.lineKind : "estimated"}
          direction={benchmark?.direction}
          infoHeader="ESTIMATED · META'S SIGNUP COUNT, YOUR SPEND"
        >
          {cost != null ? (
            <span className={VIZ_TYPE.display}>
              {benchmark
                ? formatAgainstUsual(cost, unitWord, benchmark.value)
                : formatCostPerUnit(cost, unitWord)}
            </span>
          ) : null}
        </MetricChip>
        {!benchmark && cost != null ? (
          <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{ADJUST_NO_USUAL}</span>
        ) : null}
      </div>

      {controls.suggestion && suggestion ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={VIZ_TYPE.body}>
            {formatSuggestion({ ...suggestion, unitWord })}
          </span>
          {writeGatesOpen && controls.doIt ? (
            <button type="button" className={`min-h-11 px-2 ${VIZ_TYPE.label}`} onClick={onDoIt}>
              do it
            </button>
          ) : null}
          {writeGatesOpen && controls.notNow ? (
            <button type="button" className={`min-h-11 px-2 ${VIZ_TYPE.label}`} onClick={onNotNow}>
              not now
            </button>
          ) : null}
        </div>
      ) : null}

      {earnedNothing ? (
        <span className={`block ${VIZ_TYPE.body}`}>
          {formatChannelEarnedNothing({ ...earnedNothing, unitWord })}
        </span>
      ) : null}

      <div className="space-y-1">
        {channels.map((channel) => (
          <span key={channel.name} className={`block ${VIZ_TYPE_NUM.body}`}>
            {channel.name}
            {channel.resultShare == null || channel.spendShare == null
              ? " · —"
              : ` · ${channel.resultShare}% of results · ${channel.spendShare}% of spend`}
          </span>
        ))}
        <Locked
          role={role}
          reason={{
            kind: "system",
            sentence: formatCreativeLocked(role),
          }}
        >
          <span className={VIZ_TYPE.label}>Locked</span>
        </Locked>
        {placementsEmpty ? (
          <span className={`block ${VIZ_TYPE.label} text-muted-foreground`}>{ADJUST_PLACEMENT_EMPTY}</span>
        ) : null}
      </div>

      <div className="space-y-1 max-md:flex max-md:flex-col">
        {metaSignups != null ? (
          <span className={`block ${VIZ_TYPE_NUM.body}`}>{formatMetaSays(metaSignups, "signups")}</span>
        ) : null}
        {tagDomain ? (
          <span className={`block ${VIZ_TYPE.body} text-muted-foreground`}>
            {formatOurTagNotMeasured(tagDomain)}
          </span>
        ) : null}
        {metaPurchases != null && tickets != null ? (
          <span className={`block ${VIZ_TYPE_NUM.body}`}>
            {formatPurchaseDisagreement({ metaPurchases, tickets })}
          </span>
        ) : null}
        <span className={`block ${VIZ_TYPE.body}`}>{formatTicketLine(ticketSource, tickets ?? undefined)}</span>
      </div>

      <div className="space-y-2">
        <span className={`${VIZ_TYPE.label} text-muted-foreground`}>{ADJUST_LOG_TITLE}</span>
        {logDays.length === 0 ? (
          <span className={`block ${VIZ_TYPE.body}`}>{ADJUST_LOG_EMPTY}</span>
        ) : (
          logDays.map((day) => (
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
