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
import { loadDraftById, saveDraftToDb, publishCampaign } from "@/lib/db/drafts";
import { loadTemplatesFromDb, saveTemplateToDb, deleteTemplateFromDb } from "@/lib/db/templates";
import { useCreateCampaign } from "@/lib/hooks/useCreateCampaign";
import { useCreateAdSets } from "@/lib/hooks/useCreateAdSets";
import { useCreateCreativesAndAds } from "@/lib/hooks/useCreateCreativesAndAds";

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
  const { mutate: createCampaign, loading: launchingCampaign, error: launchError, resetError: dismissLaunchError } = useCreateCampaign();
  const { mutate: createAdSets, loading: launchingAdSets } = useCreateAdSets();
  const { mutate: createCreativesAndAds, loading: launchingCreatives } = useCreateCreativesAndAds();
  const launching = launchingCampaign || launchingAdSets || launchingCreatives;
  const [launchSummary, setLaunchSummary] = useState<LaunchSummary | null>(null);

  // Template state
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
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
          setDraft(remoteDraft);
          saveDraftToStorage(remoteDraft);
        } else {
          // New campaign — create a fresh draft with this ID
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

    const adAccountId =
      draft.settings.metaAdAccountId || draft.settings.adAccountId;

    if (!adAccountId) {
      alert("No ad account selected. Go back to Account Setup.");
      return;
    }

    // ── Phase 1: Create the campaign ────────────────────────────────────────
    let metaCampaignId: string;
    try {
      const campaignResult = await createCampaign({
        metaAdAccountId: adAccountId,
        name: draft.settings.campaignName,
        objective: draft.settings.objective,
        status: "PAUSED",
      });
      metaCampaignId = campaignResult.metaCampaignId;
    } catch {
      // Error captured in hook's launchError — ReviewLaunch shows the modal
      return;
    }

    // ── Phase 2: Create ad sets (non-fatal — campaign is already live) ──────
    const enabledSets = draft.adSetSuggestions.filter((s) => s.enabled);
    let adSetsCreated: LaunchSummary["adSetsCreated"] = [];
    let adSetsFailed: LaunchSummary["adSetsFailed"] = [];

    if (enabledSets.length > 0) {
      try {
        const adSetResult = await createAdSets({
          metaAdAccountId: adAccountId,
          metaCampaignId,
          optimisationGoal: draft.settings.optimisationGoal,
          objective: draft.settings.objective,
          pixelId: draft.settings.metaPixelId || draft.settings.pixelId || undefined,
          budgetSchedule: draft.budgetSchedule,
          audiences: draft.audiences,
          adSetSuggestions: enabledSets,
        });
        adSetsCreated = adSetResult.created;
        adSetsFailed = adSetResult.failed;
      } catch {
        adSetsFailed = enabledSets.map((s) => ({
          name: s.name,
          error: "Request failed",
        }));
      }
    }

    // ── Merge metaAdSetIds back into suggestions ─────────────────────────────
    const updatedSuggestions = draft.adSetSuggestions.map((s) => {
      const match = adSetsCreated.find((c) => c.name === s.name);
      return match ? { ...s, metaAdSetId: match.metaAdSetId } : s;
    });

    // ── Phase 3: Create creatives + ads (non-fatal) ───────────────────────────
    let creativesCreated: LaunchSummary["creativesCreated"] = [];
    let creativesFailed: LaunchSummary["creativesFailed"] = [];
    let updatedCreatives = draft.creatives;

    if (draft.creatives.length > 0) {
      try {
        const creativesResult = await createCreativesAndAds({
          metaAdAccountId: adAccountId,
          creatives: draft.creatives,
          assignments: draft.creativeAssignments,
          adSetSuggestions: updatedSuggestions,
        });

        creativesCreated = creativesResult.created.map((c) => ({
          name: c.name,
          metaCreativeId: c.metaCreativeId,
          ads: c.ads,
          adsFailed: c.adsFailed,
        }));
        creativesFailed = creativesResult.failed.map((c) => ({
          name: c.name,
          error: c.error,
        }));

        // Merge metaCreativeIds back into draft.creatives
        updatedCreatives = draft.creatives.map((c) => {
          const match = creativesResult.created.find((r) => r.internalId === c.id);
          return match ? { ...c, metaCreativeId: match.metaCreativeId } : c;
        });
      } catch {
        creativesFailed = draft.creatives.map((c) => ({
          name: c.name,
          error: "Request failed",
        }));
      }
    }

    // ── Aggregate summary ────────────────────────────────────────────────────
    const adsCreated = creativesCreated.reduce((sum, c) => sum + c.ads.length, 0);
    const adsFailed = creativesCreated.reduce((sum, c) => sum + c.adsFailed.length, 0);

    const summary: LaunchSummary = {
      metaCampaignId,
      adSetsCreated,
      adSetsFailed,
      creativesCreated,
      creativesFailed,
      adsCreated,
      adsFailed,
    };

    // ── Persist ──────────────────────────────────────────────────────────────
    const published: CampaignDraft = {
      ...draft,
      adSetSuggestions: updatedSuggestions,
      creatives: updatedCreatives,
      metaCampaignId,
      launchSummary: summary,
      status: "published",
      updatedAt: new Date().toISOString(),
    };

    setDraft(published);
    setLaunchSummary(summary);
    saveDraftToStorage(published);

    if (userIdRef.current) {
      await publishCampaign(published, metaCampaignId, userIdRef.current);
    }
    // Don't auto-redirect — ReviewLaunch shows the summary and has a "Go to Library" CTA
  };

  const handleBackToLibrary = () => {
    autosave(draft);
    router.push("/");
  };

  // ─── Template: save ──────────────────────────────────────────────────────────
  const handleSaveTemplate = async (name: string, description: string, tags: string[]) => {
    if (!userId) return;
    setTemplateSaving(true);
    try {
      await saveTemplateToDb(draft, name, description, tags, userId);
      setSaveTemplateOpen(false);
    } catch (err) {
      console.error("Failed to save template:", err);
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
        {step === 0 && <AccountSetup settings={draft.settings} onChange={updateSettings} />}
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
        {step === 3 && <AudiencesStep audiences={draft.audiences} onChange={updateAudiences} />}
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
        onClose={() => setSaveTemplateOpen(false)}
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
