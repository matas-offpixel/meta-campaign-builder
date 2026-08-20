"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import {
  deleteTikTokTemplateFromDb,
  loadTikTokTemplatesFromDb,
  saveTikTokTemplateToDb,
} from "@/lib/db/tiktok-templates";
import { createClient } from "@/lib/supabase/client";
import {
  resolveTikTokDraftIdentityBcIdOnLoad,
  tikTokIdentityBcIdIsServerResolvable,
  type TikTokIdentityBcIdResolution,
} from "@/lib/tiktok-wizard/migrate-draft";
import {
  applyTikTokTemplate,
  type TikTokCampaignTemplate,
} from "@/lib/tiktok-wizard/templates";
import type { TikTokIdentity } from "@/lib/tiktok/identity";
import {
  validateTikTokWizardStep,
  type TikTokWizardValidationIssue,
} from "@/lib/tiktok-wizard/validation";
import {
  TIKTOK_WIZARD_STEPS,
  type TikTokCampaignDraft,
} from "@/lib/types/tiktok-draft";
import { TikTokLoadTemplateModal } from "./load-template-modal";
import { AccountSetupStep } from "./steps/account-setup";
import { CampaignSetupStep } from "./steps/campaign-setup";
import { OptimisationStrategyStep } from "./steps/optimisation-strategy";
import { AudiencesStep } from "./steps/audiences";
import { CreativesStep } from "./steps/creatives";
import { BudgetScheduleStep } from "./steps/budget-schedule";
import { AssignCreativesStep } from "./steps/assign-creatives";
import { ReviewLaunchStep } from "./steps/review-launch";
import { TikTokWizardFooter, type TikTokSaveStatus } from "./wizard-footer";

export interface TikTokWizardContext {
  eventName?: string | null;
  eventDate?: string | null;
  clientName?: string | null;
  advertiserName?: string | null;
  eventEditPath?: string | null;
  writesEnabled?: boolean;
  writesDisabledReason?: string | null;
  identityBcIdResolution?: TikTokIdentityBcIdResolution;
}

