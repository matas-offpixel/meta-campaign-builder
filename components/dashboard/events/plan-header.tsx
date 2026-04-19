"use client";

import { useState } from "react";
import {
  ExternalLink,
  FileDown,
  FilePlus2,
  Loader2,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/dashboard/_shared/status-pill";
import { fmtDate } from "@/lib/dashboard/format";
import type { AdPlan } from "@/lib/db/ad-plans";

/**
 * Header strip for a marketing plan. Owns the local UI state for the
 * "Even spread" suggestion (idle → confirming → working) but delegates
 * the actual bulk write to the parent via onApplyEvenSpread, since the
 * parent owns the days mirror + the grid ref needed to flush pending
 * per-cell saves first.
 */
export function PlanHeader({
  plan,
  daysCount,
  onApplyEvenSpread,
}: {
  plan: AdPlan;
  daysCount: number;
  /** Resolves once the bulk save (and any quiesce wait) has settled. */
  onApplyEvenSpread: () => Promise<void>;
}) {
  const [phase, setPhase] = useState<"idle" | "confirming" | "working">("idle");

  const hasBudget = plan.total_budget != null && plan.total_budget > 0;
  const hasDays = daysCount > 0;
  const canSuggest = hasBudget && hasDays;

  const suggestTitle = !hasBudget
    ? "Set a total budget first"
    : !hasDays
      ? "No days to populate"
      : undefined;

  const handleApply = async () => {
    setPhase("working");
    try {
      await onApplyEvenSpread();
      setPhase("idle");
    } catch {
      // Parent surfaces the error banner; just return to idle.
      setPhase("idle");
    }
  };

  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-lg tracking-wide truncate">
              {plan.name}
            </h2>
            <StatusPill status={plan.status} kind="plan" />
          </div>
          <p className="text-xs text-muted-foreground">
            {fmtDate(plan.start_date)} → {fmtDate(plan.end_date)}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPhase("confirming")}
            disabled={!canSuggest || phase !== "idle"}
            title={suggestTitle}
          >
            <Wand2 className="h-3.5 w-3.5" />
            Suggest: even spread
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            title="Coming soon"
          >
            <FileDown className="h-3.5 w-3.5" />
            Open template
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled
            title="Coming soon"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            Save as template
          </Button>
        </div>
      </div>

      {phase !== "idle" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-muted-foreground">
            This will overwrite Conversion values on all{" "}
            <span className="font-medium text-foreground">{daysCount}</span>{" "}
            day{daysCount === 1 ? "" : "s"}. Continue?
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPhase("idle")}
              disabled={phase === "working"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleApply}
              disabled={phase === "working"}
            >
              {phase === "working" && (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              )}
              Apply
            </Button>
          </div>
        </div>
      )}

      <dl className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
        <Stat
          label="Total budget"
          value={
            plan.total_budget != null
              ? `£${plan.total_budget.toLocaleString()}`
              : "—"
          }
        />
        <Stat
          label="Ticket target"
          value={
            plan.ticket_target != null
              ? plan.ticket_target.toLocaleString()
              : "—"
          }
        />
        <Stat
          label="Landing page"
          value={
            plan.landing_page_url ? (
              <a
                href={plan.landing_page_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline-offset-2 hover:underline break-all"
              >
                {plan.landing_page_url}
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ) : (
              "—"
            )
          }
        />
      </dl>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm break-words">{value}</dd>
    </div>
  );
}
