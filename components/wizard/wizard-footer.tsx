"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, Rocket, Save, Loader2, CheckCircle2,
  BookmarkPlus, FolderOpen, AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import type { WizardStep } from "@/lib/types";

export type SaveStatus = "idle" | "saving" | "saved";

interface WizardFooterProps {
  currentStep: WizardStep;
  canContinue: boolean;
  /** Validation error strings for the current step — shown when Continue is blocked */
  validationErrors?: string[];
  saveStatus: SaveStatus;
  /** True while the Meta campaign creation API call is in flight */
  launching?: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSaveDraft: () => void;
  onLaunch: () => void;
  onSaveTemplate: () => void;
  onLoadTemplate: () => void;
}

export function WizardFooter({
  currentStep,
  canContinue,
  validationErrors = [],
  saveStatus,
  launching = false,
  onBack,
  onContinue,
  onSaveDraft,
  onLaunch,
  onSaveTemplate,
  onLoadTemplate,
}: WizardFooterProps) {
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === 7;
  const showLoadTemplate = currentStep <= 1;

  // Expand/collapse the error list — starts expanded so errors are visible immediately
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const showErrors = !canContinue && validationErrors.length > 0;

  return (
    <footer className="sticky bottom-0 z-10 border-t border-border bg-card">
      {/* ── Validation error bar — only rendered when Continue is blocked ── */}
      {showErrors && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-6 py-2">
          <div className="mx-auto max-w-5xl">
            <button
              type="button"
              onClick={() => setErrorsExpanded((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="flex-1 text-xs font-medium text-destructive">
                {validationErrors.length} issue{validationErrors.length !== 1 ? "s" : ""} to fix before continuing
              </span>
              {errorsExpanded
                ? <ChevronUp className="h-3.5 w-3.5 text-destructive/60" />
                : <ChevronDown className="h-3.5 w-3.5 text-destructive/60" />}
            </button>
            {errorsExpanded && (
              <ul className="mt-1.5 space-y-0.5 pl-5">
                {validationErrors.map((err, i) => (
                  <li key={i} className="text-xs text-destructive/80">
                    {err}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Main footer row ── */}
      <div className="px-6 py-3">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            {!isFirstStep && (
              <Button variant="outline" onClick={onBack}>
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            {showLoadTemplate && (
              <Button variant="outline" onClick={onLoadTemplate}>
                <FolderOpen className="h-4 w-4" />
                Load Template
              </Button>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="text-success">Saved</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onSaveTemplate}>
              <BookmarkPlus className="h-4 w-4" />
              Save as Template
            </Button>
            <Button variant="ghost" onClick={onSaveDraft}>
              <Save className="h-4 w-4" />
              Save Draft
            </Button>

            {isLastStep ? (
              <Button onClick={onLaunch} disabled={!canContinue || launching}>
                {launching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Rocket className="h-4 w-4" />
                )}
                {launching ? "Creating campaign…" : "Launch Campaign"}
              </Button>
            ) : (
              <Button onClick={onContinue} disabled={!canContinue}>
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
