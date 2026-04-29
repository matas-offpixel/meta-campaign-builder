"use client";

import { useMemo, useState } from "react";

import {
  TIKTOK_WIZARD_STEPS,
  type TikTokCampaignDraft,
} from "@/lib/types/tiktok-draft";
import { AccountSetupStep } from "./steps/account-setup";
import { CampaignSetupStep } from "./steps/campaign-setup";
import { OptimisationStrategyStep } from "./steps/optimisation-strategy";
import { AudiencesStep } from "./steps/audiences";
import { CreativesStep } from "./steps/creatives";
import { BudgetScheduleStep } from "./steps/budget-schedule";
import { AssignCreativesStep } from "./steps/assign-creatives";
import { ReviewLaunchStep } from "./steps/review-launch";

export function TikTokWizardShell({ draft }: { draft: TikTokCampaignDraft }) {
  const [step, setStep] = useState(0);
  const CurrentStep = useMemo(() => STEP_COMPONENTS[step] ?? AccountSetupStep, [step]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            TikTok campaign creator
          </p>
          <h1 className="mt-2 font-heading text-3xl">Campaign draft foundation</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Skeleton only. Functional TikTok wizard steps and launch writes come
            after architecture sign-off.
          </p>
        </div>

        <ol className="mb-8 grid gap-2 md:grid-cols-4">
          {TIKTOK_WIZARD_STEPS.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(index)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                  index === step
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                <span className="mr-2 tabular-nums">{index + 1}.</span>
                {label}
              </button>
            </li>
          ))}
        </ol>

        <section className="rounded-lg border border-border bg-card p-6">
          <CurrentStep draft={draft} />
        </section>

        <div className="mt-6 flex justify-between">
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-40"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
            disabled={step === TIKTOK_WIZARD_STEPS.length - 1}
            onClick={() =>
              setStep((s) => Math.min(TIKTOK_WIZARD_STEPS.length - 1, s + 1))
            }
          >
            Next
          </button>
        </div>
      </div>
    </main>
  );
}

type StepProps = { draft: TikTokCampaignDraft };

const STEP_COMPONENTS: Array<(props: StepProps) => React.ReactNode> = [
  AccountSetupStep,
  CampaignSetupStep,
  OptimisationStrategyStep,
  AudiencesStep,
  CreativesStep,
  BudgetScheduleStep,
  AssignCreativesStep,
  ReviewLaunchStep,
];
