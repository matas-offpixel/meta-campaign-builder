import type { PlanPreflightIssue } from "./preflight.ts";

export type BlockerFixSurface = "plan" | "wizard";

/**
 * Fields the /plan page actually owns: event, destination URL, dates,
 * per-platform budget split, name. Everything else — ad accounts, pages,
 * identities, pixels, creatives, keywords — belongs to the platform wizard,
 * which is the authoring surface. A blocker routed to the wizard is shown
 * next to the Prepare/Continue button so it reads as a next step, not a wall.
 */
const PLAN_OWNED_PATTERNS = [
  /budget/i,
  /^schedule/i,
  /date/i,
  /landing_page_url/i,
  /final_url/i,
  /destination/i,
  /^event(_id)?$/i,
  /campaign_name/i,
  /plan_name/i,
  /^name$/i,
];

/**
 * Budget allocation and currency findings mention "budget" but are resolved
 * inside the platform wizard's own budget structure, not the plan's split.
 */
const WIZARD_OVERRIDE_PATTERNS = [
  /budget_over_allocated/i,
  /budget_under_allocated/i,
  /budget-currency/i,
];

export function blockerFixSurface(issue: PlanPreflightIssue): BlockerFixSurface {
  const matches = (pattern: RegExp): boolean =>
    pattern.test(issue.field ?? "") || pattern.test(issue.id ?? "");
  if (WIZARD_OVERRIDE_PATTERNS.some(matches)) return "wizard";
  return PLAN_OWNED_PATTERNS.some(matches) ? "plan" : "wizard";
}

export interface SplitPlanBlockers {
  /** Blocking issues the operator fixes in the platform wizard. */
  wizard: PlanPreflightIssue[];
  /** Blocking issues the operator fixes in the shared inputs on this page. */
  plan: PlanPreflightIssue[];
  /** Non-blocking notes (skipped adapters, warnings). */
  notes: PlanPreflightIssue[];
}

export function splitPlanBlockers(
  issues: PlanPreflightIssue[],
  adapter: PlanPreflightIssue["adapter"],
): SplitPlanBlockers {
  const mine = issues.filter((issue) => issue.adapter === adapter);
  const blocking = mine.filter((issue) => issue.blocking);
  return {
    wizard: blocking.filter((issue) => blockerFixSurface(issue) === "wizard"),
    plan: blocking.filter((issue) => blockerFixSurface(issue) === "plan"),
    notes: mine.filter((issue) => !issue.blocking),
  };
}
