"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import { StatusLine, StepSurfaceProvider } from "@/components/steps/step-surface";
import { AccountSetupStep } from "@/components/tiktok-wizard/steps/account-setup";
import { AssignCreativesStep } from "@/components/tiktok-wizard/steps/assign-creatives";
import { AudiencesStep } from "@/components/tiktok-wizard/steps/audiences";
import { BudgetScheduleStep } from "@/components/tiktok-wizard/steps/budget-schedule";
import { CampaignSetupStep } from "@/components/tiktok-wizard/steps/campaign-setup";
import { CreativesStep } from "@/components/tiktok-wizard/steps/creatives";
import { OptimisationStrategyStep } from "@/components/tiktok-wizard/steps/optimisation-strategy";
import { ReviewLaunchStep } from "@/components/tiktok-wizard/steps/review-launch";
import { TikTokLoadTemplateModal } from "@/components/tiktok-wizard/load-template-modal";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import { listClients } from "@/lib/db/clients";
import {
  deleteTikTokTemplateFromDb,
  loadTikTokTemplatesFromDb,
  saveTikTokTemplateToDb,
} from "@/lib/db/tiktok-templates";
import type { LinkedPlanSummary } from "@/lib/plan/linked-plan";
import { createClient } from "@/lib/supabase/client";
import {
  resolveTikTokDraftIdentityBcIdOnLoad,
  tikTokIdentityBcIdIsServerResolvable,
  type TikTokIdentityBcIdResolution,
} from "@/lib/tiktok-wizard/migrate-draft";
import {
  applyTikTokTemplate,
  consumeTikTokTemplateAccountNotice,
  type TikTokCampaignTemplate,
} from "@/lib/tiktok-wizard/templates";
import type { TikTokIdentity } from "@/lib/tiktok/identity";
import {
  hasBlockingTikTokWizardIssues,
  validateTikTokWizardStep,
} from "@/lib/tiktok-wizard/validation";
import {
  TIKTOK_WIZARD_STEPS,
  type TikTokCampaignDraft,
} from "@/lib/types/tiktok-draft";
import type { WizardStep } from "@/lib/types";
import { useTikTokDraft } from "@/lib/wizard/use-tiktok-draft";

export interface TikTokWizardContext {
  eventName?: string | null;
  eventDate?: string | null;
  clientName?: string | null;
  advertiserName?: string | null;
  eventEditPath?: string | null;
  writesEnabled?: boolean;
  writesDisabledReason?: string | null;
  identityBcIdResolution?: TikTokIdentityBcIdResolution;
  flushPendingSaves?: () => Promise<void>;
  readWorkingDraft?: () => TikTokCampaignDraft;
}

const STANDALONE_STEPS: WizardStep[] = [0, 1, 2, 3, 4, 5, 6, 7];
const PLAN_LINKED_STEPS: WizardStep[] = [0, 1, 2, 3, 4, 5, 6];

