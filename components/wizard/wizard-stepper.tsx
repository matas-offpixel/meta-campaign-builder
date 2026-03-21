"use client";

import { Check } from "lucide-react";
import { WIZARD_STEPS, type WizardStep } from "@/lib/types";

interface WizardStepperProps {
  currentStep: WizardStep;
  completedSteps: Set<number>;
  onStepClick: (step: WizardStep) => void;
}

export function WizardStepper({ currentStep, completedSteps, onStepClick }: WizardStepperProps) {
  return (
    <nav className="w-full border-b border-border bg-card px-4 py-3">
      <ol className="mx-auto flex max-w-5xl items-center justify-between">
        {WIZARD_STEPS.map((step, index) => {
          const isCompleted = completedSteps.has(index);
          const isCurrent = currentStep === index;
          const isClickable = isCompleted || index <= currentStep;

          return (
            <li key={step.label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick(index as WizardStep)}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors
                  ${isClickable ? "cursor-pointer" : "cursor-default"}
                  ${isCurrent ? "bg-primary/15" : "hover:bg-muted"}
                  disabled:opacity-30`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold
                    ${isCompleted ? "bg-foreground text-background" : ""}
                    ${isCurrent && !isCompleted ? "bg-primary text-primary-foreground" : ""}
                    ${!isCurrent && !isCompleted ? "bg-muted text-muted-foreground" : ""}`}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : index + 1}
                </span>
                <span
                  className={`hidden font-medium md:inline
                    ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {step.label}
                </span>
              </button>

              {index < WIZARD_STEPS.length - 1 && (
                <div className={`hidden h-px w-4 md:block lg:w-8 ${isCompleted ? "bg-foreground/30" : "bg-border"}`} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
