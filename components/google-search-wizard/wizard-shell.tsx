"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  GOOGLE_SEARCH_WIZARD_STEPS,
  hasHardErrors,
  validateGoogleSearchStep,
  type GoogleSearchValidationIssue,
  type GoogleSearchWizardStep,
} from "@/lib/google-search/validation";
import type { GoogleSearchPlanTree } from "@/lib/google-search/types";

import { PlanSetupStep } from "./steps/plan-setup";
import { CampaignsStep } from "./steps/campaigns";
import { AdGroupsKeywordsStep } from "./steps/ad-groups-keywords";
import { NegativesStep } from "./steps/negatives";
import { AdCopyStep } from "./steps/ad-copy";
import { TargetingBudgetStep } from "./steps/targeting-budget";
import { ReviewStep } from "./steps/review";
import { PushStep } from "./steps/push";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface GoogleSearchWizardContext {
  eventName: string | null;
  eventCode: string | null;
  clientName: string | null;
  googleAdsAccounts: Array<{ id: string; account_name: string | null; google_customer_id: string }>;
  events: Array<{ id: string; name: string; event_code: string | null; client_id: string | null }>;
}

interface GoogleSearchWizardShellProps {
  initialTree: GoogleSearchPlanTree;
  context: GoogleSearchWizardContext;
}

const AUTOSAVE_DEBOUNCE_MS = 1500;

