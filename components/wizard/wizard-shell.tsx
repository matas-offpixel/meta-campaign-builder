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

  // After a launch with permission failures, auto-set createEngagementAudiences=false
  // for page groups where every page had a permission failure. This prevents
  // repeated failed attempts on the next launch without needing manual UI intervention.
  useEffect(() => {
    if (!launchSummary?.engagementAudiencesFailed?.length) return;

    const permFailedPageIds = new Set(
      launchSummary.engagementAudiencesFailed
        .filter((f) => f.isPermissionFailure && f.pageId)
        .map((f) => f.pageId!),
    );
    if (permFailedPageIds.size === 0) return;

    const currentGroups = draftRef.current.audiences.pageGroups;
    const updated = currentGroups.map((g) => {
      // Only update groups that aren't already standard-only and have pages
      if (g.createEngagementAudiences === false || g.pageIds.length === 0) return g;
      // Disable engagement if every page in the group had a permission failure
      const allFailed = g.pageIds.every((id) => permFailedPageIds.has(id));
      if (!allFailed) return g;
      console.log(
        `[WizardShell] Auto-disabling engagement audiences for group "${g.name}"` +
        ` — all pages had permission failures`,
      );
      return { ...g, createEngagementAudiences: false as const };
    });

    const changed = updated.some(
      (g, i) => g.createEngagementAudiences !== currentGroups[i].createEngagementAudiences,
    );
    if (changed) {
      updateAudiences({ ...draftRef.current.audiences, pageGroups: updated });
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

  const changeStep = useCallback(
    (newStep: WizardStep) => {
      autosave(draft);
      setStep(newStep);
    },
    [autosave, draft],
  );

  const handleContinue = () => {
    if (step < 7) {
      setCompletedSteps((prev) => new Set([...prev, step]));
      changeStep((step + 1) as WizardStep);
    }
  };

  const handleBack = () => {
    if (step > 0) changeStep((step - 1) as WizardStep);
  };

  const handleStepClick = (targetStep: WizardStep) => changeStep(targetStep);

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
        {step === 6 && (
          <AssignCreatives
            adSets={draft.adSetSuggestions}
            creatives={draft.creatives}
            assignments={draft.creativeAssignments}
            onChange={updateCreativeAssignments}
          />
        )}
        {step === 7 && (
          <ReviewLaunch
            draft={draft}
            isLaunching={launching}
            launchError={launchError}
            onDismissLaunchError={dismissLaunchError}
            launchSummary={launchSummary}
            onGoToLibrary={() => router.push("/")}
          />
        )}
      </main>

      <WizardFooter
        currentStep={step}
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
  );
}
