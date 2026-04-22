"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { FileText, X, ArrowLeft } from "lucide-react";
import { WizardStepper } from "./wizard-stepper";
import { WizardFooter, type SaveStatus } from "./wizard-footer";
import { AccountSetup } from "@/components/steps/account-setup";
import { CampaignSetup } from "@/components/steps/campaign-setup";
import { OptimisationStrategy } from "@/components/steps/optimisation-strategy";
import { AudiencesStep } from "@/components/steps/audiences/audiences-step";
import { Creatives } from "@/components/steps/creatives";
import { BudgetSchedule } from "@/components/steps/budget-schedule";
import { AssignCreatives } from "@/components/steps/assign-creatives";
import { ReviewLaunch } from "@/components/steps/review-launch";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import { LoadTemplateModal } from "@/components/templates/load-template-modal";
import type {
  CampaignDraft,
  WizardStep,
  CampaignSettings,
  AudienceSettings,
  AdCreativeDraft,
  BudgetScheduleSettings,
  AdSetSuggestion,
  CreativeAssignmentMatrix,
  OptimisationStrategySettings,
  CampaignTemplate,
  LaunchSummary,
} from "@/lib/types";
import { attachedAdSetKey, getVisibleSteps } from "@/lib/types";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { validateStep } from "@/lib/validation";
import { saveDraftToStorage, loadDraftFromStorage } from "@/lib/autosave";
import { applyTemplate } from "@/lib/templates";
import { createClient } from "@/lib/supabase/client";
import { loadDraftById, saveDraftToDb } from "@/lib/db/drafts";
import { loadTemplatesFromDb, saveTemplateToDb, deleteTemplateFromDb } from "@/lib/db/templates";
import { useLaunchCampaign } from "@/lib/hooks/useLaunchCampaign";
import { getCachedUserPages } from "@/lib/hooks/useMeta";
import { FacebookConnectionBanner } from "@/components/facebook-connection-banner";
import {
  WizardEventContextProvider,
  useWizardEventContext,
} from "@/lib/wizard/use-event-context";
import { derivePhase } from "@/lib/wizard/phase";

interface WizardShellProps {
  draftId: string;
}

