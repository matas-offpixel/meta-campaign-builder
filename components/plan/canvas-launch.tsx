"use client";

import { Button } from "@/components/ui/button";
import { FunnelStageBar } from "@/components/viz/funnel-stage-bar";
import { InfoTip } from "@/components/viz/info-tip";
import { joinInfoTips, type PlanLaunchButtonModel } from "@/lib/plan/canvas";
import { WIZARD_ACTIVE_VS_PLAN_PAUSED } from "@/lib/plan/schedule";
import type { EventFunnelStage } from "@/lib/dashboard/event-funnel";
import { platformSharePercents, proportionalBarWidths } from "@/lib/viz/funnel-scale";

/**
 * Zone G — can I go. One button. `Launch` is enabled only when preflight
 * has no blockers; once the platforms hold paused campaigns the same
 * button becomes `Resume n`, because launching twice is the mistake this
 * screen exists to prevent.
 *
 * The funnel stack appears only in LIVE. The tickets stage stays dashed
 * until manual entry lands — `FunnelStageBar` renders `not instrumented`
 * as a dashed outline, never a zero.
 */
export function CanvasLaunch({
  button,
  stages,
  error,
  onLaunch,
  onResumeAll,
}: {
  button: PlanLaunchButtonModel;
  stages?: EventFunnelStage[];
  error: string | null;
  onLaunch: () => void;
  onResumeAll: () => void;
}) {
  const widths = stages ? proportionalBarWidths(stages.map((stage) => stage.value)) : [];
  const tip = joinInfoTips(
    button.reason,
    button.kind === "launch" && WIZARD_ACTIVE_VS_PLAN_PAUSED,
    error,
  );

  return (
    <section aria-label="launch" className="min-h-[48px] space-y-3">
      {stages && stages.length > 0 ? (
        <div className="space-y-2">
          {stages.map((stage, index) => {
            const bar = widths[index] ?? { widthPct: 0, dashed: false };
            return (
              <FunnelStageBar
                key={stage.key}
                label={stage.label}
                valueLabel={stage.value == null ? "—" : stage.value.toLocaleString("en-GB")}
                widthPct={bar.widthPct}
                dashed={bar.dashed || stage.provenance === "not instrumented"}
                segments={
                  stage.platformSplit ? platformSharePercents(stage.platformSplit) : []
                }
                provenance={stage.provenance}
                title={stage.provenanceDetail}
              />
            );
          })}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-1.5">
        {tip ? <InfoTip label={tip} /> : null}
        {button.kind === "none" ? null : (
          <Button
            type="button"
            disabled={button.disabled}
            onClick={button.kind === "resume" ? onResumeAll : onLaunch}
          >
            {button.label}
          </Button>
        )}
      </div>
    </section>
  );
}
