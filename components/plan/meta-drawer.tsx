"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type RefObject } from "react";

import {
  useCampaignDraft,
  type CampaignDraftController,
} from "@/lib/wizard/use-campaign-draft";

import { AssignCreatives } from "@/components/steps/assign-creatives";
import { AudiencesStep } from "@/components/steps/audiences/audiences-step";
import { BudgetSchedule } from "@/components/steps/budget-schedule";
import { CampaignSetup } from "@/components/steps/campaign-setup";
import { Creatives } from "@/components/steps/creatives";
import {
  RetryFailedAdsPanel,
  RetryLookalikesPanel,
} from "@/components/steps/review-launch";
import { StepSurfaceProvider } from "@/components/steps/step-surface";
import { LoadTemplateModal } from "@/components/templates/load-template-modal";
import { BlockerBadge } from "@/components/viz/blocker-badge";
import { Drawer } from "@/components/viz/drawer";
import { InfoTip } from "@/components/viz/info-tip";
import { deleteTemplateFromDb, loadTemplatesFromDb } from "@/lib/db/templates";
import {
  META_DRAWER_COPY,
  META_DRAWER_TABS,
  adsetsTabWaiting,
  blockerRowsFromValidation,
  isMetaDrawerTab,
  tabForAnchor,
  type MetaDrawerTab,
} from "@/lib/plan/drawer";
import {
  attachedAdSetKey,
  getVisibleSteps,
  type AdSetSuggestion,
  type CampaignTemplate,
} from "@/lib/types";
import { applyTemplate } from "@/lib/templates";
import { validateStep } from "@/lib/validation";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import type { VizStatus } from "@/lib/viz/tokens";

import { MetaDrawerDetails } from "./meta-drawer-details";

type DraftController = CampaignDraftController;

/**
 * Loads the draft, then renders the drawer. Mounted only while the drawer
 * is open so the draft is fetched on first open and not on every canvas
 * render — and so the hook is never called conditionally.
 */
export function MetaDrawerMount({
  draftId,
  ...rest
}: { draftId: string } & Omit<Parameters<typeof MetaDrawer>[0], "controller">) {
  const controller = useCampaignDraft(draftId);
  return <MetaDrawer controller={controller} {...rest} />;
}

/**
 * The Meta drawer — the Meta wizard, from PR 4 on.
 *
 * Three tabs carry the three things that are still judgement (audiences,
 * creatives, which creative goes in which ad set). Everything else was
 * decided once, by the client, the event or the plan, and reads DONE in
 * the `details` disclosure at the foot. The steps themselves are mounted
 * unchanged behind `surface="drawer"`, which strips their chrome and the
 * fields §3a demotes — a 2,400-line panel keeps every control it had and
 * loses every sentence.
 *
 * `variant="page"` is the same shell with no canvas behind it, which is
 * what `/campaign/[id]` renders. Nothing forks.
 */