export function WizardShell({ draftId }: WizardShellProps) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>(0);
  const [draft, setDraft] = useState<CampaignDraft>(createDefaultDraft);
  const [hydrated, setHydrated] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);

  // Launch state
  const { mutate: launchCampaign, loading: launching, error: launchError, resetError: dismissLaunchError } = useLaunchCampaign();
  const [launchSummary, setLaunchSummary] = useState<LaunchSummary | null>(null);

  // After a launch, auto-deselect engagement types that failed with permission errors
  // for every page in a group. This prevents repeated failed API calls on the next launch
  // without requiring manual intervention.
  useEffect(() => {
    if (!launchSummary?.engagementAudiencesFailed?.length) return;

    // Collect per-type permission failures — map: pageId → Set<engagementType>
    const permFailedByPage = new Map<string, Set<string>>();
    for (const f of launchSummary.engagementAudiencesFailed) {
      if (!f.isPermissionFailure || !f.pageId || !f.type) continue;
      if (!permFailedByPage.has(f.pageId)) permFailedByPage.set(f.pageId, new Set());
      permFailedByPage.get(f.pageId)!.add(f.type);
    }
    if (permFailedByPage.size === 0) return;

    const currentGroups = draftRef.current.audiences.pageGroups;
    const updated = currentGroups.map((g) => {
      if (g.pageIds.length === 0 || g.engagementTypes.length === 0) return g;

      // A type should be deselected only if ALL pages in the group failed it with a permission error
      const typesToRemove = g.engagementTypes.filter((et) =>
        g.pageIds.every((pageId) => permFailedByPage.get(pageId)?.has(et)),
      );
      if (typesToRemove.length === 0) return g;

      console.log(
        `[WizardShell] Auto-deselecting engagement types for group "${g.name}":`,
        typesToRemove,
        "— all pages in group had permission failures for these types",
      );
      return {
        ...g,
        engagementTypes: g.engagementTypes.filter((et) => !typesToRemove.includes(et)),
      };
    });

    const changed = updated.some(
      (g, i) => g.engagementTypes.length !== currentGroups[i].engagementTypes.length,
    );
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, pageGroups: updated });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSummary]);

  // After launch, persist updatedEngagementStatuses back into the draft so
  // the next launch/retry knows which source audiences already exist in Meta.
  useEffect(() => {
    if (!launchSummary?.updatedEngagementStatuses?.length) return;
    const currentGroups = draftRef.current.audiences.pageGroups;
    let changed = false;
    const updatedGroups = currentGroups.map((g) => {
      const incoming = launchSummary.updatedEngagementStatuses!.find((u) => u.groupId === g.id);
      if (!incoming) return g;
      changed = true;
      return { ...g, engagementAudienceStatuses: incoming.statuses };
    });
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, pageGroups: updatedGroups });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSummary]);

  // After launch, persist custom group lookalike IDs back into the draft.
  useEffect(() => {
    if (!launchSummary?.updatedCustomGroupLookalikes?.length) return;
    const currentCAGroups = draftRef.current.audiences.customAudienceGroups;
    let changed = false;
    const updated = currentCAGroups.map((g) => {
      const incoming = launchSummary.updatedCustomGroupLookalikes!.find((u) => u.groupId === g.id);
      if (!incoming) return g;
      changed = true;
      return { ...g, lookalikeAudienceIdsByRange: incoming.lookalikeAudienceIdsByRange };
    });
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, customAudienceGroups: updated });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchSummary]);

  // Template state
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [loadedTemplateName, setLoadedTemplateName] = useState<string | null>(null);

  // ─── Initialisation ─────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setUserId(user.id);
        userIdRef.current = user.id;

        // Load specific draft by ID from Supabase
        const remoteDraft = await loadDraftById(draftId);
        if (remoteDraft) {
          console.log(
            "[WizardShell] Loaded draft", draftId,
            "| adAccountId:", remoteDraft.settings.adAccountId || "(empty)",
            "| metaAdAccountId:", remoteDraft.settings.metaAdAccountId || "(empty)",
          );
          setDraft(remoteDraft);
          saveDraftToStorage(remoteDraft);
        } else {
          // New campaign — create a fresh draft with this ID
          console.log("[WizardShell] No draft found — creating fresh draft", draftId);
          const fresh = createDefaultDraft();
          fresh.id = draftId;
          setDraft(fresh);
        }
      } else {
        const localDraft = loadDraftFromStorage();
        if (localDraft) setDraft(localDraft);
      }

      setHydrated(true);
    }

    init();
  }, [draftId]);

  // ─── Autosave ────────────────────────────────────────────────────────────────
  const autosave = useCallback((d: CampaignDraft) => {
    setSaveStatus("saving");
    saveDraftToStorage(d);

    if (userIdRef.current) {
      saveDraftToDb(d, userIdRef.current).catch(console.warn);
    }

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setSaveStatus("saved");
      saveTimeoutRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
    }, 400);
  }, []);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const debounceSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAutosave = useCallback(() => {
    if (debounceSaveRef.current) clearTimeout(debounceSaveRef.current);
    debounceSaveRef.current = setTimeout(() => {
      autosave(draftRef.current);
    }, 1500);
  }, [autosave]);

  const updateDraft = useCallback(
    (updater: (d: CampaignDraft) => CampaignDraft) => {
      setDraft((prev) => {
        const next = { ...updater(prev), updatedAt: new Date().toISOString() };
        return next;
      });
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  // ─── Field updaters ──────────────────────────────────────────────────────────
  const updateSettings = useCallback(
    (settings: CampaignSettings) => updateDraft((d) => ({ ...d, settings })),
    [updateDraft],
  );

  const updateAudiences = useCallback(
    (audiences: AudienceSettings) => updateDraft((d) => ({ ...d, audiences })),
    [updateDraft],
  );

  const updateCreatives = useCallback(
    (creatives: AdCreativeDraft[]) => updateDraft((d) => ({ ...d, creatives })),
    [updateDraft],
  );

  const updateBudgetSchedule = useCallback(
    (budgetSchedule: BudgetScheduleSettings) => updateDraft((d) => ({ ...d, budgetSchedule })),
    [updateDraft],
  );

  const updateAdSetSuggestions = useCallback(
    (adSetSuggestions: AdSetSuggestion[]) => updateDraft((d) => ({ ...d, adSetSuggestions })),
    [updateDraft],
  );

  const updateOptimisationStrategy = useCallback(
    (optimisationStrategy: OptimisationStrategySettings) =>
      updateDraft((d) => ({ ...d, optimisationStrategy })),
    [updateDraft],
  );

  const updateCreativeAssignments = useCallback(
    (creativeAssignments: CreativeAssignmentMatrix) =>
      updateDraft((d) => ({ ...d, creativeAssignments })),
    [updateDraft],
  );

  // ─── Navigation ─────────────────────────────────────────────────────────────
  const currentValidation = useMemo(() => validateStep(step, draft), [step, draft]);

  // Visible step list for the current wizard mode. attach_adset hides
  // Optimisation, Audiences and Budget — those are inherited from the
  // existing live ad set. Anything the user lands on via direct URL
  // / template load that isn't visible is treated as if they clicked the
  // closest preceding visible step.
  const visibleSteps = useMemo(
    () => getVisibleSteps(draft.settings.wizardMode),
    [draft.settings.wizardMode],
  );

  const changeStep = useCallback(
    (newStep: WizardStep) => {
      autosave(draft);
      setStep(newStep);
    },
    [autosave, draft],
  );

  // Defensive: if the wizard mode changes while the user is on a now-hidden
  // step, snap them back to the closest visible step.
  useEffect(() => {
    if (!visibleSteps.includes(step)) {
      const fallback =
        [...visibleSteps].reverse().find((s) => s <= step) ?? visibleSteps[0] ?? 0;
      console.log(
        `[WizardShell] step ${step} hidden in mode "${draft.settings.wizardMode ?? "new"}" — snapping to ${fallback}`,
      );
      setStep(fallback as WizardStep);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleSteps]);

  const handleContinue = () => {
    const idx = visibleSteps.indexOf(step);
    if (idx === -1 || idx >= visibleSteps.length - 1) return;
    setCompletedSteps((prev) => new Set([...prev, step]));
    changeStep(visibleSteps[idx + 1]!);
  };

  const handleBack = () => {
    const idx = visibleSteps.indexOf(step);
    if (idx <= 0) return;
    changeStep(visibleSteps[idx - 1]!);
  };

  const handleStepClick = (targetStep: WizardStep) => {
    if (!visibleSteps.includes(targetStep)) return;
    changeStep(targetStep);
  };

  const handleSaveDraft = () => autosave(draft);

  const handleLaunch = async () => {
    const review = validateStep(7, draft);
    if (!review.valid) {
      alert(`Cannot launch:\n${review.errors.join("\n")}`);
      return;
    }

    const adAccountId = draft.settings.metaAdAccountId || draft.settings.adAccountId;
    console.log(
      "[WizardShell] handleLaunch — metaAdAccountId:", draft.settings.metaAdAccountId || "(empty)",
      "| adAccountId:", draft.settings.adAccountId || "(empty)",
      "| resolved:", adAccountId || "(NONE — will abort)",
    );
    if (!adAccountId) {
      alert("No ad account selected. Go back to Account Setup.");
      return;
    }

    try {
      // Build page → IG account ID map from the enriched pages cache.
      // The cache was populated using the user's Facebook OAuth token, which
      // correctly resolves both instagram_business_account AND
      // connected_instagram_account. The server-side token used by
      // fetchInstagramAccounts() is a system/app token that may not see these
      // user-level page→IG connections, so we send the map explicitly.
      const cachedPages = getCachedUserPages();
      const igAccountMap: Record<string, string> = {};
      for (const page of cachedPages) {
        const igId = page.instagramAccountId;
        if (page.id && igId) igAccountMap[page.id] = igId;
      }
      console.log(
        "[WizardShell] handleLaunch — igAccountMap from cache:",
        Object.keys(igAccountMap).length, "entries",
        Object.entries(igAccountMap).map(([pid, igId]) => `${pid}→${igId}`).join(", ") || "(none)",
      );

      // Single server-side call — runs all 4 phases and saves to Supabase
      const result = await launchCampaign(draft, { igAccountMap });

      // Store launch summary on the draft without overwriting editable fields.
      // adSetSuggestions and creatives are left intact so re-launches start
      // from a clean state without stale metaAdSetId / metaCreativeId values.
      const published: CampaignDraft = {
        ...draft,
        metaCampaignId: result.metaCampaignId,
        launchSummary: result,
        status: "published",
        updatedAt: new Date().toISOString(),
      };

      setDraft(published);
      setLaunchSummary(result);
      saveDraftToStorage(published);
      // Supabase persistence is handled by the server route — no client-side save needed
    } catch {
      // Error is captured in launchError from the hook — ReviewLaunch renders the error modal
    }
  };

  const handleBackToLibrary = () => {
    autosave(draft);
    router.push("/");
  };

  // ─── Template: save ──────────────────────────────────────────────────────────
  const handleSaveTemplate = async (name: string, description: string, tags: string[]) => {
    if (!userId) return;
    setTemplateSaving(true);
    setTemplateSaveError(null);
    setTemplateSaveSuccess(false);
    try {
      await saveTemplateToDb(draft, name, description, tags, userId);
      setTemplateSaveSuccess(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error saving template";
      console.error("Failed to save template:", err);
      setTemplateSaveError(msg);
    } finally {
      setTemplateSaving(false);
    }
  };

  // ─── Template: load modal ────────────────────────────────────────────────────
  const handleOpenLoadModal = async () => {
    setLoadTemplateOpen(true);
    if (!userId) return;
    setTemplatesLoading(true);
    try {
      const fetched = await loadTemplatesFromDb(userId);
      setTemplates(fetched);
    } catch (err) {
      console.warn("Failed to fetch templates:", err);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleLoadTemplate = (template: CampaignTemplate) => {
    const newDraft = applyTemplate(template);
    newDraft.id = draftId; // keep same URL / row
    setDraft(newDraft);
    autosave(newDraft);
    setCompletedSteps(new Set());
    setStep(0);
    setLoadedTemplateName(template.name);
    setLoadTemplateOpen(false);
  };

  // ─── Template: delete ────────────────────────────────────────────────────────
  const handleDeleteTemplate = async (id: string) => {
    setTemplates((prev) => prev.filter((t) => t.id !== id));
    setDeletingTemplateId(id);
    try {
      await deleteTemplateFromDb(id);
    } catch (err) {
      console.warn("Failed to delete template:", err);
      if (userId) {
        const fetched = await loadTemplatesFromDb(userId);
        setTemplates(fetched);
      }
    } finally {
      setDeletingTemplateId(null);
    }
  };

  // ─── Loading gate ────────────────────────────────────────────────────────────
  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading campaign…</p>
      </div>
    );
  }

  return (
    <WizardEventContextProvider draftId={draftId} enabled={hydrated}>
      <EventDefaultsApplier draft={draft} updateDraft={updateDraft} />
      <div className="flex min-h-screen flex-col">
      {/* Back to library link */}
      <div className="border-b border-border bg-card px-6 py-2">
        <div className="mx-auto max-w-5xl">
          <button
            type="button"
            onClick={handleBackToLibrary}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground
              hover:text-foreground hover:bg-muted transition-colors -ml-2"
          >
            <ArrowLeft className="h-3 w-3" />
            Campaign Library
          </button>
        </div>
      </div>

      <WizardStepper
        currentStep={step}
        completedSteps={completedSteps}
        visibleSteps={visibleSteps}
        onStepClick={handleStepClick}
      />

      {step > 0 && (
        <FacebookConnectionBanner onGoToAccountSetup={() => setStep(0)} />
      )}

      {/* Template indicator */}
      {loadedTemplateName && (
        <div className="border-b border-border bg-primary/10 px-6 py-2">
          <div className="mx-auto flex max-w-5xl items-center gap-2">
            <FileText className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-foreground">
              Loaded from template: <span className="font-medium">{loadedTemplateName}</span>
            </span>
            <button
              type="button"
              onClick={() => setLoadedTemplateName(null)}
              className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-6 py-6">
        {step === 0 && (
          <AccountSetup
            settings={draft.settings}
            onChange={updateSettings}
            campaignId={draftId}
          />
        )}
        {step === 1 && <CampaignSetup settings={draft.settings} onChange={updateSettings} />}
        {step === 2 && (
          <OptimisationStrategy
            strategy={draft.optimisationStrategy}
            objective={draft.settings.objective}
            budgetAmount={draft.budgetSchedule.budgetAmount}
            currency={draft.budgetSchedule.currency}
            onChange={updateOptimisationStrategy}
          />
        )}
        {step === 3 && (
          <AudiencesStep
            audiences={draft.audiences}
            onChange={updateAudiences}
            adAccountId={draft.settings.metaAdAccountId}
            campaignName={draft.settings.campaignName}
          />
        )}
        {step === 4 && (
          <Creatives
            creatives={draft.creatives}
            onChange={updateCreatives}
            adAccountId={draft.settings.metaAdAccountId}
          />
        )}
        {step === 5 && (
          <BudgetSchedule
            budgetSchedule={draft.budgetSchedule}
            adSetSuggestions={draft.adSetSuggestions}
            audiences={draft.audiences}
            onBudgetChange={updateBudgetSchedule}
            onSuggestionsChange={updateAdSetSuggestions}
          />
        )}
        {step === 6 && (() => {
          // attach_adset mode: derive one synthetic ad set entry per selected
          // live ad set so the existing assign matrix has rows to work with.
          // We never persist these into draft.adSetSuggestions — purely a
          // render-time projection. The matrix is keyed by
          // `attachedAdSetKey(metaAdSetId)` so per-ad-set assignments survive
          // across re-renders and re-launches.
          const selectedAdSets =
            draft.settings.existingMetaAdSets ??
            (draft.settings.existingMetaAdSet
              ? [draft.settings.existingMetaAdSet]
              : []);
          const isAttachAdSet =
            draft.settings.wizardMode === "attach_adset" &&
            selectedAdSets.length > 0;
          const adSetsForAssign: AdSetSuggestion[] = isAttachAdSet
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
            : draft.adSetSuggestions;
          return (
            <AssignCreatives
              adSets={adSetsForAssign}
              creatives={draft.creatives}
              assignments={draft.creativeAssignments}
              onChange={updateCreativeAssignments}
              attachAdSetMode={isAttachAdSet}
            />
          );
        })()}
        {step === 7 && (
          <ReviewLaunch
            draft={draft}
            isLaunching={launching}
            launchError={launchError}
            onDismissLaunchError={dismissLaunchError}
            launchSummary={launchSummary}
            onGoToLibrary={() => router.push("/")}
            onUpdateSettings={updateSettings}
          />
        )}
      </main>

      <WizardFooter
        currentStep={step}
        visibleSteps={visibleSteps}
        canContinue={currentValidation.valid}
        validationErrors={currentValidation.errors}
        saveStatus={saveStatus}
        launching={launching}
        onBack={handleBack}
        onContinue={handleContinue}
        onSaveDraft={handleSaveDraft}
        onLaunch={handleLaunch}
        onSaveTemplate={() => setSaveTemplateOpen(true)}
        onLoadTemplate={handleOpenLoadModal}
      />

      <SaveTemplateModal
        open={saveTemplateOpen}
        saving={templateSaving}
        savedSuccessfully={templateSaveSuccess}
        error={templateSaveError}
        onClose={() => {
          setSaveTemplateOpen(false);
          setTemplateSaveSuccess(false);
          setTemplateSaveError(null);
        }}
        onSave={handleSaveTemplate}
      />

      <LoadTemplateModal
        open={loadTemplateOpen}
        templates={templates}
        loading={templatesLoading}
        deletingId={deletingTemplateId}
        onClose={() => setLoadTemplateOpen(false)}
        onSelect={handleLoadTemplate}
        onDelete={handleDeleteTemplate}
      />
      </div>
    </WizardEventContextProvider>
  );
}

// ─── Event-context defaults applier ──────────────────────────────────────────
//
// Mounted inside the WizardEventContextProvider once the wizard is
// hydrated. On the first render where the context fetch completes, it
// soft-fills the draft with values derived from the linked event +
// client: ad account / pixel / pages from client defaults, campaign
// name + event_code from the event, schedule start/end from today +
// event_date. Only ever touches fields that are still empty — user
// edits always win.
//
// Guarded by a ref so navigating between steps (which re-renders
// everything but doesn't change the draft id) doesn't reapply the
// defaults and stomp on the user's edits.

interface DefaultsApplierProps {
  draft: CampaignDraft;
  updateDraft: (updater: (d: CampaignDraft) => CampaignDraft) => void;
}

function EventDefaultsApplier({ draft, updateDraft }: DefaultsApplierProps) {
  const { event, client, loaded } = useWizardEventContext();
  const appliedRef = useRef(false);

  useEffect(() => {
    if (appliedRef.current) return;
    if (!loaded) return;
    if (!event && !client) {
      // Nothing to fill — still flip the flag so we don't keep waking
      // on every render.
      appliedRef.current = true;
      return;
    }

    // Snapshot once so the effect doesn't depend on the draft itself
    // (we want it to run exactly once after context loads, never after
    // a user edit). The applier reads through draftRef-style closure
    // capture but we deliberately call updateDraft with the latest
    // draft via the functional updater — see below.
    updateDraft((d) => {
      const next: CampaignDraft = { ...d, settings: { ...d.settings } };
      const s = next.settings;

      if (client) {
        const clientAdAccount = client.meta_ad_account_id ?? null;
        if (clientAdAccount && !s.adAccountId && !s.metaAdAccountId) {
          s.adAccountId = clientAdAccount;
          s.metaAdAccountId = clientAdAccount;
        }
        const clientPixel = client.meta_pixel_id ?? null;
        if (clientPixel && !s.pixelId && !s.metaPixelId) {
          s.pixelId = clientPixel;
          s.metaPixelId = clientPixel;
        }
        const clientPages = client.default_page_ids ?? [];
        if (clientPages.length > 0 && !s.metaPageId) {
          s.metaPageId = clientPages[0];
        }
        if (!s.clientId && client.id) {
          s.clientId = client.id;
        }
      }

      if (event) {
        const phase = derivePhase(event);
        const suggestedName =
          phase === "Campaign" ? event.name : `${event.name} — ${phase}`;
        if (!s.campaignName) {
          s.campaignName = suggestedName;
        }
        if (!s.campaignCode && event.event_code) {
          s.campaignCode = event.event_code;
        }
      }

      // Schedule defaults: start = today (yyyy-mm-ddT00:00 in local
      // tz), end = event_date end-of-day. The Input is type
      // datetime-local so the value must be a 16-char local string
      // ("YYYY-MM-DDThh:mm"); UTC ISO breaks the picker.
      const bs = next.budgetSchedule
        ? { ...next.budgetSchedule }
        : null;
      if (bs) {
        if (!bs.startDate) {
          bs.startDate = formatLocalDateTime(new Date(), { hour: 0, minute: 0 });
        }
        if (!bs.endDate && event?.event_date) {
          bs.endDate = `${event.event_date}T23:59`;
        }
        next.budgetSchedule = bs;
      }

      appliedRef.current = true;
      return next;
    });
  }, [loaded, event, client, updateDraft]);

  return null;
}

/**
 * Format a Date as the local "YYYY-MM-DDThh:mm" string expected by
 * <input type="datetime-local"> — ISO is UTC and breaks the picker
 * across timezones.
 */
function formatLocalDateTime(
  date: Date,
  override?: { hour?: number; minute?: number },
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(override?.hour ?? date.getHours()).padStart(2, "0");
  const mm = String(override?.minute ?? date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
