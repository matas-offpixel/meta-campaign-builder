/**
 * HE6's words. The rows and the budget come from readObjectiveBudget.
 * The total is paid + sub-budgets + D2C (PH5). A credit is its own line
 * and changes only the variance. Table names stay off the page.
 */

import type { BudgetPicture, Channel, ObjectiveBudgetResult, ObjectiveRow, SubBudgetLine } from "../objective-budget/types.ts";
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

/** A season budget's source names a label, not who entered it or when. */
function planNote(source: string): string | null {
  if (source.startsWith("Season budget")) return "Season budget";
  if (source.includes("budget_marketing") || source.includes("additional_spend")) return "Show budgets";
  return null;
}

function creditNote(source: string): string {
  const standing = "Changes the variance, not the total.";
  if (source.includes("none entered") || source.includes("isn't applied")) return `None entered. ${standing}`;
  const named = source.split("entered: ")[1]?.trim();
  return named ? `${named}. ${standing}` : standing;
}

/** The figure is what the total counts: spent where it is entered, otherwise the allocation. */
function subBudgetRow(line: SubBudgetLine): BudgetLine {
  if (line.spent == null) {
    return { label: line.label, value: pounds(line.allocation), note: "Allocation. Spend not entered yet." };
  }
  return { label: line.label, value: pounds(line.spent), note: `Spent, of a ${pounds(line.allocation)} allocation.` };
}

/** A source line only when the builder counted both parts. Empty D2C stays blank. */
function d2cNote(parts: BudgetPicture["d2cParts"]): string | null {
  const whatsapp = parts.whatsapp;
  const sms = parts.sms.value ?? 0;
  if ((whatsapp.value ?? 0) > 0 && sms > 0 && whatsapp.source.includes("delivered")) {
    return "WhatsApp delivered × rate, plus SMS";
  }
  return null;
}

export function budgetPanel(result: ObjectiveBudgetResult, nowMs: number): BudgetPanelModel {
  const b = result.budget;
  const channels = (["meta", "tiktok", "google"] as const)
    .filter((c) => (b.paidByChannel[c].value ?? 0) > 0)
    .map((c) => `${CHANNEL[c]} ${pounds(b.paidByChannel[c].value ?? 0)}`);
  const lines: BudgetLine[] = [
    { label: "Plan", value: money(b.plan.value), note: planNote(b.plan.source) },
    { label: "Paid", value: money(b.paid.value), note: channels.length > 1 ? channels.join(" · ") : null },
  ];
  if (result.scope.kind === "client") {
    const brand = b.paidBrand.value ?? 0;
    lines.push({
      label: "Brand campaigns",
      value: brand > 0 ? pounds(brand) : DASH,
      note: brand > 0 ? "Included in paid." : "No brand campaign.",
    });
  }
  const creditsEmpty = b.credits.source.includes("none entered") || b.credits.source.includes("isn't applied");
  lines.push({
    label: "Credits",
    value: creditsEmpty ? DASH : money(b.credits.value),
    note: creditNote(b.credits.source),
  });
  if (b.subBudgetLines.length) {
    for (const line of b.subBudgetLines) lines.push(subBudgetRow(line));
  } else {
    const subsEmpty = b.subBudgets.source.includes("none entered") || b.subBudgets.source.includes("isn't applied");
    lines.push({ label: "Sub-budgets", value: subsEmpty ? DASH : money(b.subBudgets.value), note: subsEmpty ? "None entered." : null });
  }
  lines.push({ label: "D2C", value: money(b.d2c.value), note: d2cNote(b.d2cParts) });
  lines.push({ label: "Variance", value: money(b.variance.value), note: "Plan − paid + credits." });
  lines.push({ label: "Total", value: money(b.totalMarketing.value), note: "Paid + sub-budgets + D2C." });
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