export function MetaDrawer({
  open,
  controller,
  initialAnchor,
  triggerRef,
  onClose,
  variant = "sheet",
  status = "idle",
  planId = null,
  doneLabel,
  onTabChange,
}: {
  open: boolean;
  controller: DraftController;
  initialAnchor?: BlockerAnchor | null;
  triggerRef?: RefObject<Element | null>;
  onClose: () => void;
  variant?: "sheet" | "page";
  status?: VizStatus;
  /** Set when this draft belongs to a plan — drives the launch pointer. */
  planId?: string | null;
  doneLabel?: string;
  /** Reported up so the canvas can keep `?tab=` on the tab actually open. */
  onTabChange?: (tab: MetaDrawerTab) => void;
}) {
  const {
    draft,
    userId,
    saveStatus,
    flush,
    setDraft,
    updateSettings,
    updateAudiences,
    updateCreatives,
    handlePageInstagramOverride,
    updateBudgetSchedule,
    updateAdSetSuggestions,
    updateCreativeAssignments,
    updateOptimisationStrategy,
    autosave,
  } = controller;

  const [tab, setTabState] = useState<MetaDrawerTab>(() => {
    const from = tabForAnchor("meta", initialAnchor);
    return isMetaDrawerTab(from) ? from : "f-audiences";
  });
  const setTab = useCallback(
    (next: MetaDrawerTab) => {
      setTabState(next);
      onTabChange?.(next);
    },
    [onTabChange],
  );
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const settings = draft.settings;
  const mode = settings.wizardMode ?? "new";
  const visibleSteps = useMemo(() => getVisibleSteps(mode), [mode]);

  /**
   * Blockers are read per step and then anchored to the tab that owns the
   * step, so a badge click lands where the fix is. Only visible steps are
   * read — an attach mode inherits its audience and its budget, so
   * validating them would invent blockers the operator cannot clear.
   */
  const blockers = useMemo(
    () =>
      blockerRowsFromValidation(
        visibleSteps
          .filter((step) => step !== 7)
          .map((step) => ({ step, errors: validateStep(step, draft).errors })),
      ),
    [visibleSteps, draft],
  );

  const audienceCount = useMemo(() => {
    const a = draft.audiences;
    return (
      a.pageGroups.length +
      a.customAudienceGroups.length +
      a.interestGroups.length +
      a.savedAudiences.audienceIds.length +
      (a.selectedPagesLookalikeGroups?.length ?? 0) +
      (a.offpixelCustomAudienceIds?.length ?? 0)
    );
  }, [draft.audiences]);

  const adsetsWaiting = adsetsTabWaiting(audienceCount);

  const done = useCallback(() => {
    // Every edit is already saved; this only flushes a pending debounce.
    flush();
    onClose();
  }, [flush, onClose]);

  const openTemplates = useCallback(async () => {
    setTemplateOpen(true);
    if (!userId) return;
    setTemplatesLoading(true);
    try {
      setTemplates(await loadTemplatesFromDb(userId));
    } finally {
      setTemplatesLoading(false);
    }
  }, [userId]);

  const loadTemplate = useCallback(
    (template: CampaignTemplate) => {
      const next = applyTemplate(template);
      // Keep the row this drawer is editing — same rule as the wizard.
      next.id = draft.id;
      setDraft(next);
      autosave(next);
      setTemplateOpen(false);
    },
    [draft.id, setDraft, autosave],
  );

  const removeTemplate = useCallback(
    async (id: string) => {
      setDeletingTemplateId(id);
      try {
        await deleteTemplateFromDb(id);
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      } finally {
        setDeletingTemplateId(null);
      }
    },
    [],
  );

  /**
   * `attach_adset` assigns to ad sets that already live on Meta, so the
   * `⊞` tab's rows are projected from the picked ad sets rather than from
   * the suggestions. Same projection as the wizard's step 6 — attach
   * behaviour is not allowed to degrade in this PR.
   */
  const selectedAdSets =
    settings.existingMetaAdSets ??
    (settings.existingMetaAdSet ? [settings.existingMetaAdSet] : []);
  const attachAdSetMode = mode === "attach_adset" && selectedAdSets.length > 0;
  const adSetsForAssign: AdSetSuggestion[] = useMemo(
    () =>
      attachAdSetMode
        ? selectedAdSets.map((s) => ({
            id: attachedAdSetKey(s.id),
            name: s.name,
            sourceType: "page_group",
            sourceId: s.id,
            sourceName: s.name,
            ageMin: 18,
            ageMax: 65,
            budgetPerDay: 0,
            advantagePlus: false,
            enabled: true,
            metaAdSetId: s.id,
          }))
        : draft.adSetSuggestions,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedAdSets is derived above
    [attachAdSetMode, draft.adSetSuggestions, settings.existingMetaAdSets, settings.existingMetaAdSet],
  );

  const onOpenAnchor = useCallback((anchor: BlockerAnchor) => {
    const next = tabForAnchor("meta", anchor);
    if (isMetaDrawerTab(next)) setTab(next);
  }, []);

  return (
    <>
      <Drawer
        open={open}
        variant={variant}
        platform="meta"
        tabs={META_DRAWER_TABS.map((entry) => ({
          id: entry.id,
          glyph: entry.glyph,
          label: entry.label,
        }))}
        activeTab={tab}
        onTabChange={(id) => {
          if (isMetaDrawerTab(id)) setTab(id);
        }}
        status={blockers.length > 0 ? "blocked" : status}
        onDone={done}
        doneLabel={doneLabel}
        onLoadTemplate={() => void openTemplates()}
        triggerRef={triggerRef}
        header={<ModeChip mode={mode} />}
        footer={
          <span className="text-[11px] text-muted-foreground" role="status">
            {saveStatus === "saving" ? "◌" : saveStatus === "saved" ? "✓" : null}
          </span>
        }
      >
        <StepSurfaceProvider surface="drawer">
          {blockers.length > 0 ? (
            <div className="mb-3">
              <BlockerBadge rows={blockers} onOpenAnchor={onOpenAnchor} />
            </div>
          ) : null}

          {tab === "f-audiences" ? (
            <AudiencesStep
              surface="drawer"
              audiences={draft.audiences}
              onChange={updateAudiences}
              settings={settings}
              onSettingsChange={updateSettings}
              onPageInstagramOverride={handlePageInstagramOverride}
              adAccountId={settings.metaAdAccountId || settings.adAccountId}
              clientId={settings.clientId}
              eventId={settings.eventId}
              campaignName={settings.campaignName}
            />
          ) : null}

          {tab === "f-creatives" ? (
            <Creatives
              surface="drawer"
              creatives={draft.creatives}
              onChange={updateCreatives}
              settings={settings}
              onSettingsChange={updateSettings}
              adAccountId={settings.metaAdAccountId || settings.adAccountId}
            />
          ) : null}

          {tab === "f-adsets" ? (
            <AdSetsTab
              waiting={adsetsWaiting.waiting && mode === "new"}
              waitingLabel={adsetsWaiting.label}
              controller={controller}
              adSetsForAssign={adSetsForAssign}
              attachAdSetMode={attachAdSetMode}
              showAssign={mode !== "attach_all_adsets"}
              showRows={mode === "new" || mode === "attach_campaign"}
              onBudgetChange={updateBudgetSchedule}
              onSuggestionsChange={updateAdSetSuggestions}
              onSettingsChange={updateSettings}
              onAssignmentsChange={updateCreativeAssignments}
              planId={planId}
              attachMode={mode !== "new"}
            />
          ) : null}

          <MetaDrawerDetails
            draft={draft}
            onSettingsChange={updateSettings}
            onBudgetChange={updateBudgetSchedule}
            onStrategyChange={updateOptimisationStrategy}
            /* In an attach mode the pickers own the `⊞` tab (decision 2). */
            showCampaignSetup={mode === "new"}
            planId={planId}
          />
        </StepSurfaceProvider>
      </Drawer>

      <LoadTemplateModal
        open={templateOpen}
        templates={templates}
        loading={templatesLoading}
        deletingId={deletingTemplateId}
        onClose={() => setTemplateOpen(false)}
        onSelect={loadTemplate}
        onDelete={(id) => void removeTemplate(id)}
      />
    </>
  );
}

