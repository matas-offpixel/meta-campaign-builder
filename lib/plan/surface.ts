/**
 * Reading cap for /plans and /plan/[id] only.
 * Dashboard layout itself has no max-width; those two pages (and their
 * PageHeader via an optional override) used max-w-6xl (1152px). Overview
 * already uses 1400px — same cap here so plan rows can use the leftover
 * column without changing Clients / Events / Reporting / etc.
 */
export const PLAN_SURFACE_MAX_WIDTH_CLASS = "max-w-[1400px]";
