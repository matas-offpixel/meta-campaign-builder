"use client";

import {
  BookmarkPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Loader2,
  Save,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { TIKTOK_WIZARD_STEPS } from "@/lib/types/tiktok-draft";

export type TikTokSaveStatus = "idle" | "saving" | "saved";

interface TikTokWizardFooterProps {
  currentStep: number;
  canContinue: boolean;
  saveStatus: TikTokSaveStatus;
  onBack: () => void;
  onContinue: () => void;
  onSaveDraft: () => void;
  onSaveTemplate: () => void;
  onLoadTemplate: () => void;
}

export function TikTokWizardFooter({
  currentStep,
  canContinue,
  saveStatus,
  onBack,
  onContinue,
  onSaveDraft,
  onSaveTemplate,
  onLoadTemplate,
}: TikTokWizardFooterProps) {
  const isFirstStep = currentStep <= 0;
  const isLastStep = currentStep === TIKTOK_WIZARD_STEPS.length - 1;
  const showLoadTemplate = currentStep <= 1;

  return (
    <footer className="sticky bottom-0 z-10 mt-6 border-t border-border bg-card">
      <div className="px-0 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!isFirstStep && (
              <Button variant="outline" onClick={onBack}>
                <ChevronLeft className="h-4 w-4" />
                Previous
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
            {!isLastStep && (
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
