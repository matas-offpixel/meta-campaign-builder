"use client";

import { useInsightsRail } from "@/components/insights-rail/rail-context";

/**
 * The 393 rest state (R11, IR7): a pill in the page header row, never
 * floating, so it can't cover a sticky primary action. Pages put it in
 * their header's actions. Hidden from 768 up, where the tab is the rest
 * state.
 */
export function InsightsPill() {
  const { operator, open, setOpen } = useInsightsRail();
  if (!operator) return null;
  return (
    <button
      type="button"
      data-insights-pill
      className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border-strong bg-card px-2.5 text-xs font-medium md:hidden"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
    >
      Insights <span aria-hidden>‹</span>
    </button>
  );
}
