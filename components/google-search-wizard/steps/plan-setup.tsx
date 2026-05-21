"use client";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updatePlan } from "@/lib/google-search/tree-mutations";
import {
  BIDDING_STRATEGIES,
  type GoogleSearchBiddingStrategy,
  type GoogleSearchPlanTree,
} from "@/lib/google-search/types";

import type { GoogleSearchWizardContext } from "../wizard-shell";

const STRATEGY_LABELS: Record<GoogleSearchBiddingStrategy, string> = {
  maximize_clicks: "Maximise Clicks (recommended — no conversion tracking)",
  manual_cpc: "Manual CPC",
};

export function PlanSetupStep({
  tree,
  onChange,
  context,
}: {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
  context: GoogleSearchWizardContext;
}) {
  const plan = tree.plan;

  const eventOptions = [
    { value: "", label: "— no event link —" },
    ...context.events.map((e) => ({
      value: e.id,
      label: e.event_code ? `${e.name} (${e.event_code})` : e.name,
    })),
  ];

  const accountOptions = [
    { value: "", label: "— pick an account —" },
    ...context.googleAdsAccounts.map((a) => ({
      value: a.id,
      label: `${a.account_name ?? "Account"} (${a.google_customer_id})`,
    })),
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
          <Select
            id="gs-plan-event"
            label="Linked event (optional)"
            value={plan.event_id ?? ""}
            options={eventOptions}
            onChange={(e) => {
              const value = e.target.value || null;
              if (value && !plan.name) suggestNameFromEvent(value);
              else updateField("event_id", value);
            }}
          />
          <Select
            id="gs-plan-account"
            label="Google Ads account"
            value={plan.google_ads_account_id ?? ""}
            options={accountOptions}
            onChange={(e) => updateField("google_ads_account_id", e.target.value || null)}
            error={!plan.google_ads_account_id ? "Required before push." : undefined}
          />
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
        </div>
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
