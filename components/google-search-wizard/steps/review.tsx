"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
  type GoogleSearchValidationIssue,
  type GoogleSearchWizardStep,
} from "@/lib/google-search/validation";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";

interface Props {
  tree: GoogleSearchPlanTree;
  onGoToStep: (step: GoogleSearchWizardStep) => void;
}

export function ReviewStep({ tree, onGoToStep }: Props) {
  const issues = validateGoogleSearchPlan(tree);
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const blocking = hasHardErrors(issues);

  const totals = computeTotals(tree);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>
            One pre-push checklist. Hard errors block push; warnings flag concerns to fix before
            launch.
          </CardDescription>
        </CardHeader>

        <div data-testid="gs-review-summary" className="grid gap-3 sm:grid-cols-3">
          <SummaryCard label="Campaigns" value={totals.campaigns} />
          <SummaryCard label="Ad groups" value={totals.adGroups} />
          <SummaryCard label="Keywords" value={totals.keywords} />
          <SummaryCard label="Negatives (shared)" value={totals.planNegatives} />
          <SummaryCard label="Negatives (campaign)" value={totals.campaignNegatives} />
          <SummaryCard label="RSAs" value={totals.rsas} />
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Budget: £{(tree.plan.total_budget ?? 0).toFixed(2)} total • £{totals.allocated.toFixed(2)}{" "}
          allocated to {totals.campaigns} campaign{totals.campaigns === 1 ? "" : "s"}.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Validation</CardTitle>
              <CardDescription>
                {blocking
                  ? `${errors.length} hard error${errors.length === 1 ? "" : "s"} — push is blocked.`
                  : warnings.length > 0
                    ? `Push is allowed. ${warnings.length} warning${warnings.length === 1 ? "" : "s"} to consider.`
                    : "All clear — ready to push."}
              </CardDescription>
            </div>
            <StatusPill blocking={blocking} warningCount={warnings.length} />
          </div>
        </CardHeader>

        {errors.length === 0 && warnings.length === 0 ? (
          <p data-testid="gs-validation-empty" className="flex items-center gap-2 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            No issues detected.
          </p>
        ) : (
          <div data-testid="gs-validation-panel" className="space-y-3">
            {errors.length > 0 && (
              <IssueList
                title={`Hard errors (${errors.length})`}
                issues={errors}
                tone="error"
                onJump={onGoToStep}
              />
            )}
            {warnings.length > 0 && (
              <IssueList
                title={`Warnings (${warnings.length})`}
                issues={warnings}
                tone="warning"
                onJump={onGoToStep}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-xl tabular-nums">{value}</p>
    </div>
  );
}

function StatusPill({ blocking, warningCount }: { blocking: boolean; warningCount: number }) {
  if (blocking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-1 text-xs font-medium text-destructive">
        <XCircle className="h-3.5 w-3.5" />
        Blocked
      </span>
    );
  }
  if (warningCount > 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
        <AlertTriangle className="h-3.5 w-3.5" />
        Warnings
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-900">
      <CheckCircle2 className="h-3.5 w-3.5" />
      Ready
    </span>
  );
}

function IssueList({
  title,
  issues,
  tone,
  onJump,
}: {
  title: string;
  issues: GoogleSearchValidationIssue[];
  tone: "error" | "warning";
  onJump: (step: GoogleSearchWizardStep) => void;
}) {
  const palette =
    tone === "error"
      ? "border-destructive/20 bg-destructive/5 text-destructive"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <section className={`rounded-md border ${palette} p-3`}>
      <p className="mb-2 text-xs font-medium uppercase tracking-wider">{title}</p>
      <ul className="space-y-1.5">
        {issues.map((issue, i) => (
          <li key={`${issue.code}-${i}`} className="flex items-start gap-2 text-xs">
            <span className="select-none">{tone === "error" ? "•" : "⚠"}</span>
            <div className="flex-1">
              <p>{issue.message}</p>
              {issue.scope && (
                <p className="mt-0.5 text-[10px] uppercase tracking-wide opacity-60">
                  {issue.scope}
                </p>
              )}
            </div>
            {jumpStep(issue.code) !== null && (
              <button
                type="button"
                onClick={() => onJump(jumpStep(issue.code) as GoogleSearchWizardStep)}
                className="rounded-md border border-current/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide hover:bg-current/10"
              >
                fix
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function jumpStep(code: string): GoogleSearchWizardStep | null {
  if (code === "plan_name_missing" || code === "google_ads_account_missing") return 0;
  if (code === "no_campaigns" || code === "campaign_name_missing") return 1;
  if (code === "campaign_no_ad_groups" || code === "campaign_no_keywords") return 2;
  if (
    code === "rsa_too_few_headlines" ||
    code === "rsa_too_few_descriptions" ||
    code === "headline_too_long" ||
    code === "description_too_long" ||
    code === "ad_group_no_rsa"
  )
    return 4;
  if (code === "budget_over_allocated" || code === "budget_under_allocated") return 5;
  if (code === "campaign_no_negatives" || code === "keyword_cannibalised_by_negative") return 3;
  return null;
}

function computeTotals(tree: GoogleSearchPlanTree) {
  const campaigns = tree.campaigns.length;
  let adGroups = 0;
  let keywords = 0;
  let rsas = 0;
  let campaignNegatives = 0;
  let allocated = 0;
  for (const c of tree.campaigns) {
    allocated += c.monthly_budget ?? 0;
    campaignNegatives += c.negatives.length;
    adGroups += c.ad_groups.length;
    for (const ag of c.ad_groups) {
      keywords += ag.keywords.length;
      rsas += ag.rsas.length;
    }
  }
  return {
    campaigns,
    adGroups,
    keywords,
    rsas,
    planNegatives: tree.plan_negatives.length,
    campaignNegatives,
    allocated,
  };
}
