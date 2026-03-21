"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Rocket, Save, Loader2, CheckCircle2, BookmarkPlus, FolderOpen } from "lucide-react";
import type { WizardStep } from "@/lib/types";

export type SaveStatus = "idle" | "saving" | "saved";

interface WizardFooterProps {
  currentStep: WizardStep;
  canContinue: boolean;
  saveStatus: SaveStatus;
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
  saveStatus,
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

  return (
    <footer className="sticky bottom-0 z-10 border-t border-border bg-card px-6 py-3">
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
            <Button onClick={onLaunch} disabled={!canContinue}>
              <Rocket className="h-4 w-4" />
              Launch Campaign
            </Button>
          ) : (
            <Button onClick={onContinue} disabled={!canContinue}>
              Continue
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
