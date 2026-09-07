/**
 * Reading cap for /plans and /plan/[id] only.
 * Dashboard layout itself has no max-width; those two pages (and their
 * PageHeader via an optional override) used max-w-6xl (1152px). Plan
 * canvas is a form, not a 2000px smear — 1280 keeps the zones associated.
 * Overview stays 1400px on its own class.
 */
export const PLAN_SURFACE_MAX_WIDTH_CLASS = "max-w-[1280px]";