export function TikTokWizardShell({
  draft,
  context,
}: {
  draft: TikTokCampaignDraft;
  context?: TikTokWizardContext;
}) {
  const [step, setStep] = useState(0);
  const [workingDraft, setWorkingDraft] = useState(draft);
  const workingDraftRef = useRef(workingDraft);
  workingDraftRef.current = workingDraft;
  const saveQueue = useRef(Promise.resolve());
  const [saveStatus, setSaveStatus] = useState<TikTokSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TikTokCampaignTemplate[]>([]);
  const [identityBcIdResolution, setIdentityBcIdResolution] =
    useState<TikTokIdentityBcIdResolution>("idle");
  const identityHealStarted = useRef(false);
  const CurrentStep = useMemo(
    () => STEP_COMPONENTS[step] ?? AccountSetupStep,
    [step],
  );
  const validationContext = { eventEditPath: context?.eventEditPath ?? null };
  const currentIssues = validateTikTokWizardStep(
    workingDraft,
    step,
    validationContext,
  );
  const blocksNext = currentIssues.some((issue) => issue.blocksContinue);

  useEffect(() => {
    if (identityHealStarted.current) return;
    const current = workingDraftRef.current;
    if (!tikTokIdentityBcIdIsServerResolvable(current)) return;
    const advertiserId = current.accountSetup.advertiserId;
    if (!advertiserId) return;
    identityHealStarted.current = true;
    setIdentityBcIdResolution("pending");
    void resolveTikTokDraftIdentityBcIdOnLoad({
      draft: current,
      fetchIdentities: async () => {
        const res = await fetch(
          `/api/tiktok/identities?advertiser_id=${encodeURIComponent(advertiserId)}`,
        );
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; identities?: TikTokIdentity[] }
          | null;
        return json?.identities ?? [];
      },
      persist: async (next) => {
        await saveDraftNow({
          accountSetup: next.accountSetup,
        });
      },
    }).then((status) => {
      setIdentityBcIdResolution(status === "resolved" ? "idle" : "unresolved");
    });
  }, []);

  async function saveDraftNow(patch: Partial<TikTokCampaignDraft>) {
    const current = workingDraftRef.current;
    const optimistic = mergeDraft(current, patch);
    workingDraftRef.current = optimistic;
    setWorkingDraft(optimistic);
    const res = await fetch(`/api/tiktok/drafts/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = (await res.json().catch(() => null)) as
      | { ok: true; draft: TikTokCampaignDraft }
      | { ok: false; error: string }
      | null;
    if (!res.ok || !json?.ok) {
      workingDraftRef.current = current;
      setWorkingDraft(current);
      throw new Error(json && !json.ok ? json.error : "Failed to save draft");
    }
    workingDraftRef.current = json.draft;
    setWorkingDraft(json.draft);
  }

  function saveDraft(patch: Partial<TikTokCampaignDraft>) {
    const run = saveQueue.current.then(() => saveDraftNow(patch));
    saveQueue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function currentUserId(): Promise<string | null> {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  }

  async function handleSaveDraft() {
    setSaveStatus("saving");
    setSaveError(null);
    try {
      await saveDraft({});
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      setSaveStatus("idle");
      setSaveError(err instanceof Error ? err.message : "Failed to save draft");
    }
  }

  async function handleSaveTemplate(name: string, description: string, tags: string[]) {
    const userId = await currentUserId();
    if (!userId) {
      setTemplateSaveError("Not signed in");
      return;
    }
    setTemplateSaving(true);
    setTemplateSaveError(null);
    setTemplateSaveSuccess(false);
    try {
      await saveTikTokTemplateToDb(workingDraftRef.current, name, description, tags, userId);
      setTemplateSaveSuccess(true);
    } catch (err) {
      setTemplateSaveError(
        err instanceof Error ? err.message : "Unknown error saving template",
      );
    } finally {
      setTemplateSaving(false);
    }
  }

  async function handleOpenLoadModal() {
    setLoadTemplateOpen(true);
    const userId = await currentUserId();
    if (!userId) return;
    setTemplatesLoading(true);
    try {
      setTemplates(await loadTikTokTemplatesFromDb(userId));
    } catch (err) {
      console.warn("Failed to fetch TikTok templates:", err);
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function handleLoadTemplate(template: TikTokCampaignTemplate) {
    const previous = workingDraftRef.current;
    const next = applyTikTokTemplate(template, previous.id);
    setWorkingDraft(next);
    workingDraftRef.current = next;
    try {
      await saveDraft(next);
      setStep(0);
      setLoadTemplateOpen(false);
      setSaveError(null);
    } catch (err) {
      workingDraftRef.current = previous;
      setWorkingDraft(previous);
      setSaveError(
        err instanceof Error ? err.message : "Failed to load template",
      );
    }
  }

  async function handleDeleteTemplate(id: string) {
    setTemplates((prev) => prev.filter((template) => template.id !== id));
    setDeletingTemplateId(id);
    try {
      await deleteTikTokTemplateFromDb(id);
    } catch (err) {
      console.error("Failed to delete TikTok template:", err);
      const userId = await currentUserId();
      if (userId) setTemplates(await loadTikTokTemplatesFromDb(userId));
    } finally {
      setDeletingTemplateId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            TikTok campaign creator
          </p>
          <h1 className="mt-2 font-heading text-3xl">TikTok campaign draft</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Build the TikTok campaign configuration step by step. Launch writes
            stay behind OFFPIXEL_TIKTOK_WRITES_ENABLED and never enable Smart+
            or automated-ad enhancements.
          </p>
        </div>

        <ol className="mb-8 grid gap-2 md:grid-cols-4">
          {TIKTOK_WIZARD_STEPS.map((label, index) => (
            <li key={label}>
              <button
                id={`tiktok-step-${index}`}
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
          <StepValidationMessages issues={currentIssues} />
          <CurrentStep
            draft={workingDraft}
            onSave={saveDraft}
            context={{
              ...context,
              identityBcIdResolution,
            }}
          />
        </section>

        <TikTokWizardFooter
          currentStep={step}
          canContinue={!blocksNext}
          saveStatus={saveStatus}
          saveError={saveError}
          onBack={() => setStep((s) => Math.max(0, s - 1))}
          onContinue={() =>
            setStep((s) => Math.min(TIKTOK_WIZARD_STEPS.length - 1, s + 1))
          }
          onSaveDraft={() => void handleSaveDraft()}
          onSaveTemplate={() => {
            setSaveTemplateOpen(true);
            setTemplateSaveSuccess(false);
            setTemplateSaveError(null);
          }}
          onLoadTemplate={() => void handleOpenLoadModal()}
        />
      </div>

      <SaveTemplateModal
        open={saveTemplateOpen}
        saving={templateSaving}
        savedSuccessfully={templateSaveSuccess}
        error={templateSaveError}
        onClose={() => {
          setSaveTemplateOpen(false);
          setTemplateSaveSuccess(false);
          setTemplateSaveError(null);
        }}
        onSave={handleSaveTemplate}
      />
      <TikTokLoadTemplateModal
        open={loadTemplateOpen}
        templates={templates}
        loading={templatesLoading}
        deletingId={deletingTemplateId}
        onClose={() => setLoadTemplateOpen(false)}
        onSelect={(template) => void handleLoadTemplate(template)}
        onDelete={(id) => void handleDeleteTemplate(id)}
      />
    </main>
  );
}

type StepProps = {
  draft: TikTokCampaignDraft;
  onSave: (patch: Partial<TikTokCampaignDraft>) => Promise<void>;
  context?: TikTokWizardContext;
};

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

function mergeDraft(
  current: TikTokCampaignDraft,
  patch: Partial<TikTokCampaignDraft>,
): TikTokCampaignDraft {
  return {
    ...current,
    ...patch,
    accountSetup: { ...current.accountSetup, ...(patch.accountSetup ?? {}) },
    campaignSetup: { ...current.campaignSetup, ...(patch.campaignSetup ?? {}) },
    optimisation: { ...current.optimisation, ...(patch.optimisation ?? {}) },
    audiences: { ...current.audiences, ...(patch.audiences ?? {}) },
    creatives: { ...current.creatives, ...(patch.creatives ?? {}) },
    budgetSchedule: {
      ...current.budgetSchedule,
      ...(patch.budgetSchedule ?? {}),
    },
    creativeAssignments: {
      ...current.creativeAssignments,
      ...(patch.creativeAssignments ?? {}),
    },
  };
}

function StepValidationMessages({
  issues,
}: {
  issues: TikTokWizardValidationIssue[];
}) {
  if (issues.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {issues.map((issue) => (
        <p
          key={issue.id}
          className={`rounded-md border p-3 text-sm ${
            issue.severity === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}
        >
          <span className="font-medium">{issue.label}: </span>
          {issue.message}
        </p>
      ))}
    </div>
  );
}
