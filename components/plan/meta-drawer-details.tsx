"use client";

import { useState } from "react";

import { AccountSetup } from "@/components/steps/account-setup";
import { BudgetSchedule } from "@/components/steps/budget-schedule";
import { CampaignSetup } from "@/components/steps/campaign-setup";
import { OptimisationStrategy } from "@/components/steps/optimisation-strategy";
import { InfoTip } from "@/components/viz/info-tip";
import { ProvenanceBadge } from "@/components/viz/provenance-badge";
import { ThresholdBand } from "@/components/viz/threshold-band";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import { META_DRAWER_COPY, detailRows, resolveDetailField, type DetailRowId } from "@/lib/plan/drawer";
import { formatPlanScheduleRange } from "@/lib/plan/format-schedule";
import type {
  BudgetScheduleSettings,
  CampaignDraft,
  CampaignSettings,
  OptimisationStrategySettings,
} from "@/lib/types";
import { VIZ_TYPE, VIZ_TYPE_NUM, type VizProvenance } from "@/lib/viz/tokens";

/**
 * `▸ details` — everything the redesign demoted out of steps 0, 1, 5 and
 * 6, plus the client preset read-only.
 *
 * Every row is a resolved value with a provenance badge, not a field
 * waiting for confirmation: the account and pixel came from the client,
 * the code and name from the event, the objective from the target unit,
 * the budget and schedule from the canvas. Only the six rows the wizard
 * genuinely let an operator override per campaign are editable here.
 */
export function MetaDrawerDetails({
  draft,
  onSettingsChange,
  onBudgetChange,
  onStrategyChange,
  showCampaignSetup = true,
  planId,
  channelDefaults = null,
}: {
  draft: CampaignDraft;
  onSettingsChange: (settings: CampaignSettings) => void;
  onBudgetChange?: (budgetSchedule: BudgetScheduleSettings) => void;
  onStrategyChange?: (strategy: OptimisationStrategySettings) => void;
  /**
   * False in an attach mode, where campaign-setup renders in the `⊞` tab
   * instead — its mode toggle and its pickers are the whole of that tab,
   * and the same component cannot own two mount points.
   */
  showCampaignSetup?: boolean;
  planId?: string | null;
  channelDefaults?: ResolvedChannelDefaults | null;
}) {
  const [open, setOpen] = useState(false);
  const s = draft.settings;
  const bs = draft.budgetSchedule;
  const preset = draft.optimisationStrategy?.preset ?? null;

  const rows = detailRows({
    account: resolveDetailField(
      s.metaAdAccountId || s.adAccountId,
      channelDefaults?.metaAdAccount,
    ),
    pixel: resolveDetailField(s.metaPixelId || s.pixelId, channelDefaults?.metaPixel),
    page: resolveDetailField(pageOf(draft), channelDefaults?.facebookPage),
    instagram: resolveDetailField(igOf(draft), channelDefaults?.instagramActor),
    code: value(s.campaignCode, "event"),
    name: value(s.campaignName, "event"),
    objective: value(s.objective, "target"),
    goal: value(s.optimisationGoal, "target"),
    placements: value(placementSummary(s), "preset"),
    age: value(ageSummary(draft), "preset"),
    geo: value(geoSummary(bs), "event"),
    timezone: value(bs?.timezone, "event"),
    budget: value(budgetSummary(bs), "plan"),
    schedule: value(scheduleSummary(bs), "plan"),
    preset: preset
      ? {
          value: `${draft.optimisationStrategy?.mode ?? "—"} · v${preset.presetVersion}`,
          // The badge answers where the ladder came from, which #877 records.
          provenance: preset.source === "industry seed" ? "industry seed" : "manual entry",
        }
      : undefined,
  });

  /** The ladder the tick will actually read — the materialised rule, not the preset's. */
  const ladder = draft.optimisationStrategy?.rules?.[0] ?? null;

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
      <InfoTip label={META_DRAWER_COPY.detailsTip} />

      {open ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-0">
          {rows.map((row) => (
            <div key={row.id} className="col-span-3 grid h-9 grid-cols-subgrid items-center border-b border-border" data-row={row.id}>
              <dt className={`${VIZ_TYPE.label} text-muted-foreground`}>{row.label}</dt>
              <dd className={`min-w-0 truncate ${VIZ_TYPE_NUM.body}`}>
                {row.editable ? (
                  <EditableValue
                    id={row.id}
                    value={row.value}
                    onCommit={(next) => commit(row.id, next, s, onSettingsChange)}
                  />
                ) : (
                  (row.value ?? "—")
                )}
              </dd>
              <dd>
                <ProvenanceBadge provenance={row.provenance} />
              </dd>
            </div>
          ))}
          {ladder ? (
            <div className="col-span-3 mt-1">
              <ThresholdBand rule={ladder} size="sm" />
            </div>
          ) : null}
          {planId ? (
            <div className={`col-span-3 mt-1 ${VIZ_TYPE.label}`}>
              <a className="text-muted-foreground underline" href={`/plan/${planId}`}>
                canvas ↗
              </a>
            </div>
          ) : null}

          {/*
            The four demoted steps, each behind its own disclosure. A row
            above answers "what is it and where did it come from"; opening
            one of these is how it gets changed, using the same control the
            wizard used — the account picker needs a Meta fetch, the
            objective grid needs its compatibility rules, and re-typing
            either of those as an inline input would lose them.
          */}
          <div className="col-span-3 mt-2 space-y-1 border-t border-border pt-2">
            <StepDisclosure id="account" label="account & pixel">
              <AccountSetup
                surface="drawer"
                settings={s}
                onChange={onSettingsChange}
                campaignId={draft.id}
              />
            </StepDisclosure>
            {showCampaignSetup ? (
              <StepDisclosure id="campaign" label="campaign">
                <CampaignSetup surface="drawer" settings={s} onChange={onSettingsChange} />
              </StepDisclosure>
            ) : null}
            {onBudgetChange ? (
              <StepDisclosure id="budget" label="budget, schedule & placements">
                <BudgetSchedule
                  surface="drawer"
                  variant="details"
                  budgetSchedule={bs}
                  adSetSuggestions={draft.adSetSuggestions}
                  audiences={draft.audiences}
                  settings={s}
                  onBudgetChange={onBudgetChange}
                  onSuggestionsChange={() => undefined}
                  onSettingsChange={onSettingsChange}
                />
              </StepDisclosure>
            ) : null}
            {onStrategyChange && draft.optimisationStrategy ? (
              <StepDisclosure id="optimisation" label="optimisation">
                <OptimisationStrategy
                  surface="drawer"
                  strategy={draft.optimisationStrategy}
                  objective={s.objective}
                  budgetAmount={bs?.budgetAmount ?? 0}
                  currency={bs?.currency ?? "GBP"}
                  onChange={onStrategyChange}
                  draftId={draft.id}
                  campaignStatus={draft.status}
                  clientId={s.clientId}
                />
              </StepDisclosure>
            ) : null}
          </div>
        </dl>
      ) : null}
    </section>
  );
}

