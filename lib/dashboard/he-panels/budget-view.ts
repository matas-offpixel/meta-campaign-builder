/**
 * HE6's words. The rows and the budget come from readObjectiveBudget.
 * The total is paid + sub-budgets + D2C (PH5). A credit is its own line
 * and changes only the variance. Table names stay off the page.
 */

import type { Channel, ObjectiveBudgetResult, ObjectiveRow } from "../objective-budget/types.ts";
import { periodText } from "./dates.ts";
import { count, pounds } from "./presale-view.ts";

export interface ObjectiveLine {
  objective: string;
  channel: string;
  spend: string;
  result: string;
  /** "£ / signup" and the rest. Null when the row has no cost (awareness, or no objective). */
  costLabel: string | null;
  cost: string | null;
  /** "—" on Purchase. Null on every other row, so the cell stays empty. */
  roas: string | null;
}

export interface BudgetLine {
  label: string;
  value: string;
  note: string | null;
}

export interface BudgetPanelModel {
  title: "Objective and budget";
  scope: string;
  period: string;
  rows: ObjectiveLine[];
  lines: BudgetLine[];
  /** Set when the total leaves WhatsApp out. */
  totalNote: string | null;
}

const DASH = "—";
const CHANNEL: Record<Channel, string> = { meta: "Meta", tiktok: "TikTok", google: "Google" };

function objectiveLine(row: ObjectiveRow): ObjectiveLine {
  const awareness = row.resultMetric === "reach";
  const stored = row.objective != null;
  return {
    objective: row.label,
    channel: CHANNEL[row.channel],
    spend: row.spend.value == null ? DASH : pounds(row.spend.value),
    result: !stored || awareness || row.result.value == null ? DASH : count(row.result.value),
    costLabel: awareness || !stored ? null : row.costLabel,
    cost: awareness || !stored || row.costPerResult.value == null ? null : pounds(row.costPerResult.value),
    roas: row.objective === "purchase" ? DASH : null,
  };
}

function money(value: number | null): string {
  return value == null ? DASH : pounds(value);
}

export function budgetPanel(result: ObjectiveBudgetResult, nowMs: number): BudgetPanelModel {
  const b = result.budget;
  const channels = (["meta", "tiktok", "google"] as const)
    .filter((c) => (b.paidByChannel[c].value ?? 0) > 0)
    .map((c) => `${CHANNEL[c]} ${pounds(b.paidByChannel[c].value ?? 0)}`);
  const lines: BudgetLine[] = [
    { label: "Plan", value: money(b.plan.value), note: null },
    { label: "Paid", value: money(b.paid.value), note: channels.length > 1 ? channels.join(" · ") : null },
  ];
  if (result.scope.kind === "client") {
    const brand = b.paidBrand.value ?? 0;
    lines.push({
      label: "Brand campaigns",
      value: brand > 0 ? pounds(brand) : DASH,
      note: brand > 0 ? null : "No brand campaign.",
    });
  }
  lines.push({
    label: "Credits",
    value: money(b.credits.value),
    note: b.credits.source.includes("none entered") ? "None entered. Variance only." : "Variance only.",
  });
  if (b.subBudgetLines.length) {
    for (const line of b.subBudgetLines) {
      const spent = line.spent == null ? "spent —" : `spent ${pounds(line.spent)}`;
      lines.push({ label: line.label, value: pounds(line.allocation), note: `Allocation · ${spent}` });
    }
  } else {
    lines.push({ label: "Sub-budgets", value: money(b.subBudgets.value), note: "None entered." });
  }
  lines.push({ label: "D2C", value: money(b.d2c.value), note: null });
  lines.push({ label: "Variance", value: money(b.variance.value), note: "Plan − paid + credits." });
  lines.push({ label: "Total", value: money(b.totalMarketingCreditsNotSubtracted.value), note: null });
  const excludes = b.totalExcludes.length ? `The total excludes ${b.totalExcludes.join(" and ")}.` : null;
  return {
    title: "Objective and budget",
    scope: result.scope.label,
    period: periodText(result.period.from, result.period.to, nowMs),
    rows: result.rows.map(objectiveLine),
    lines,
    totalNote: excludes,
  };
}
