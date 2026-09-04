"use client";

import { useState, type ReactNode } from "react";

import { CampaignsStep } from "@/components/google-search-wizard/steps/campaigns";
import { PlanSetupStep } from "@/components/google-search-wizard/steps/plan-setup";
import { TargetingBudgetStep } from "@/components/google-search-wizard/steps/targeting-budget";
import type { GoogleSearchWizardContext } from "@/components/google-search-wizard/wizard-shell";
import { InfoTip } from "@/components/viz/info-tip";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import { GOOGLE_DRAWER_COPY, googleDetailRows } from "@/lib/plan/drawer";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import type { VizProvenance } from "@/lib/viz/tokens";

export function GoogleDrawerDetails({
  tree,
  onChange,
  planId,
  wizardContext,
}: {
  tree: GoogleSearchPlanTree;
  onChange: (next: GoogleSearchPlanTree) => void;
  planId?: string | null;
  wizardContext?: GoogleSearchWizardContext;
}) {
  const [open, setOpen] = useState(false);
  const p = tree.plan;
  const campaign = tree.campaigns[0];
  const account = wizardContext?.googleAdsAccounts.find((a) => a.id === p.google_ads_account_id);
  const geo = p.geo_targets?.[0];

  const rows = googleDetailRows({
    account: value(account?.account_name ?? p.google_ads_account_id, "derived"),
    customer: value(account?.google_customer_id, "derived"),
    structure: value(p.structure_mode === "single_campaign" ? "single" : p.structure_mode, "derived"),
    bidding: value(p.bidding_strategy, "industry seed"),
    geo: value(
      geo?.resolved_name ?? geo?.location ?? null,
      "derived",
    ),
    url: value(campaign?.ad_groups[0]?.rsas[0]?.final_url ?? null, "derived"),
    budget: value(
      campaign?.daily_budget != null ? `${campaign.daily_budget} /day` : null,
      "derived",
    ),
  });

  return (
    <section aria-label="details" className="mt-4 border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        details
      </button>
      <InfoTip label={GOOGLE_DRAWER_COPY.detailsTip} />

      {open ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
          {rows.map((row) => (
            <div
              key={row.id}
              className="col-span-3 grid grid-cols-subgrid items-center"
              data-row={row.id}
            >
              <dt className="text-[11px] text-muted-foreground">{row.label}</dt>
              <dd className="min-w-0 truncate text-[11px]">{row.value ?? "—"}</dd>
              <dd>
                <ProvenanceBadge provenance={row.provenance} />
              </dd>
            </div>
          ))}
          {planId ? (
            <div className="col-span-3 mt-1 text-[11px]">
              <a className="text-muted-foreground underline" href={`/plan/${planId}`}>
                canvas ↗
              </a>
            </div>
          ) : null}
          <div className="col-span-3 mt-2 space-y-1 border-t border-border pt-2">
            {wizardContext ? (
              <StepDisclosure id="account" label="account & plan">
                <PlanSetupStep
                  surface="drawer"
                  tree={tree}
                  onChange={onChange}
                  context={wizardContext}
                />
              </StepDisclosure>
            ) : null}
            <StepDisclosure id="campaigns" label="campaigns">
              <CampaignsStep
                surface="drawer"
                tree={tree}
                onChange={onChange}
                onJumpToKeywords={() => undefined}
              />
            </StepDisclosure>
            <StepDisclosure id="targeting" label="targeting & budget">
              <TargetingBudgetStep surface="drawer" tree={tree} onChange={onChange} />
            </StepDisclosure>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function StepDisclosure({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-step-disclosure={id}>
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open ? <div className="mt-1 pl-3">{children}</div> : null}
    </div>
  );
}

function value(
  raw: string | null | undefined,
  provenance: VizProvenance,
): { value: string | null; provenance: VizProvenance } | undefined {
  if (!raw) return undefined;
  return { value: raw, provenance };
}
