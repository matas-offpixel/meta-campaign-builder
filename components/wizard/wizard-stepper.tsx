"use client";

import { useRouter } from "next/navigation";
import { Check, LogOut } from "lucide-react";
import { WIZARD_STEPS, type WizardStep } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { clearFacebookTokenStorage } from "@/lib/facebook-token-storage";

interface WizardStepperProps {
  currentStep: WizardStep;
  completedSteps: Set<number>;
  /**
   * Step indices that should be rendered in the stepper. When omitted,
   * defaults to all steps (preserves the legacy 8-step layout for any
   * caller that hasn't been updated yet).
   */
  visibleSteps?: WizardStep[];
  onStepClick: (step: WizardStep) => void;
}

export function WizardStepper({
  currentStep,
  completedSteps,
  visibleSteps,
  onStepClick,
}: WizardStepperProps) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    clearFacebookTokenStorage();
    router.push("/login");
  };

  const indices: WizardStep[] =
    visibleSteps && visibleSteps.length > 0
      ? visibleSteps
      : (WIZARD_STEPS.map((_, i) => i) as WizardStep[]);

  return (
    <nav className="w-full border-b border-border bg-card px-4 py-3">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <ol className="flex items-center">
          {indices.map((index, position) => {
            const step = WIZARD_STEPS[index];
            const isCompleted = completedSteps.has(index);
            const isCurrent = currentStep === index;
            // Clickable when the step is completed OR is at-or-before the
            // current visible position (so users can revisit prior visible
            // steps but can't jump ahead past validation).
            const currentPosition = indices.indexOf(currentStep);
            const isClickable =
              isCompleted ||
              (currentPosition !== -1 && position <= currentPosition);

            return (
              <li key={step.label} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => isClickable && onStepClick(index)}
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
                    {isCompleted ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : position + 1}
                  </span>
                  <span
                    className={`hidden font-medium md:inline
                      ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {step.label}
                  </span>
                </button>

                {position < indices.length - 1 && (
                  <div className={`hidden h-px w-4 md:block lg:w-8 ${isCompleted ? "bg-foreground/30" : "bg-border"}`} />
                )}
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          onClick={handleLogout}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground
            hover:text-foreground hover:bg-muted transition-colors"
        >
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Log out</span>
        </button>
      </div>
    </nav>
  );
}
