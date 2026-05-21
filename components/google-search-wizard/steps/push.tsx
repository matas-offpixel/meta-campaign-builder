"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Rocket, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
} from "@/lib/google-search/validation";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import { updatePlan } from "@/lib/google-search/tree-mutations";

interface Props {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
}

type PushState =
  | { phase: "idle" }
  | { phase: "pushing" }
  | { phase: "stub_response"; reason: string; details?: string }
  | { phase: "success"; createdCampaigns: number; createdAdGroups: number; createdKeywords: number }
  | { phase: "error"; message: string };

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
        | { ok: true; createdCampaigns: number; createdAdGroups: number; createdKeywords: number }
        | { ok: false; reason: string; details?: string }
        | null;

      if (!json) {
        setState({ phase: "error", message: `Push route returned no body (HTTP ${res.status}).` });
        return;
      }

      if (!json.ok) {
        setState({ phase: "stub_response", reason: json.reason, details: json.details });
        if (json.reason !== "not_implemented") {
          onChange(updatePlan(tree, { status: tree.plan.status }));
        }
        return;
      }

      setState({
        phase: "success",
        createdCampaigns: json.createdCampaigns,
        createdAdGroups: json.createdAdGroups,
        createdKeywords: json.createdKeywords,
      });
      onChange(updatePlan(tree, { status: "pushed", pushed_at: new Date().toISOString() }));
    } catch (err) {
      setState({
        phase: "error",
        message: err instanceof Error ? err.message : "Unknown error pushing.",
      });
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Push to Google Ads</CardTitle>
          <CardDescription>
            Pushes all campaigns as PAUSED so you can review in the Google Ads UI before going live.
            The push adapter lands in Phase 3 — this step currently calls a stub.
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
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {state.phase === "pushing" ? "Pushing…" : "Push to Google Ads (PAUSED)"}
          </Button>
          <span className="text-xs text-muted-foreground">
            All resources are created paused. Toggle Active in the Google Ads UI when ready.
          </span>
        </div>
      </Card>

      {state.phase === "stub_response" && (
        <Card>
          <CardHeader>
            <CardTitle>Push response</CardTitle>
            <CardDescription>
              <span className="inline-flex items-center gap-1.5 text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {state.reason === "not_implemented"
                  ? "Phase 3 stub — the real push adapter has not landed yet."
                  : `Push refused: ${state.reason}`}
              </span>
            </CardDescription>
          </CardHeader>
          {state.details && (
            <pre className="rounded-md bg-muted p-3 text-[11px] text-muted-foreground whitespace-pre-wrap">
              {state.details}
            </pre>
          )}
        </Card>
      )}

      {state.phase === "success" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" />
                Pushed successfully
              </span>
            </CardTitle>
            <CardDescription>
              {state.createdCampaigns} campaign{state.createdCampaigns === 1 ? "" : "s"},{" "}
              {state.createdAdGroups} ad group{state.createdAdGroups === 1 ? "" : "s"},{" "}
              {state.createdKeywords} keyword{state.createdKeywords === 1 ? "" : "s"} created
              (PAUSED). Review in Google Ads before activating.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {state.phase === "error" && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="inline-flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                Push failed
              </span>
            </CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-xl tabular-nums">{value}</p>
    </div>
  );
}
