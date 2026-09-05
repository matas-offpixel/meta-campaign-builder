"use client";

import { useMemo } from "react";

import { WindowBar } from "@/components/viz/window-bar";
import { PLAN_CANVAS_COPY } from "@/lib/plan/canvas";
import { WINDOW_BAR_HEIGHT_PX } from "@/lib/viz/window-bar";
import {
  planDefaultWindow,
  planWindowFromHandles,
  planWindowHandles,
  planWindowMoments,
  planWindowValidity,
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
  createdAt,
}: {
  event: PlanWindowEvent | null;
  dates: PlanWindowDates;
  onChange: (next: PlanWindowDates) => void;
  googleBudgeted: boolean;
  now?: Date;
  createdAt?: Date | string | null;
}) {
  const clock = useMemo(() => now ?? new Date(), [now]);
  const moments = useMemo(() => planWindowMoments(event, clock), [event, clock]);
  const validity = useMemo(
    () => planWindowValidity(dates, event, { now: clock, createdAt }),
    [dates, event, clock, createdAt],
  );
  const handles = useMemo(() => {
    if (validity.ok) return planWindowHandles(dates, event, clock);
    const fallback = planDefaultWindow(event, clock);
    return planWindowHandles(fallback, event, clock);
  }, [dates, event, clock, validity.ok]);

  return (
    <section aria-label="window" style={{ minHeight: WINDOW_BAR_HEIGHT_PX }}>
      <WindowBar
        moments={moments}
        start={handles.start}
        end={handles.end}
        min={clock}
        now={clock}
        empty={!validity.ok}
        emptyLabel={PLAN_CANVAS_COPY.windowUnset}
        tip={googleBudgeted ? GOOGLE_DATE_ONLY_NOTE : PLAN_CANVAS_COPY.window}
        onChange={(next) => onChange(planWindowFromHandles(next))}
      />
    </section>
  );
}
