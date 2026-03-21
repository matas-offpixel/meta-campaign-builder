"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { FileText, X } from "lucide-react";
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
} from "@/lib/types";
import { createDefaultDraft } from "@/lib/campaign-defaults";
import { validateStep } from "@/lib/validation";
import { saveDraftToStorage, loadDraftFromStorage } from "@/lib/autosave";
import { loadTemplates, saveTemplate, deleteTemplate, applyTemplate } from "@/lib/templates";

export function WizardShell() {
  const [step, setStep] = useState<WizardStep>(0);
  const [draft, setDraft] = useState<CampaignDraft>(createDefaultDraft);
  const [hydrated, setHydrated] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Template state
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [loadedTemplateName, setLoadedTemplateName] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadDraftFromStorage();
    if (saved) setDraft(saved);
    setHydrated(true);
  }, []);

  const refreshTemplates = useCallback(() => {
    setTemplates(loadTemplates());
  }, []);

  const autosave = useCallback((d: CampaignDraft) => {
    setSaveStatus("saving");
    saveDraftToStorage(d);
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
    [scheduleAutosave]
  );

  const updateSettings = useCallback(
    (settings: CampaignSettings) => updateDraft((d) => ({ ...d, settings })),
    [updateDraft]
  );

  const updateAudiences = useCallback(
    (audiences: AudienceSettings) => updateDraft((d) => ({ ...d, audiences })),
    [updateDraft]
  );

  const updateCreatives = useCallback(
    (creatives: AdCreativeDraft[]) => updateDraft((d) => ({ ...d, creatives })),
    [updateDraft]
  );

  const updateBudgetSchedule = useCallback(
    (budgetSchedule: BudgetScheduleSettings) => updateDraft((d) => ({ ...d, budgetSchedule })),
    [updateDraft]
  );

  const updateAdSetSuggestions = useCallback(
    (adSetSuggestions: AdSetSuggestion[]) => updateDraft((d) => ({ ...d, adSetSuggestions })),
    [updateDraft]
  );

  const updateOptimisationStrategy = useCallback(
    (optimisationStrategy: OptimisationStrategySettings) => updateDraft((d) => ({ ...d, optimisationStrategy })),
    [updateDraft]
  );

  const updateCreativeAssignments = useCallback(
    (creativeAssignments: CreativeAssignmentMatrix) => updateDraft((d) => ({ ...d, creativeAssignments })),
    [updateDraft]
  );

  const currentValidation = useMemo(
    () => validateStep(step, draft),
    [step, draft]
  );

  const changeStep = useCallback(
    (newStep: WizardStep) => {
      autosave(draft);
      setStep(newStep);
    },
    [autosave, draft]
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

  const handleSaveDraft = () => {
    autosave(draft);
  };

  const handleLaunch = () => {
    const review = validateStep(7, draft);
    if (!review.valid) {
      alert(`Cannot launch:\n${review.errors.join("\n")}`);
      return;
    }
    console.log("Launching campaign:", draft);
    alert("Campaign launched (mock)");
  };

  // Template handlers
  const handleSaveTemplate = (name: string, description: string, tags: string[]) => {
    saveTemplate(draft, name, description, tags);
    setSaveTemplateOpen(false);
  };

  const handleLoadTemplate = (template: CampaignTemplate) => {
    const newDraft = applyTemplate(template);
    setDraft(newDraft);
    autosave(newDraft);
    setCompletedSteps(new Set());
    setStep(0);
    setLoadedTemplateName(template.name);
    setLoadTemplateOpen(false);
  };

  const handleDeleteTemplate = (id: string) => {
    deleteTemplate(id);
    refreshTemplates();
  };

  const handleOpenLoadModal = () => {
    refreshTemplates();
    setLoadTemplateOpen(true);
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading draft...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
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
        {step === 4 && <Creatives creatives={draft.creatives} onChange={updateCreatives} />}
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
        {step === 7 && <ReviewLaunch draft={draft} />}
      </main>

      <WizardFooter
        currentStep={step}
        canContinue={currentValidation.valid}
        saveStatus={saveStatus}
        onBack={handleBack}
        onContinue={handleContinue}
        onSaveDraft={handleSaveDraft}
        onLaunch={handleLaunch}
        onSaveTemplate={() => setSaveTemplateOpen(true)}
        onLoadTemplate={handleOpenLoadModal}
      />

      <SaveTemplateModal
        open={saveTemplateOpen}
        onClose={() => setSaveTemplateOpen(false)}
        onSave={handleSaveTemplate}
      />

      <LoadTemplateModal
        open={loadTemplateOpen}
        templates={templates}
        onClose={() => setLoadTemplateOpen(false)}
        onSelect={handleLoadTemplate}
        onDelete={handleDeleteTemplate}
      />
    </div>
  );
}
