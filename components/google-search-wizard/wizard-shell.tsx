"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { StatusLine, StepSurfaceProvider } from "@/components/steps/step-surface";
import { AdCopyStep } from "@/components/google-search-wizard/steps/ad-copy";
import { AdGroupsKeywordsStep } from "@/components/google-search-wizard/steps/ad-groups-keywords";
import { CampaignsStep } from "@/components/google-search-wizard/steps/campaigns";
import { NegativesStep } from "@/components/google-search-wizard/steps/negatives";
import { PlanSetupStep } from "@/components/google-search-wizard/steps/plan-setup";
import { PushStep } from "@/components/google-search-wizard/steps/push";
import { TargetingBudgetStep } from "@/components/google-search-wizard/steps/targeting-budget";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import {
  GOOGLE_SEARCH_WIZARD_STEPS,
  hasHardErrors,
  validateGoogleSearchStep,
  type GoogleSearchWizardStep,
} from "@/lib/google-search/validation";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";
import type { LinkedPlanSummary } from "@/lib/plan/linked-plan";
import type { WizardStep } from "@/lib/types";
import { useGoogleSearchTree } from "@/lib/wizard/use-google-search-tree";

export interface GoogleSearchWizardContext {
  eventName: string | null;
  eventCode: string | null;
  clientName: string | null;
  googleAdsAccounts: Array<{ id: string; account_name: string | null; google_customer_id: string }>;
  events: Array<{ id: string; name: string; event_code: string | null; client_id: string | null }>;
}

const STANDALONE_STEPS: WizardStep[] = [0, 1, 2, 3, 4, 5, 6];
const PLAN_LINKED_STEPS: WizardStep[] = [0, 1, 2, 3, 4, 5];

export function GoogleSearchWizardShell({
  initialTree,
  context,
  linkedPlan = null,
}: {
  initialTree: GoogleSearchPlanTree;
  context: GoogleSearchWizardContext;
  linkedPlan?: LinkedPlanSummary | null;
}) {
  const router = useRouter();
  const controller = useGoogleSearchTree(initialTree.plan.id, initialTree);
  const { tree, onChange, flush, saveStatus } = controller;
  const [step, setStep] = useState<WizardStep>(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const visibleSteps = linkedPlan ? PLAN_LINKED_STEPS : STANDALONE_STEPS;

  useEffect(() => {
    if (!visibleSteps.includes(step)) {
      const fallback =
        [...visibleSteps].reverse().find((s) => s <= step) ?? visibleSteps[0] ?? 0;
      setStep(fallback);
    }
  }, [visibleSteps, step]);

  const changeStep = useCallback(
    (next: WizardStep) => {
      void flush();
      setStep(next);
    },
    [flush],
  );

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

  const handleStepClick = (target: number) => {
    if (!visibleSteps.includes(target as WizardStep)) return;
    changeStep(target as WizardStep);
  };

  const goLibrary = () => {
    void flush();
    router.push("/google-search");
  };

  if (!tree) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <StatusLine className="text-sm text-muted-foreground">
          Loading Google Search plan…
        </StatusLine>
      </div>
    );
  }

  const issues = validateGoogleSearchStep(step as GoogleSearchWizardStep, tree);
  const blocking = hasHardErrors(issues);
  const validationErrors = issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);

  return (
    <StepSurfaceProvider surface="wizard" planOwnsDestination={linkedPlan != null}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <div className="border-b border-border bg-card px-6 py-2">
          <div className="mx-auto max-w-6xl">
            <button
              type="button"
              onClick={goLibrary}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Google Search plans
            </button>
          </div>
        </div>

        <WizardStepper
          currentStep={step}
          completedSteps={completedSteps}
          visibleSteps={visibleSteps}
          steps={GOOGLE_SEARCH_WIZARD_STEPS}
          onStepClick={handleStepClick}
        />

        <main className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-6 py-6">
          {step === 0 ? (
            <PlanSetupStep
              surface="wizard"
              tree={tree}
              onChange={onChange}
              context={context}
            />
          ) : null}
          {step === 1 ? (
            <CampaignsStep
              surface="wizard"
              tree={tree}
              onChange={onChange}
              onJumpToKeywords={() => handleStepClick(2)}
            />
          ) : null}
          {step === 2 ? (
            <AdGroupsKeywordsStep surface="wizard" tree={tree} onChange={onChange} />
          ) : null}
          {step === 3 ? (
            <NegativesStep surface="wizard" tree={tree} onChange={onChange} />
          ) : null}
          {step === 4 ? (
            <AdCopyStep surface="wizard" tree={tree} onChange={onChange} />
          ) : null}
          {step === 5 ? (
            <TargetingBudgetStep surface="wizard" tree={tree} onChange={onChange} />
          ) : null}
          {/*
            Push stays here for a standalone tree and only there: a
            plan-linked tree launches from the canvas, paused, with the
            other channels.
          */}
          {step === 6 && !linkedPlan ? (
            <PushStep
              surface="wizard"
              tree={tree}
              onChange={onChange}
              onOpenStep={handleStepClick}
            />
          ) : null}
        </main>

        <WizardFooter
          currentStep={step}
          visibleSteps={visibleSteps}
          canContinue={!blocking}
          validationErrors={validationErrors}
          saveStatus={saveStatus}
          showLaunch={false}
          showTemplates={false}
          planHref={linkedPlan ? `/plan/${linkedPlan.id}` : null}
          onBack={handleBack}
          onContinue={handleContinue}
          onSaveDraft={() => {
            void flush();
          }}
          onLaunch={() => undefined}
          onSaveTemplate={() => undefined}
          onLoadTemplate={() => undefined}
        />
      </div>
    </StepSurfaceProvider>
  );
}
