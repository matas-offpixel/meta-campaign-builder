"use client";

import { CardDescription, Datum, StatusLine, StepSurfaceProvider, type StepSurface, useIsDrawer } from "@/components/steps/step-surface";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  googleAdsAccountPickerOptions,
  googlePickerStoredId,
  googleSearchEventPickerOptions,
} from "@/lib/google-ads/account-picker-options";
import {
  setPlanDefaultFinalUrl,
  updatePlan,
} from "@/lib/google-search/tree-mutations";
import {
  BIDDING_STRATEGIES,
  STRUCTURE_MODES,
  type GoogleSearchBiddingStrategy,
  type GoogleSearchStructureMode,
  type GoogleSearchPlanTree,
} from "@/lib/google-search/types";
import { collectPlanFinalUrlState } from "@/lib/google-search/final-url-state";
import { effectivePlanDailyBudget, formatPounds, inclusiveDays } from "@/lib/google-search/budget";

import type { GoogleSearchWizardContext } from "../wizard-shell";

const STRATEGY_LABELS: Record<GoogleSearchBiddingStrategy, string> = {
  maximize_clicks: "Maximise Clicks (recommended — no conversion tracking)",
  manual_cpc: "Manual CPC",
};

const STRUCTURE_MODE_LABELS: Record<GoogleSearchStructureMode, string> = {
  single_campaign: "Single campaign — C-codes as ad groups (recommended for single events)",
  campaign_per_theme: "Campaign per theme — one campaign per C-code (legacy)",
};