export function GoogleSearchWizardShell({
  initialTree,
  context,
}: GoogleSearchWizardShellProps) {
  const router = useRouter();
  const [step, setStep] = useState<GoogleSearchWizardStep>(0);
  const [tree, setTree] = useState<GoogleSearchPlanTree>(initialTree);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const performSave = useCallback(async (current: GoogleSearchPlanTree) => {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/google-search/${current.plan.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree: current }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; tree: GoogleSearchPlanTree }
        | { ok: false; error?: string }
        | null;
      if (!res.ok || !json?.ok) {
        const msg = (json && !json.ok && json.error) || `Save failed (HTTP ${res.status}).`;
        throw new Error(msg);
      }
      // Use the server's canonical tree (with real UUIDs replacing tmp-ids)
      // for subsequent edits, so re-edits don't create duplicates on the
      // next save round.
      setTree(json.tree);
      treeRef.current = json.tree;
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Unknown save error");
    }
  }, []);

  const scheduleAutosave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      performSave(treeRef.current).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [performSave]);

  const onTreeChange = useCallback(
    (next: GoogleSearchPlanTree) => {
      setTree(next);
      scheduleAutosave();
    },
    [scheduleAutosave],
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const currentIssues = useMemo(
    () => validateGoogleSearchStep(step, tree),
    [step, tree],
  );
  const blocksNext = hasHardErrors(currentIssues);
  const indices = useMemo<GoogleSearchWizardStep[]>(
    () => GOOGLE_SEARCH_WIZARD_STEPS.map((_, i) => i as GoogleSearchWizardStep),
    [],
  );
  const position = indices.indexOf(step);
  const isFirstStep = position <= 0;
  const isLastStep = position === indices.length - 1;

  const handleContinue = useCallback(() => {
    if (blocksNext || isLastStep) return;
    setCompletedSteps((prev) => new Set([...prev, step]));
    setStep((indices[position + 1] ?? step) as GoogleSearchWizardStep);
  }, [blocksNext, indices, isLastStep, position, step]);

  const handleBack = useCallback(() => {
    if (isFirstStep) return;
    setStep((indices[position - 1] ?? step) as GoogleSearchWizardStep);
  }, [indices, isFirstStep, position, step]);

  const handleStepClick = useCallback(
    (target: GoogleSearchWizardStep) => {
      // Allow jumping back to completed steps or staying at-or-before current.
      const targetPos = indices.indexOf(target);
      if (targetPos < 0) return;
      if (completedSteps.has(target) || targetPos <= position) {
        setStep(target);
      }
    },
    [completedSteps, indices, position],
  );

  const handleSaveNow = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    performSave(treeRef.current).catch(() => {});
  }, [performSave]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <div className="border-b border-border bg-card px-6 py-2">
        <div className="mx-auto max-w-6xl">
          <button
            type="button"
            onClick={() => {
              handleSaveNow();
              router.push("/google-search");
            }}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Google Search plans
          </button>
        </div>
      </div>

      <nav className="border-b border-border bg-card px-6 py-3">
        <ol className="mx-auto flex max-w-6xl flex-wrap items-center gap-1">
          {GOOGLE_SEARCH_WIZARD_STEPS.map((stepDef, index) => {
            const isCurrent = step === index;
            const isCompleted = completedSteps.has(index);
            const isClickable = isCompleted || index <= position;
            return (
              <li key={stepDef.label} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => handleStepClick(index as GoogleSearchWizardStep)}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors
                    ${isCurrent ? "bg-primary/15" : "hover:bg-muted"}
                    disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  <span
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold
                      ${isCompleted ? "bg-foreground text-background" : ""}
                      ${isCurrent && !isCompleted ? "bg-primary text-primary-foreground" : ""}
                      ${!isCurrent && !isCompleted ? "bg-muted text-muted-foreground" : ""}`}
                  >
                    {isCompleted ? "✓" : index + 1}
                  </span>
                  <span
                    className={`hidden font-medium md:inline ${
                      isCurrent ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {stepDef.label}
                  </span>
                </button>
                {index < GOOGLE_SEARCH_WIZARD_STEPS.length - 1 && (
                  <div className={`hidden h-px w-3 md:block lg:w-6 ${isCompleted ? "bg-foreground/30" : "bg-border"}`} />
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Google Search campaign creator
            </p>
            <h1 className="mt-1 font-heading text-2xl tracking-wide">
              {tree.plan.name || "Untitled plan"}
            </h1>
            {context.eventName && (
              <p className="mt-1 text-sm text-muted-foreground">
                {context.clientName ? `${context.clientName} → ` : ""}
                {context.eventName}
                {context.eventCode ? ` (${context.eventCode})` : ""}
              </p>
            )}
          </header>

          {renderStep(step, tree, onTreeChange, context, setStep)}
        </div>
      </main>

      <footer className="sticky bottom-0 z-10 border-t border-border bg-card">
        {currentIssues.length > 0 && (
          <div className="border-b border-destructive/20 bg-destructive/5 px-6 py-2">
            <div className="mx-auto max-w-6xl">
              <ValidationStrip issues={currentIssues} />
            </div>
          </div>
        )}
        <div className="px-6 py-3">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {!isFirstStep && (
                <Button variant="outline" onClick={handleBack}>
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
              <SaveIndicator status={saveStatus} error={saveError} />
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={handleSaveNow} disabled={saveStatus === "saving"}>
                Save now
              </Button>
              {!isLastStep && (
                <Button onClick={handleContinue} disabled={blocksNext}>
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              {isLastStep && (
                <Button
                  onClick={() =>
                    document.getElementById("gs-push-trigger")?.dispatchEvent(
                      new MouseEvent("click", { bubbles: true }),
                    )
                  }
                  disabled={blocksNext}
                >
                  <Rocket className="h-4 w-4" />
                  Push to Google Ads
                </Button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function renderStep(
  step: GoogleSearchWizardStep,
  tree: GoogleSearchPlanTree,
  onChange: (next: GoogleSearchPlanTree) => void,
  context: GoogleSearchWizardContext,
  setStep: (s: GoogleSearchWizardStep) => void,
) {
  switch (step) {
    case 0:
      return <PlanSetupStep tree={tree} onChange={onChange} context={context} />;
    case 1:
      return <CampaignsStep tree={tree} onChange={onChange} onJumpToKeywords={() => setStep(2)} />;
    case 2:
      return <AdGroupsKeywordsStep tree={tree} onChange={onChange} />;
    case 3:
      return <NegativesStep tree={tree} onChange={onChange} />;
    case 4:
      return <AdCopyStep tree={tree} onChange={onChange} />;
    case 5:
      return <TargetingBudgetStep tree={tree} onChange={onChange} />;
    case 6:
      return <ReviewStep tree={tree} onGoToStep={setStep} />;
    case 7:
      return <PushStep tree={tree} onChange={onChange} />;
    default:
      return null;
  }
}

function ValidationStrip({ issues }: { issues: GoogleSearchValidationIssue[] }) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <div className="space-y-1">
      {errors.length > 0 && (
        <p className="text-xs font-medium text-destructive">
          {errors.length} issue{errors.length === 1 ? "" : "s"} to fix before continuing:
        </p>
      )}
      <ul className="space-y-0.5 pl-4">
        {errors.map((issue, i) => (
          <li key={`e-${i}`} className="text-xs text-destructive/80">
            • {issue.message}
          </li>
        ))}
        {warnings.map((issue, i) => (
          <li key={`w-${i}`} className="text-xs text-amber-700/80">
            ⚠ {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Saved
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="text-xs text-destructive" title={error ?? undefined}>
        Save failed — retry from header.
      </span>
    );
  }
  return null;
}
