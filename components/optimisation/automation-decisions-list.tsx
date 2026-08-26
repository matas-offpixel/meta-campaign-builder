"use client";

import { ActionGlyph } from "@/components/viz/action-glyph";
import { InfoTip } from "@/components/viz/info-tip";
import { MetricChip } from "@/components/viz/metric-chip";
import { PlatformGlyph } from "@/components/viz/platform-glyph";
import { ThresholdBand } from "@/components/viz/threshold-band";
import {
  currencySymbol,
  formatPenceAsMajor,
  type DecisionRowView,
} from "@/lib/optimisation/automation-ui";

export function AutomationDecisionsList({
  decisions,
  currency,
  loading,
}: {
  decisions: DecisionRowView[];
  currency: string;
  loading: boolean;
}) {
  const sym = currencySymbol(currency);

  return (
    <div>
      {loading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No decisions yet.</p>
      ) : (
        <ul className="space-y-2">
          {decisions.map((row, idx) => {
            const delta =
              row.budgetBeforePence != null && row.budgetAfterPence != null
                ? row.budgetAfterPence - row.budgetBeforePence
                : null;
            return (
              <li
                key={`${row.decidedAt}-${row.action}-${idx}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <PlatformGlyph platform={row.channel} size="sm" />
                <ActionGlyph
                  action={row.action || "maintain"}
                  filled={row.kind === "applied"}
                />
                {row.metricValue != null ? (
                  <MetricChip label={`${row.metric || "metric"} ${row.metricValue}`}>
                    {row.metric || "cpr"} {row.metricValue}
                    {delta != null && delta !== 0
                      ? ` ${delta > 0 ? "+" : ""}${formatPenceAsMajor(delta, sym)}`
                      : ""}
                  </MetricChip>
                ) : row.action === "metric_unavailable" ? (
                  <InfoTip label={row.reasonText || "Metric unavailable"} />
                ) : null}
                <span className="min-w-24 flex-1">
                  <ThresholdBand action={row.action} currentValue={row.metricValue} size="sm" />
                </span>
                <time
                  className="text-[10px] text-muted-foreground"
                  dateTime={row.decidedAt}
                  title={row.decidedAt}
                >
                  {new Date(row.decidedAt).toLocaleString("en-GB", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Europe/London",
                  })}
                </time>
                {row.reasonText ? <InfoTip label={row.reasonText} /> : null}
                <span className="sr-only">
                  {row.kind === "applied" ? "Applied" : "Dry run"} {row.channel}{" "}
                  {row.action} {row.metricValue ?? ""} {row.reasonText}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