/** The attach mode, as a header chip. It is a fact about the draft, not a step. */
function ModeChip({ mode }: { mode: string }) {
  const label =
    mode === "attach_campaign"
      ? META_DRAWER_COPY.modeAttachCampaign
      : mode === "attach_adset"
        ? META_DRAWER_COPY.modeAttachAdset
        : mode === "attach_all_adsets"
          ? META_DRAWER_COPY.modeAttachAllAdsets
          : META_DRAWER_COPY.modeNew;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {label}
      </span>
      {mode === "new" ? null : <InfoTip label={META_DRAWER_COPY.modeTip} />}
    </span>
  );
}

/**
 * `⊞` — one table. The ad-set rows come from `budget-schedule` and the
 * creative columns from `assign-creatives`, which the redesign collapses
 * into a single surface (§3a row 7): an ad set is a row, a creative is a
 * checkbox on it.
 */
function AdSetsTab({
  waiting,
  waitingLabel,
  controller,
  adSetsForAssign,
  attachAdSetMode,
  showAssign,
  showRows,
  onBudgetChange,
  onSuggestionsChange,
  onSettingsChange,
  onAssignmentsChange,
  planId,
  attachMode,
}: {
  waiting: boolean;
  waitingLabel: string;
  controller: DraftController;
  adSetsForAssign: DraftController["draft"]["adSetSuggestions"];
  attachAdSetMode: boolean;
  showAssign: boolean;
  showRows: boolean;
  onBudgetChange: DraftController["updateBudgetSchedule"];
  onSuggestionsChange: DraftController["updateAdSetSuggestions"];
  onSettingsChange: DraftController["updateSettings"];
  onAssignmentsChange: DraftController["updateCreativeAssignments"];
  planId: string | null;
  /** An attach mode picks live ad sets rather than generating suggestions. */
  attachMode: boolean;
}) {
  const { draft } = controller;

  if (waiting) {
    return (
      <div className="flex items-center gap-1.5 rounded-sm border border-dashed border-border px-2 py-3">
        <span aria-hidden="true" className="text-muted-foreground">
          ○
        </span>
        <span className="text-[11px] text-muted-foreground">{waitingLabel}</span>
        <InfoTip label={META_DRAWER_COPY.adsetsWaitingTip} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/*
        Decision 2: in an attach mode this tab is the pickers. The mode
        toggle, the campaign cap, the mixed-objective notice and the
        cross-campaign ad-set picker all live inside campaign-setup and
        stay there — extracting them would be the rewrite decision 3
        forbids, and the bulk-attach parity tests read that component.
      */}
      {attachMode ? (
        <CampaignSetup surface="drawer" settings={draft.settings} onChange={onSettingsChange} />
      ) : null}
      {showRows ? (
        <BudgetSchedule
          surface="drawer"
          budgetSchedule={draft.budgetSchedule}
          adSetSuggestions={draft.adSetSuggestions}
          audiences={draft.audiences}
          settings={draft.settings}
          onBudgetChange={onBudgetChange}
          onSuggestionsChange={onSuggestionsChange}
          onSettingsChange={onSettingsChange}
        />
      ) : null}
      {showAssign ? (
        <AssignCreatives
          surface="drawer"
          adSets={adSetsForAssign}
          creatives={draft.creatives}
          assignments={draft.creativeAssignments}
          onChange={onAssignmentsChange}
          attachAdSetMode={attachAdSetMode}
        />
      ) : null}
      {planId && draft.status === "published" ? (
        <LaunchIssues draft={draft} planId={planId} />
      ) : null}
    </div>
  );
}

/**
 * `▸ launch issues` — the remediation the review step used to own. A
 * plan-linked draft launches from the canvas and so never renders review,
 * which would otherwise leave a failed ad with nowhere to be retried
 * from (§3a row 8).
 */
function LaunchIssues({
  draft,
  planId,
}: {
  draft: DraftController["draft"];
  planId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="launch issues" className="border-t border-border pt-2">
      <button
        type="button"
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        launch issues
      </button>
      <InfoTip label={META_DRAWER_COPY.launchIssuesTip} />
      {open ? (
        <div className="mt-2 space-y-2">
          {/*
            Retrying a failed ad re-runs the launch, and the launch of a
            plan-linked draft is the canvas's one button — the ledger there
            already skips what succeeded. So this hands off rather than
            opening a second write path.
          */}
          <RetryFailedAdsPanel
            draftId={draft.id}
            onRetryFailedAds={() => router.push(`/plan/${planId}`)}
          />
          <RetryLookalikesPanel draft={draft} />
        </div>
      ) : null}
    </section>
  );
}
