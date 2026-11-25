"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, Rocket, Save, Loader2, CheckCircle2,
  BookmarkPlus, FolderOpen, AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import type { WizardStep } from "@/lib/types";
import { LAUNCH_ON_CANVAS_LABEL } from "@/lib/plan/drawer";

export type SaveStatus = "idle" | "saving" | "saved";

interface WizardFooterProps {
  currentStep: WizardStep;
  /**
   * Visible step indices for the current wizard mode. Used to derive
   * "first" / "last" semantics when the wizard skips intermediate steps
   * (e.g. attach_adset hides Optimisation / Audiences / Budget so step 7
   * is still last but step 4 may be reached directly from step 1).
   * Falls back to the full 0–7 sequence when omitted.
   */
  visibleSteps?: WizardStep[];
  canContinue: boolean;
  validationErrors?: string[];
  saveStatus: SaveStatus;
  /** True while the Meta campaign creation API call is in flight */
  launching?: boolean;
  /** BUC cooldown remaining, e.g. "47m 00s" — disables Launch until elapsed. */
  launchCooldownLabel?: string | null;
  /**
   * "Launch · {n} to fix" while a launch check blocks (record RC3). Set,
   * the button reads it and stays off.
   */
  launchBlockedLabel?: string | null;
  /**
   * A plan-linked draft launches from the plan canvas, with TikTok and
   * Google, paused, in one action — so this footer offers a pointer there
   * instead of a second Launch (§3a row 8, friction #6).
   */
  showLaunch?: boolean;
  planHref?: string | null;
  /** Google has no campaign templates. Default on — Meta and TikTok keep the loader. */
  showTemplates?: boolean;
  onBack: () => void;
  onContinue: () => void;
  onSaveDraft: () => void;
  onLaunch: () => void;
  onSaveTemplate: () => void;
  onLoadTemplate: () => void;
}

export function WizardFooter({
  currentStep,
  visibleSteps,
  canContinue,
  validationErrors = [],
  saveStatus,
  launching = false,
  launchCooldownLabel = null,
  launchBlockedLabel = null,
  showLaunch = true,
  planHref = null,
  showTemplates = true,
  onBack,
  onContinue,
  onSaveDraft,
  onLaunch,
  onSaveTemplate,
  onLoadTemplate,
}: WizardFooterProps) {
  const indices: WizardStep[] =
    visibleSteps && visibleSteps.length > 0
      ? visibleSteps
      : ([0, 1, 2, 3, 4, 5, 6, 7] as WizardStep[]);
  const position = indices.indexOf(currentStep);
  const isFirstStep = position <= 0;
  const isLastStep = position === indices.length - 1;
  // "Load Template" is offered while still in the first two visible steps.
  const showLoadTemplate = position !== -1 && position <= 1;

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

      {/* ── Main footer row ──
          Under 640px it is two rows (#1361 design round, 393): the primary
          action full width on top, so "Launch · {n} to fix" always shows,
          then Back, Save as Template, Save Draft. From 640px it is one row as
          before: the primary sits last, at the right. */}
      <div className="px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 sm:flex-nowrap">
          <div className="flex items-center gap-2 sm:gap-3">
            {!isFirstStep && (
              <Button variant="outline" onClick={onBack} className="max-sm:px-3">
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            {showTemplates && showLoadTemplate && (
              <Button variant="outline" onClick={onLoadTemplate}>
                <FolderOpen className="h-4 w-4" />
                Load Template
              </Button>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground empty:hidden">
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

          <div className="ml-auto flex items-center sm:gap-2">
            {showTemplates ? (
              <Button variant="ghost" onClick={onSaveTemplate} className="whitespace-nowrap max-sm:gap-1.5 max-sm:px-2">
                <BookmarkPlus className="h-4 w-4" />
                Save as Template
              </Button>
            ) : null}
            <Button variant="ghost" onClick={onSaveDraft} className="whitespace-nowrap max-sm:gap-1.5 max-sm:px-2">
              <Save className="h-4 w-4" />
              Save Draft
            </Button>
          </div>

          <div data-footer-primary="" className="order-first flex w-full empty:hidden sm:order-none sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">
            {isLastStep ? (
              showLaunch ? (
                <Button
                  onClick={onLaunch}
                  disabled={
                    !canContinue || launching || Boolean(launchCooldownLabel) || Boolean(launchBlockedLabel)
                  }
                >
                  {launching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  {launching
                    ? "Creating campaign…"
                    : launchCooldownLabel
                      ? `Retry in ${launchCooldownLabel}`
                      : launchBlockedLabel ?? "Launch Campaign"}
                </Button>
              ) : planHref ? (
                <a
                  href={planHref}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
                >
                  {LAUNCH_ON_CANVAS_LABEL} ↗
                </a>
              ) : null
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
