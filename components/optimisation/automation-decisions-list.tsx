"use client";

import { Badge } from "@/components/ui/badge";
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
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Recent decisions
      </p>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading decisions…</p>
      ) : decisions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No automation decisions yet. Once the tick evaluates this published
          campaign, shadow and live rows will list here.
        </p>
      ) : (
        <ul className="space-y-2">
          {decisions.map((row, idx) => (
            <li
              key={`${row.decidedAt}-${row.action}-${idx}`}
              className={`rounded-lg border px-3 py-2 ${
                row.kind === "applied"
                  ? "border-success/40 bg-success/5"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <Badge variant={row.kind === "applied" ? "success" : "outline"}>
                  {row.kind === "applied" ? "Applied" : "Dry run"}
                </Badge>
                <Badge variant="outline">
                  {row.channel === "tiktok"
                    ? "TikTok"
                    : row.channel === "google"
                      ? "Google"
                      : "Meta"}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(row.decidedAt).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Europe/London",
                  })}
                </span>
              </div>
              <p className="text-sm">
                <span className="font-medium">{row.action || "—"}</span>
                {row.ruleMatched ? ` · ${row.ruleMatched}` : ""}
                {row.metric ? ` · ${row.metric}` : ""}
                {row.metricValue != null ? ` ${row.metricValue}` : ""}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Budget {formatPenceAsMajor(row.budgetBeforePence, sym)}
                {" → "}
                {formatPenceAsMajor(row.budgetAfterPence, sym)}
              </p>
              {row.reasonText && (
                <p className="mt-0.5 text-xs text-muted-foreground">{row.reasonText}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
