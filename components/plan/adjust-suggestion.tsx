"use client";

import { InfoTip } from "@/components/viz/info-tip";
import { ADJUST_INFO_VARIANT } from "@/lib/plan/adjust-face";
import { VIZ_TYPE } from "@/lib/viz/tokens";

/**
 * The suggestion line owns its ⓘ — canvas-adjust keeps only the pace card.
 */
export function AdjustSuggestion({
  sentence,
  applyTip,
  doIt,
  notNow,
  onDoIt,
  onNotNow,
}: {
  sentence: string;
  applyTip: string | null;
  doIt: boolean;
  notNow: boolean;
  onDoIt?: () => void;
  onNotNow?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={VIZ_TYPE.body}>{sentence}</span>
      {doIt ? (
        <button type="button" className={`min-h-11 px-2 ${VIZ_TYPE.label}`} onClick={onDoIt}>
          do it
        </button>
      ) : null}
      {notNow ? (
        <button type="button" className={`min-h-11 px-2 ${VIZ_TYPE.label}`} onClick={onNotNow}>
          not now
        </button>
      ) : null}
      {applyTip ? (
        <InfoTip
          variant={ADJUST_INFO_VARIANT}
          header="SUGGESTION · NEXT OPTIMISATION CHECK"
          label={applyTip}
        />
      ) : null}
    </div>
  );
}