export function PlanSetupStep({
  tree,
  onChange,
  context,
  surface = "wizard",
}: {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
  context: GoogleSearchWizardContext;
  surface?: StepSurface;
}) {
  const plan = tree.plan;
  const planDaily = effectivePlanDailyBudget(plan);
  const planDays = inclusiveDays(plan.date_range);

  const eventOptions = [
    { value: "", label: "— no event link —" },
    ...googleSearchEventPickerOptions(context.events),
  ];

  const accountOptions = [
    { value: "", label: "— pick an account —" },
    ...googleAdsAccountPickerOptions(context.googleAdsAccounts),
  ];

  function updateField<K extends keyof typeof plan>(key: K, value: (typeof plan)[K]) {
    onChange(updatePlan(tree, { [key]: value } as Partial<typeof plan>));
  }

  function suggestNameFromEvent(eventId: string) {
    const event = context.events.find((e) => e.id === eventId);
    if (!event) return;
    const code = event.event_code ? `[${event.event_code}] ` : "";
    onChange(updatePlan(tree, { event_id: eventId, name: `${code}${event.name} Google Search` }));
  }

  return (
    <StepSurfaceProvider surface={surface}>
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Plan setup</CardTitle>
          <CardDescription>
            Pick the event, link a Google Ads account, and set the plan-wide budget envelope.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id="gs-plan-name"
            label="Plan name"
            value={plan.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="e.g. Junction 2 Melodic Google Search"
          />
          <Combobox
            label="Linked event (optional)"
            value={plan.event_id ?? ""}
            options={eventOptions}
            emptyText="No events match"
            onChange={(picked) => {
              const value = googlePickerStoredId(picked);
              if (value && !plan.name) suggestNameFromEvent(value);
              else updateField("event_id", value);
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Combobox
              label="Google Ads account"
              value={plan.google_ads_account_id ?? ""}
              options={accountOptions}
              emptyText="No accounts match"
              onChange={(picked) => updateField("google_ads_account_id", googlePickerStoredId(picked))}
            />
            {!plan.google_ads_account_id && (
              <StatusLine className="text-xs text-destructive">
                Required before push.
              </StatusLine>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              id="gs-plan-budget"
              label="Total plan budget (£)"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={plan.total_budget ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                const num = raw === "" ? null : Number(raw);
                updateField("total_budget", Number.isFinite(num) ? (num as number | null) : null);
              }}
              placeholder="e.g. 5000"
            />
            <StatusLine className="text-xs text-muted-foreground">
              {planDaily != null
                ? `≈ ${formatPounds(planDaily)}/day over ${planDays} day${planDays === 1 ? "" : "s"}`
                : "Set a total and a date range to get a daily budget."}
            </StatusLine>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Structure mode</CardTitle>
          <CardDescription>
            How C-codes map to Google Ads campaigns. This is fixed at import time — to change it,
            re-import the xlsx with the desired mode selected.
          </CardDescription>
        </CardHeader>
        <Select
          id="gs-plan-structure"
          label="Mode"
          value={plan.structure_mode}
          options={STRUCTURE_MODES.map((s) => ({ value: s, label: STRUCTURE_MODE_LABELS[s] }))}
          onChange={(e) => updateField("structure_mode", e.target.value as GoogleSearchStructureMode)}
        />
        {plan.structure_mode !== "single_campaign" && (
          <StatusLine className="mt-1 text-xs text-amber-700">
            Each C-code is a separate campaign with its own budget. More granular control, higher
            management overhead. Original behaviour.
          </StatusLine>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bidding strategy</CardTitle>
          <CardDescription>
            Without conversion tracking, Maximise Clicks is the only sane v1 choice. Manual CPC is
            available for legacy / experiment plans.
          </CardDescription>
        </CardHeader>
        <Select
          id="gs-plan-bidding"
          label="Strategy"
          value={plan.bidding_strategy}
          options={BIDDING_STRATEGIES.map((s) => ({ value: s, label: STRATEGY_LABELS[s] }))}
          onChange={(e) => updateField("bidding_strategy", e.target.value as GoogleSearchBiddingStrategy)}
        />
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default final URL</CardTitle>
          <CardDescription>
            Landing page every RSA points to (where the ad clicks land). Google Ads rejects RSAs
            without a final URL — set this once and every RSA picks it up. Override per RSA in the
            Ad Copy step if needed.
          </CardDescription>
        </CardHeader>
        {(() => {
          const finalUrl = collectPlanFinalUrlState(tree);
          const placeholder =
            finalUrl.mixed && finalUrl.missingCount === 0
              ? "Mixed — set here to overwrite every RSA"
              : "https://www.seetickets.com/event/your-event/...";
          const inputValue = finalUrl.shared ?? "";
          return (
            <div className="space-y-2">
              <Input
                id="gs-plan-default-final-url"
                label="Landing URL"
                type="url"
                inputMode="url"
                value={inputValue}
                onChange={(e) => onChange(setPlanDefaultFinalUrl(tree, e.target.value || null))}
                placeholder={placeholder}
                error={
                  finalUrl.totalRsas > 0 && finalUrl.missingCount > 0
                    ? `${finalUrl.missingCount} of ${finalUrl.totalRsas} RSA${finalUrl.totalRsas === 1 ? "" : "s"} ${finalUrl.missingCount === 1 ? "has" : "have"} no final URL — push will be blocked until set.`
                    : undefined
                }
              />
              
              {finalUrl.httpCount > 0 && (
                <StatusLine className="text-xs text-amber-700">
                  {finalUrl.httpCount} RSA{finalUrl.httpCount === 1 ? "" : "s"} use http:// —
                  Google warns about insecure landing pages. Prefer https://.
                </StatusLine>
              )}
              {finalUrl.invalidCount > 0 && (
                <StatusLine tone="alert" className="text-xs text-destructive">
                  {finalUrl.invalidCount} RSA{finalUrl.invalidCount === 1 ? "" : "s"}{" "}
                  {finalUrl.invalidCount === 1 ? "has" : "have"} a URL that doesn&apos;t start
                  with http(s):// — push will skip.
                </StatusLine>
              )}
            </div>
          );
        })()}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Date range (optional)</CardTitle>
          <CardDescription>
            Leave blank to run the campaign under its default schedule. Set both dates to bound the
            plan to an event window.
          </CardDescription>
        </CardHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            id="gs-plan-start"
            label="Start date"
            type="date"
            value={plan.date_range?.since ?? ""}
            onChange={(e) =>
              updateField("date_range", buildDateRange(plan.date_range, "since", e.target.value))
            }
          />
          <Input
            id="gs-plan-end"
            label="End date"
            type="date"
            value={plan.date_range?.until ?? ""}
            onChange={(e) =>
              updateField("date_range", buildDateRange(plan.date_range, "until", e.target.value))
            }
          />
        </div>
      </Card>
    </div>
      </StepSurfaceProvider>
  );
}

function buildDateRange(
  current: GoogleSearchPlanTree["plan"]["date_range"],
  field: "since" | "until",
  value: string,
): GoogleSearchPlanTree["plan"]["date_range"] {
  const next = { since: current?.since ?? "", until: current?.until ?? "" };
  next[field] = value;
  if (!next.since && !next.until) return null;
  return next;
}