/** One demoted step, collapsed. Mounted only while open — these fetch. */
function StepDisclosure({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
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

/** Inline edit for the six rows the wizard let an operator override per campaign. */
function EditableValue({
  id,
  value,
  onCommit,
}: {
  id: DetailRowId;
  value: string | null;
  onCommit: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={`edit ${id}`}
        className="truncate underline decoration-dotted hover:text-foreground"
        onClick={() => {
          setText(value ?? "");
          setEditing(true);
        }}
      >
        {value ?? "—"}
      </button>
    );
  }
  return (
    <input
      autoFocus
      aria-label={id}
      className={`w-full rounded-sm border border-border bg-background px-1 py-0.5 ${VIZ_TYPE.body}`}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setEditing(false);
        if (text !== (value ?? "")) onCommit(text);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setEditing(false);
      }}
    />
  );
}

function commit(
  id: DetailRowId,
  next: string,
  settings: CampaignSettings,
  onSettingsChange: (settings: CampaignSettings) => void,
) {
  const trimmed = next.trim();
  switch (id) {
    case "account":
      onSettingsChange({ ...settings, metaAdAccountId: trimmed });
      return;
    case "pixel":
      onSettingsChange({ ...settings, metaPixelId: trimmed });
      return;
    case "objective":
      onSettingsChange({ ...settings, objective: trimmed as CampaignSettings["objective"] });
      return;
    case "goal":
      onSettingsChange({
        ...settings,
        optimisationGoal: trimmed as CampaignSettings["optimisationGoal"],
      });
      return;
    default:
      // page / IG are picked in the creatives tab, where the options are loaded.
      return;
  }
}

/**
 * The wizard's provenance vocabulary is per-source; the badge's is
 * per-kind. A value that came from the client, the event, the plan or the
 * preset was resolved rather than typed, so it reads `derived`; the
 * operator's own edits read `manual entry` once they exist.
 */
function value(
  raw: string | null | undefined,
  source: "client-default" | "event" | "plan" | "preset" | "target",
): { value: string | null; provenance: VizProvenance } | undefined {
  if (!raw) return undefined;
  const provenance: VizProvenance = source === "preset" ? "industry seed" : "derived";
  return { value: raw, provenance };
}

function pageOf(draft: CampaignDraft): string | null {
  return draft.creatives.find((c) => c.identity?.pageId)?.identity?.pageId ?? null;
}

function igOf(draft: CampaignDraft): string | null {
  return (
    draft.creatives.find((c) => c.identity?.instagramAccountId)?.identity
      ?.instagramAccountId ?? null
  );
}

function placementSummary(settings: CampaignSettings): string | null {
  const config = settings.placementConfig;
  if (!config) return null;
  const on = Object.entries(config).filter(([, enabled]) => enabled === true);
  return on.length > 0 ? `${on.length} on` : null;
}

function ageSummary(draft: CampaignDraft): string | null {
  const rows = draft.adSetSuggestions ?? [];
  if (rows.length === 0) return null;
  const min = Math.min(...rows.map((r) => r.ageMin));
  const max = Math.max(...rows.map((r) => r.ageMax));
  return Number.isFinite(min) && Number.isFinite(max) ? `${min}–${max}` : null;
}

function geoSummary(bs: BudgetScheduleSettings | undefined): string | null {
  const groups = bs?.locationGroups ?? [];
  if (groups.length === 0) return null;
  return groups.length === 1 ? (groups[0]?.label ?? "1") : `${groups.length} groups`;
}

function budgetSummary(bs: BudgetScheduleSettings | undefined): string | null {
  if (!bs?.budgetAmount) return null;
  return `${bs.budgetAmount} ${bs.budgetType === "lifetime" ? "total" : "/day"}`;
}

function scheduleSummary(bs: BudgetScheduleSettings | undefined): string | null {
  if (!bs?.startDate) return null;
  return formatPlanScheduleRange(bs.startDate, bs.endDate);
}
