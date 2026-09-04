"use client";

import { useMemo } from "react";

import { WindowBar } from "@/components/viz/window-bar";
import { PLAN_CANVAS_COPY } from "@/lib/plan/canvas";
import {
  planWindowFromHandles,
  planWindowHandles,
  planWindowMoments,
  type PlanWindowDates,
  type PlanWindowEvent,
} from "@/lib/plan/canvas-inputs";
import { GOOGLE_DATE_ONLY_NOTE } from "@/lib/plan/schedule";

/**
 * Zone B — when does this run, and against what. The moments come off the
 * event and are not editable; only the two handles are. That is why the
 * two datetime fields and the Now / end chips are gone: the chips were
 * shortcuts to moments the bar now shows directly.
 */
export function CanvasWindow({
  event,
  dates,
  onChange,
  googleBudgeted,
  now,
}: {
  event: PlanWindowEvent | null;
  dates: PlanWindowDates;
  onChange: (next: PlanWindowDates) => void;
  googleBudgeted: boolean;
  now?: Date;
}) {
  const clock = useMemo(() => now ?? new Date(), [now]);
  const moments = useMemo(() => planWindowMoments(event, clock), [event, clock]);
  const handles = useMemo(() => planWindowHandles(dates, event, clock), [dates, event, clock]);

  return (
    <section aria-label="window" className="min-h-[64px]">
      <WindowBar
        moments={moments}
        start={handles.start}
        end={handles.end}
        min={clock}
        now={clock}
        tip={googleBudgeted ? GOOGLE_DATE_ONLY_NOTE : PLAN_CANVAS_COPY.window}
        onChange={(next) => onChange(planWindowFromHandles(next))}
      />
    </section>
  );
}
