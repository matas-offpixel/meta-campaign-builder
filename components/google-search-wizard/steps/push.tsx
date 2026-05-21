"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCcw,
  Rocket,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
} from "@/lib/google-search/validation";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import { updatePlan } from "@/lib/google-search/tree-mutations";
import {
  googleAdsCampaignDeepLink,
  type GoogleSearchLaunchSummary,
} from "@/lib/google-ads/campaign-writer-types";

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

type PushState =
  | { phase: "idle" }
  | { phase: "pushing" }
  | { phase: "refused"; reason: string; details?: string }
  | { phase: "complete"; summary: GoogleSearchLaunchSummary };

export function PushStep({ tree, onChange }: Props) {
  const [state, setState] = useState<PushState>({ phase: "idle" });
  const issues = validateGoogleSearchPlan(tree);
  const blocking = hasHardErrors(issues);

  const totals = {
    campaigns: tree.campaigns.length,
    adGroups: tree.campaigns.reduce((s, c) => s + c.ad_groups.length, 0),
    keywords: tree.campaigns.reduce(
      (s, c) => s + c.ad_groups.reduce((s2, ag) => s2 + ag.keywords.length, 0),
      0,
    ),
    rsas: tree.campaigns.reduce(
      (s, c) => s + c.ad_groups.reduce((s2, ag) => s2 + ag.rsas.length, 0),
      0,
    ),
    negatives:
      tree.plan_negatives.length +
      tree.campaigns.reduce((s, c) => s + c.negatives.length, 0),
  };

  async function handlePush() {
    setState({ phase: "pushing" });
    try {
      const res = await fetch(`/api/google-search/${tree.plan.id}/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await res.json().catch(() => null)) as
        | GoogleSearchLaunchSummary
        | { ok: false; reason: string; details?: string }
        | null;

      if (!json) {
        setState({
          phase: "refused",
          reason: "no_body",
          details: `Push route returned no body (HTTP ${res.status}).`,
        });
        return;
      }

      if (!json.ok && "reason" in json && !("campaignsCreated" in json)) {
        setState({ phase: "refused", reason: json.reason, details: json.details });
        return;
      }

      const summary = json as GoogleSearchLaunchSummary;
      setState({ phase: "complete", summary });
      if (summary.planStatusUpdate !== "draft") {
        onChange(
          updatePlan(tree, {
            status: summary.planStatusUpdate,
            pushed_at: new Date().toISOString(),
          }),
        );
      }
    } catch (err) {
      setState({
        phase: "refused",
        reason: "request_threw",
        details: err instanceof Error ? err.message : "Unknown error pushing.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Push to Google Ads</CardTitle>
          <CardDescription>
            Creates everything PAUSED on the linked Google Ads account so you can review in the
            Google Ads UI before going live. Campaigns auto-prefixed with the event code so the
            reporting layer picks them up.
          </CardDescription>
        </CardHeader>

        <div className="grid gap-3 sm:grid-cols-5">
          <Stat label="Campaigns" value={totals.campaigns} />
          <Stat label="Ad groups" value={totals.adGroups} />
          <Stat label="Keywords" value={totals.keywords} />
          <Stat label="RSAs" value={totals.rsas} />
          <Stat label="Negatives" value={totals.negatives} />
        </div>

        {blocking && (
          <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-2 text-xs font-medium text-destructive">
              <XCircle className="h-3.5 w-3.5" />
              {issues.filter((i) => i.severity === "error").length} hard error
              {issues.filter((i) => i.severity === "error").length === 1 ? "" : "s"} — fix in Review
              before pushing.
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3">
          <button id="gs-push-trigger" type="button" hidden onClick={handlePush}>
            Hidden push trigger
          </button>
          <Button onClick={handlePush} disabled={blocking || state.phase === "pushing"}>
            {state.phase === "pushing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : state.phase === "complete" ? (
              <RefreshCcw className="h-4 w-4" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {state.phase === "pushing"
              ? "Pushing…"
              : state.phase === "complete"
                ? "Push again (re-attempt failures)"
                : "Push to Google Ads (PAUSED)"}
          </Button>
          <span className="text-xs text-muted-foreground">
            All resources are created paused. Toggle Active in the Google Ads UI when ready.
          </span>
        </div>
      </Card>

      {state.phase === "refused" && (
        <RefusedCard reason={state.reason} details={state.details} />
      )}

      {state.phase === "complete" && (
        <ResultsCard summary={state.summary} eventCodeMissing={!tree.plan.event_id} />
      )}
    </div>
  );
}

function RefusedCard({ reason, details }: { reason: string; details?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="inline-flex items-center gap-2 text-destructive">
            <XCircle className="h-4 w-4" />
            Push refused
          </span>
        </CardTitle>
        <CardDescription>
          <span className="inline-flex items-center gap-1.5 text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" />
            {humanReason(reason)}
          </span>
        </CardDescription>
      </CardHeader>
      {details && (
        <pre className="rounded-md bg-muted p-3 text-[11px] text-muted-foreground whitespace-pre-wrap">
          {details}
        </pre>
      )}
    </Card>
  );
}

function ResultsCard({
  summary,
  eventCodeMissing,
}: {
  summary: GoogleSearchLaunchSummary;
  eventCodeMissing: boolean;
}) {
  const tone = summary.aborted
    ? "destructive"
    : summary.partialFailure
      ? "warning"
      : "success";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <StatusHeader tone={tone} />
          </CardTitle>
          <CardDescription>
            <span className="block">
              {summary.campaignsCreated.length} campaign
              {summary.campaignsCreated.length === 1 ? "" : "s"} pushed •{" "}
              {summary.adGroupsCreated.length} ad group
              {summary.adGroupsCreated.length === 1 ? "" : "s"} •{" "}
              {summary.keywordsCreated.length} keyword
              {summary.keywordsCreated.length === 1 ? "" : "s"} •{" "}
              {summary.rsasCreated.length} RSA{summary.rsasCreated.length === 1 ? "" : "s"} •{" "}
              {summary.negativesCreated.length} negative
              {summary.negativesCreated.length === 1 ? "" : "s"}.
            </span>
            <span className="mt-1 block">
              All status=PAUSED on Google Ads. Toggle Active when ready.
            </span>
            {eventCodeMissing && (
              <span className="mt-1 block text-amber-700">
                ⚠ Plan has no linked event — campaigns were pushed without the [event_code] prefix
                the reporting layer uses for scoping.
              </span>
            )}
          </CardDescription>
        </CardHeader>

        {summary.campaignsCreated.length > 0 && (
          <ul className="space-y-1.5">
            {summary.campaignsCreated.map((c) => {
              const link = googleAdsCampaignDeepLink(c.resourceName, summary.customerId);
              return (
                <li
                  key={c.localId}
                  className="flex items-start justify-between gap-3 rounded-md border border-border bg-background p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name ?? c.resourceName}</p>
                    <p className="font-mono text-[10px] text-muted-foreground truncate">
                      {c.resourceName}
                      {c.reused && <span className="ml-2 text-amber-700">already-pushed</span>}
                    </p>
                  </div>
                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border-strong px-2 py-1 text-[11px] text-foreground hover:bg-muted"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View in Google Ads
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {(summary.campaignsFailed.length > 0 ||
        summary.adGroupsFailed.length > 0 ||
        summary.keywordsFailed.length > 0 ||
        summary.negativesFailed.length > 0 ||
        summary.rsasFailed.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                Failures
              </span>
            </CardTitle>
            <CardDescription>
              Each row below failed to create on Google Ads. Re-push will re-attempt every row that
              doesn&apos;t already carry a resource name.
            </CardDescription>
          </CardHeader>
          <FailureSection title="Campaigns" rows={summary.campaignsFailed} />
          <FailureSection title="Ad groups" rows={summary.adGroupsFailed} />
          <FailureSection title="Keywords" rows={summary.keywordsFailed} />
          <FailureSection title="Negatives" rows={summary.negativesFailed} />
          <FailureSection title="RSAs" rows={summary.rsasFailed} />
        </Card>
      )}

      {(summary.budgetsRolledBack.length > 0 || summary.campaignsRolledBack.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Cleanup performed</CardTitle>
            <CardDescription>
              The adapter removed these resources after a triad-step failure so no orphans were left
              on the account.
            </CardDescription>
          </CardHeader>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {[...summary.budgetsRolledBack, ...summary.campaignsRolledBack].map((rn) => (
              <li key={rn} className="font-mono">
                {rn}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Warnings</CardTitle>
          </CardHeader>
          <ul className="space-y-1 text-xs text-amber-800">
            {summary.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StatusHeader({ tone }: { tone: "success" | "warning" | "destructive" }) {
  if (tone === "success") {
    return (
      <span className="inline-flex items-center gap-2 text-success">
        <CheckCircle2 className="h-4 w-4" />
        Pushed successfully
      </span>
    );
  }
  if (tone === "warning") {
    return (
      <span className="inline-flex items-center gap-2 text-amber-800">
        <AlertTriangle className="h-4 w-4" />
        Pushed with partial failures
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-destructive">
      <XCircle className="h-4 w-4" />
      Push aborted
    </span>
  );
}

function FailureSection({
  title,
  rows,
}: {
  title: string;
  rows: GoogleSearchLaunchSummary["campaignsFailed"];
}) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-2">
      <p className="mb-1 text-xs font-medium text-foreground">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </p>
      <ul className="space-y-0.5 pl-3 text-[11px] text-muted-foreground">
        {rows.map((r) => (
          <li key={r.localId}>
            • {r.name ?? "(unnamed)"} — <span className="text-destructive">{r.error}</span>
            {r.scope && <span className="ml-1 opacity-60">[{r.scope}]</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function humanReason(reason: string): string {
  switch (reason) {
    case "validation_failed":
      return "Validation failed — fix the hard errors in Review before pushing.";
    case "no_google_ads_account_linked":
      return "No Google Ads account linked — pick one in Plan Setup.";
    case "no_credentials_for_account":
      return "Linked account has no decrypted credentials. Reconnect via Settings → Connections.";
    case "credentials_load_failed":
      return "Could not decrypt Google Ads credentials.";
    case "plan_not_found":
      return "Plan not found (or you no longer own it).";
    case "load_failed":
      return "Failed to load the plan from the database.";
    case "writer_threw":
      return "The push adapter threw an unexpected error before completing.";
    case "request_threw":
      return "The HTTP request to the push route threw before returning.";
    case "no_body":
      return "The push route returned no response body.";
    case "unauthenticated":
      return "Sign in expired — refresh the page and try again.";
    default:
      return `Push refused: ${reason}`;
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-xl tabular-nums">{value}</p>
    </div>
  );
}