export function TikTokWizardShell({
  draft,
  context,
  linkedPlan = null,
}: {
  draft: TikTokCampaignDraft;
  context?: TikTokWizardContext;
  linkedPlan?: LinkedPlanSummary | null;
}) {
  const router = useRouter();
  const controller = useTikTokDraft(draft.id, draft);
  const { draft: working, saveDraft, flush, saveStatus, setDraft, draftRef } = controller;
  const [step, setStep] = useState<WizardStep>(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [identityBcIdResolution, setIdentityBcIdResolution] =
    useState<TikTokIdentityBcIdResolution>("idle");
  const [templateAccountNotice, setTemplateAccountNotice] = useState<string | null>(
    () => consumeTikTokTemplateAccountNotice(draft.id),
  );
  const identityHealStarted = useRef(false);

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<TikTokCampaignTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [templateClientNameById, setTemplateClientNameById] = useState<
    Record<string, string>
  >({});
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (identityHealStarted.current) return;
    const current = controller.draftRef.current;
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
        await controller.saveDraft({ accountSetup: next.accountSetup });
      },
    }).then((status) => {
      setIdentityBcIdResolution(status === "resolved" ? "idle" : "unresolved");
    });
  }, [controller]);

  const wizardContext: TikTokWizardContext = {
    ...context,
    identityBcIdResolution,
    flushPendingSaves: flush,
    readWorkingDraft: () => draftRef.current,
  };

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

  const blocking = hasBlockingTikTokWizardIssues(working, step, {
    eventEditPath: context?.eventEditPath ?? null,
  });
  const validationErrors = validateTikTokWizardStep(working, step, {
    eventEditPath: context?.eventEditPath ?? null,
  })
    .filter((issue) => issue.blocksContinue)
    .map((issue) => issue.message);

  const openTemplates = useCallback(async () => {
    setTemplateOpen(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setTemplatesLoading(true);
    try {
      const [fetched, clients] = await Promise.all([
        loadTikTokTemplatesFromDb(user.id),
        listClients(user.id),
      ]);
      setTemplates(fetched);
      setTemplateClientNameById(
        Object.fromEntries(clients.map((client) => [client.id, client.name])),
      );
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  const loadTemplate = useCallback(
    async (template: TikTokCampaignTemplate) => {
      const previous = draftRef.current;
      const applied = applyTikTokTemplate(
        template,
        previous.id,
        previous.clientId,
        previous.eventId,
      );
      const next = {
        ...applied.draft,
        campaignSetup: {
          ...applied.draft.campaignSetup,
          eventCode: previous.campaignSetup.eventCode,
        },
      };
      setDraft(next);
      await saveDraft(next);
      setCompletedSteps(new Set());
      setStep(0);
      setTemplateOpen(false);
    },
    [draftRef, saveDraft, setDraft],
  );

  return (
    <StepSurfaceProvider surface="wizard" planOwnsDestination={linkedPlan != null}>
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <div className="border-b border-border bg-card px-6 py-2">
          <div className="mx-auto max-w-5xl">
            <button
              type="button"
              onClick={() => {
                void flush();
                router.push("/");
              }}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              Campaign Library
            </button>
          </div>
        </div>

        <WizardStepper
          currentStep={step}
          completedSteps={completedSteps}
          visibleSteps={visibleSteps}
          steps={TIKTOK_WIZARD_STEPS}
          onStepClick={handleStepClick}
        />

        <main className="mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-6 py-6">
          {templateAccountNotice ? (
            <StatusLine className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm">
              {templateAccountNotice}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => setTemplateAccountNotice(null)}
              >
                dismiss
              </button>
            </StatusLine>
          ) : null}

          {step === 0 ? (
            <AccountSetupStep surface="wizard" draft={working} onSave={saveDraft} />
          ) : null}
          {step === 1 ? (
            <CampaignSetupStep
              surface="wizard"
              draft={working}
              onSave={saveDraft}
              context={wizardContext}
            />
          ) : null}
          {step === 2 ? (
            <OptimisationStrategyStep surface="wizard" draft={working} onSave={saveDraft} />
          ) : null}
          {step === 3 ? (
            <AudiencesStep surface="wizard" draft={working} onSave={saveDraft} />
          ) : null}
          {step === 4 ? (
            <CreativesStep surface="wizard" draft={working} onSave={saveDraft} />
          ) : null}
          {step === 5 ? (
            <BudgetScheduleStep surface="wizard" draft={working} onSave={saveDraft} />
          ) : null}
          {step === 6 ? (
            <AssignCreativesStep surface="wizard" draft={working} onSave={saveDraft} />
          ) : null}
          {/*
            Launch stays here for a standalone draft and only there: a
            plan-linked draft launches from the canvas, paused, with the
            other channels. Rendering ReviewLaunch twice would be two
            ways to create ACTIVE.
          */}
          {step === 7 && !linkedPlan ? (
            <ReviewLaunchStep
              surface="wizard"
              draft={working}
              onSave={saveDraft}
              context={wizardContext}
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
          planHref={linkedPlan ? `/plan/${linkedPlan.id}` : null}
          onBack={handleBack}
          onContinue={handleContinue}
          onSaveDraft={() => {
            void flush();
          }}
          onLaunch={() => undefined}
          onSaveTemplate={() => {
            setSaveTemplateOpen(true);
            setTemplateSaveSuccess(false);
            setTemplateSaveError(null);
          }}
          onLoadTemplate={() => void openTemplates()}
        />

        <TikTokLoadTemplateModal
          open={templateOpen}
          templates={templates}
          clientNameById={templateClientNameById}
          loading={templatesLoading}
          deletingId={deletingTemplateId}
          onClose={() => setTemplateOpen(false)}
          onSelect={(template) => void loadTemplate(template)}
          onDelete={(id) => {
            setDeletingTemplateId(id);
            void deleteTikTokTemplateFromDb(id)
              .then(() => setTemplates((prev) => prev.filter((t) => t.id !== id)))
              .finally(() => setDeletingTemplateId(null));
          }}
        />
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
          onSave={async (name, description, tags) => {
            const supabase = createClient();
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (!user) {
              setTemplateSaveError("Not signed in");
              return;
            }
            setTemplateSaving(true);
            setTemplateSaveError(null);
            setTemplateSaveSuccess(false);
            try {
              await saveTikTokTemplateToDb(
                draftRef.current,
                name,
                description,
                tags,
                user.id,
              );
              setTemplateSaveSuccess(true);
            } catch (err) {
              setTemplateSaveError(
                err instanceof Error ? err.message : "Unknown error saving template",
              );
            } finally {
              setTemplateSaving(false);
            }
          }}
        />
      </div>
    </StepSurfaceProvider>
  );
}
