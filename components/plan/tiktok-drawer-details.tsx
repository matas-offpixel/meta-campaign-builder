"use client";

import { useState, type ReactNode } from "react";

import { AccountSetupStep } from "@/components/tiktok-wizard/steps/account-setup";
import { BudgetScheduleStep } from "@/components/tiktok-wizard/steps/budget-schedule";
import { CampaignSetupStep } from "@/components/tiktok-wizard/steps/campaign-setup";
import { OptimisationStrategyStep } from "@/components/tiktok-wizard/steps/optimisation-strategy";
import { InfoTip } from "@/components/viz/info-tip";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { TIKTOK_DRAWER_COPY, resolveDetailField, tiktokDetailRows } from "@/lib/plan/drawer";
import { formatPlanScheduleRange } from "@/lib/plan/format-schedule";
import type { TikTokCampaignDraft } from "@/lib/types/tiktok-draft";
import { VIZ_TYPE, VIZ_TYPE_NUM, type VizProvenance } from "@/lib/viz/tokens";

export function TikTokDrawerDetails({
  draft,
  onSave,
  planId,
  channelDefaults = null,
}: {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  planId?: string | null;
  channelDefaults?: ResolvedChannelDefaults | null;
}) {
  const [open, setOpen] = useState(false);
  const a = draft.accountSetup;
  const c = draft.campaignSetup;
  const o = draft.optimisation;
  const b = draft.budgetSchedule;

  const rows = tiktokDetailRows({
    advertiser: resolveDetailField(a.advertiserId, channelDefaults?.tiktokAdvertiser),
    identity: resolveDetailField(
      a.identityDisplayName ?? a.identityId,
      { value: channelDefaults?.tiktokIdentity.value?.id ?? null },
    ),
    pixel: value(a.pixelId, "derived"),
    event: value(a.optimisationEvent, "derived"),
    objective: value(c.objective, "derived"),
    goal: value(c.optimisationGoal, "derived"),
    bid: value(c.bidStrategy ?? o.bidStrategy, "derived"),
    budget: value(b.budgetAmount != null ? String(b.budgetAmount) : null, "derived"),
    schedule: value(formatPlanScheduleRange(b.scheduleStartAt, b.scheduleEndAt), "derived"),
    frequency: value(b.frequencyCap != null ? String(b.frequencyCap) : null, "industry seed"),
    pacing: value(o.pacing, "industry seed"),
  });

  return (
    <section aria-label="details" className="mt-4 border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        className={`inline-flex items-center gap-1 ${VIZ_TYPE.label} text-muted-foreground hover:text-foreground`}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        details
      </button>
      <InfoTip label={TIKTOK_DRAWER_COPY.detailsTip} />

      {open ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0">
          {rows.map((row) => (
            <div
              key={row.id}
              className="col-span-3 grid h-9 grid-cols-subgrid items-center border-b border-border"
              data-row={row.id}
            >
              <dt className={`${VIZ_TYPE.label} text-muted-foreground`}>{row.label}</dt>
              <dd className={`min-w-0 truncate ${VIZ_TYPE_NUM.body}`}>{row.value ?? "—"}</dd>
              <dd>
                <ProvenanceBadge provenance={row.provenance} />
              </dd>
            </div>
          ))}
          {planId ? (
            <div className={`col-span-3 mt-1 ${VIZ_TYPE.label}`}>
              <a className="text-muted-foreground underline" href={`/plan/${planId}`}>
                canvas ↗
              </a>
            </div>
          ) : null}
          <div className="col-span-3 mt-2 space-y-1 border-t border-border pt-2">
            <StepDisclosure id="account" label="advertiser & identity">
              <AccountSetupStep surface="drawer" draft={draft} onSave={onSave} />
            </StepDisclosure>
            <StepDisclosure id="campaign" label="campaign">
              <CampaignSetupStep surface="drawer" draft={draft} onSave={onSave} />
            </StepDisclosure>
            <StepDisclosure id="optimisation" label="optimisation">
              <OptimisationStrategyStep surface="drawer" draft={draft} onSave={onSave} />
            </StepDisclosure>
            <StepDisclosure id="budget" label="budget & schedule">
              <BudgetScheduleStep surface="drawer" draft={draft} onSave={onSave} />
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
        className={`inline-flex items-center gap-1 ${VIZ_TYPE.label} text-muted-foreground hover:text-foreground`}
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
