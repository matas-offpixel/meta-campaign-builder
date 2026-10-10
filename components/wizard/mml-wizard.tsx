"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

import { AssignCreatives } from "@/components/steps/assign-creatives";
import { BudgetSchedule } from "@/components/steps/budget-schedule";
import { Creatives } from "@/components/steps/creatives";
import { OptimisationStrategy } from "@/components/steps/optimisation-strategy";
import { StepSurfaceProvider } from "@/components/steps/step-surface";
import { MmlStepAudiences } from "@/components/wizard/mml-step-audiences";
import { MmlStepClient } from "@/components/wizard/mml-step-client";
import { MmlStepObjective } from "@/components/wizard/mml-step-objective";
import { MmlTikTokReelRow } from "@/components/wizard/mml-tiktok-reel-row";
import { WizardFooter } from "@/components/wizard/wizard-footer";
import { WizardStepper } from "@/components/wizard/wizard-stepper";
import type { GoogleAdsAccountOption } from "@/components/wizard/mml-step-client";
import type { ResolvedChannelDefaults } from "@/lib/clients/channel-defaults";
import type { PlanEventOption } from "@/lib/plan/event-picker";
import type { IdentityNameMap } from "@/lib/plan/identity-chips";
import { MML_LIST_PATH } from "@/lib/plan/mml-routes";
import { PLAN_STEP2_HASH } from "@/lib/plan/schedule";
import {
  MML_WIZARD_STEPS,
  googleChannelAvailable,
  initialMmlChannels,
  isMmlWizardStep,
  metaValidateStepForMml,
  mmlClientStepBlockers,
  mmlPlaceholderLine,
  mmlWizardHref,
  readMmlWizardLocation,
  type MmlChannel,
  type MmlChannelSelection,
  type MmlWizardLocation,
  type MmlWizardStep,
} from "@/lib/plan/mml-wizard";
import type { PlanAdapterName, CampaignPlan } from "@/lib/plan/types";
import { attachedAdSetKey, type AdSetSuggestion, type AudienceSettings, type WizardStep } from "@/lib/types";
import { validateStep } from "@/lib/validation";
import { useCampaignDraft } from "@/lib/wizard/use-campaign-draft";
import { splitRotationOntoOwnAdSet } from "@/lib/wizard/split-rotation-adset";
import {
  EventEndDateSync,
  WizardEventContextProvider,
} from "@/lib/wizard/use-event-context";

const VISIBLE: WizardStep[] = [0, 1, 2, 3, 4, 5, 6, 7];

export function MmlWizard({
  plan,
  events,
  resolved,
  identityNames,
  googleAdsAccounts,
  drawerOpen,
  onPatchIntent,
  onOpenDrawer,
  onSave,
  launch,
  benchmarks,
}: {
  plan: CampaignPlan;
  events: PlanEventOption[];
  resolved: ResolvedChannelDefaults | null;
  identityNames: IdentityNameMap;
  googleAdsAccounts: GoogleAdsAccountOption[];
  drawerOpen: boolean;
  onPatchIntent: (patch: Partial<CampaignPlan["intent"]>) => void;
  onOpenDrawer: (adapter: PlanAdapterName) => void;
  onSave: () => Promise<boolean>;
  launch: ReactNode;
  benchmarks: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [location, setLocation] = useState<MmlWizardLocation>({ step: 0, channel: "meta" });
  const [locationReady, setLocationReady] = useState(false);
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [reported, setReported] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const selectedEvent = events.find((event) => event.id === plan.intent.eventId) ?? null;
  const googleOk = googleChannelAvailable(selectedEvent?.googleCustomerId);
  const [channels, setChannels] = useState<MmlChannelSelection>(() =>
    initialMmlChannels({
      metaDraft: Boolean(plan.launches.meta.draftId),
      tiktokDraft: Boolean(plan.launches.tiktok.draftId),
      googleDraft: Boolean(plan.launches.google.draftId),
      metaDaily: plan.intent.budget.metaDaily,
      tiktokDaily: plan.intent.budget.tiktokDaily,
      googleDaily: plan.intent.budget.googleDaily,
      googleAvailable: googleOk,
    }),
  );
  const [identity, setIdentity] = useState({
    clientId: selectedEvent?.clientId ?? null,
    metaAdAccountId: null as string | null,
    tiktokAdvertiserId: null as string | null,
    googleCustomerId: null as string | null,
  });
  const onIdentity = useCallback((next: typeof identity) => {
    setIdentity((current) =>
      current.clientId === next.clientId &&
      current.metaAdAccountId === next.metaAdAccountId &&
      current.tiktokAdvertiserId === next.tiktokAdvertiserId &&
      current.googleCustomerId === next.googleCustomerId
        ? current
        : next,
    );
  }, []);
  const onBlockers = useCallback((next: string[]) => setReported(next), []);
  const onChannel = useCallback((channel: MmlChannel) => {
    setLocation((current) => ({ ...current, channel }));
  }, []);

  useEffect(() => {
    setLocation(readMmlWizardLocation(searchParams));
    setLocationReady(true);
    // Read the landing URL once. Later replaces are this component writing the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!locationReady || drawerOpen) return;
    const next = mmlWizardHref(pathname, location, searchParams);
    const current = `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`;
    if (next !== current) router.replace(next, { scroll: false });
    // searchParams is the comparison basis. Rewriting it must not loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location, locationReady, drawerOpen, pathname, router]);

  const step = location.step;
  const channel = location.channel;

  useEffect(() => {
    if (step === 3) return;
    if (step < 3 || step > 6 || channel !== "meta") setReported([]);
  }, [step, channel]);

  const stepErrors = useMemo(() => {
    if (step !== 0) return reported;
    return mmlClientStepBlockers({
      clientId: identity.clientId,
      eventId: plan.intent.eventId || null,
      channels,
      metaAdAccountId: identity.metaAdAccountId,
      tiktokAdvertiserId: identity.tiktokAdvertiserId,
      googleCustomerId: identity.googleCustomerId,
    });
  }, [step, reported, identity, plan.intent.eventId, channels]);

  function go(next: MmlWizardStep) {
    setLocation((current) => ({ ...current, step: next }));
  }

  function continueStep() {
    if (step >= 7) return;
    setCompleted((prev) => new Set([...prev, step]));
    go((step + 1) as MmlWizardStep);
  }

  const shared = {
    plan,
    events,
    resolved,
    identityNames,
    googleAdsAccounts,
    channels,
    onChannels: (next: MmlChannelSelection) => {
      if (!googleOk) next = { ...next, google: false };
      setChannels(next);
    },
    onEvent: (eventId: string) => onPatchIntent({ eventId }),
    onDestination: (destinationUrl: string) => onPatchIntent({ destinationUrl }),
    onPatchIntent,
    onOpenDrawer,
    onIdentity,
    onBlockers,
    onChannel,
    channel,
    launch,
    benchmarks,
  };

  return (
    <StepSurfaceProvider surface="wizard" planOwnsDestination>
      <div id={PLAN_STEP2_HASH} className="flex flex-col" data-mml-wizard="">
        <div className="border-b border-border bg-card px-6 py-2">
          <div className="mx-auto max-w-5xl">
            <a
              href={MML_LIST_PATH}
              className="-ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" />
              MML
            </a>
          </div>
        </div>
        <WizardStepper
          currentStep={step}
          completedSteps={completed}
          visibleSteps={VISIBLE}
          steps={MML_WIZARD_STEPS}
          onStepClick={(next) => {
            if (isMmlWizardStep(next)) go(next);
          }}
        />
        <main className="flex-1 px-6 py-6" data-mml-step={step}>
          {plan.launches.meta.draftId ? (
            <MmlDraftSteps draftId={plan.launches.meta.draftId} step={step} {...shared} />
          ) : (
            <MmlStepsWithoutDraft step={step} {...shared} />
          )}
        </main>
        <WizardFooter
          currentStep={step}
          visibleSteps={VISIBLE}
          canContinue={stepErrors.length === 0}
          validationErrors={stepErrors}
          saveStatus={saveStatus}
          showLaunch={false}
          showTemplates={false}
          onBack={() => {
            if (step > 0) go((step - 1) as MmlWizardStep);
          }}
          onContinue={continueStep}
          onSaveDraft={() => {
            setSaveStatus("saving");
            void onSave().then((ok) => setSaveStatus(ok ? "saved" : "idle"));
          }}
          onLaunch={() => {}}
          onSaveTemplate={() => {}}
          onLoadTemplate={() => {}}
        />
      </div>
    </StepSurfaceProvider>
  );
}

type Shared = {
  plan: CampaignPlan;
  events: PlanEventOption[];
  resolved: ResolvedChannelDefaults | null;
  identityNames: IdentityNameMap;
  googleAdsAccounts: GoogleAdsAccountOption[];
  channels: MmlChannelSelection;
  onChannels: (next: MmlChannelSelection) => void;
  onEvent: (eventId: string) => void;
  onDestination: (url: string) => void;
  onOpenDrawer: (adapter: PlanAdapterName) => void;
  onIdentity: (identity: {
    clientId: string | null;
    metaAdAccountId: string | null;
    tiktokAdvertiserId: string | null;
    googleCustomerId: string | null;
  }) => void;
  onBlockers: (errors: string[]) => void;
  onChannel: (channel: MmlChannel) => void;
  channel: MmlChannel;
  launch: ReactNode;
  benchmarks: ReactNode;
  onPatchIntent: (patch: Partial<CampaignPlan["intent"]>) => void;
};

function MmlDraftSteps({ draftId, step, ...shared }: { draftId: string; step: MmlWizardStep } & Shared) {
  const controller = useCampaignDraft(draftId);
  const { draft, hydrated, updateSettings, updateDraft, updateAudiences, handlePageInstagramOverride } = controller;
  return (
    <WizardEventContextProvider draftId={draftId} eventId={draft.settings.eventId} enabled={hydrated}>
      <EventEndDateSync draft={draft} updateDraft={updateDraft} />
      <MmlStepSwitch
        step={step}
        {...shared}
        draft={hydrated ? draft : null}
        onSettings={updateSettings}
        onApplyDraft={updateDraft}
        onAudiences={updateAudiences}
        onPageInstagramOverride={handlePageInstagramOverride}
        meta={
          hydrated ? (
            <MetaStepBody
              step={step}
              channel={shared.channel}
              controller={controller}
              resolved={shared.resolved}
              onBlockers={shared.onBlockers}
              plan={shared.plan}
              channels={shared.channels}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading the Meta draft…</p>
          )
        }
      />
    </WizardEventContextProvider>
  );
}

function MmlStepsWithoutDraft({ step, ...shared }: { step: MmlWizardStep } & Shared) {
  return (
    <MmlStepSwitch
      step={step}
      {...shared}
      draft={null}
      onSettings={() => {}}
      onApplyDraft={() => {}}
      onAudiences={() => {}}
      onPageInstagramOverride={() => {}}
      meta={
        <DrawerLine
          line="This plan has no Meta draft yet."
          channels={shared.channels}
          onOpenDrawer={shared.onOpenDrawer}
        />
      }
    />
  );
}

function MmlStepSwitch({
  step,
  draft,
  onSettings,
  onApplyDraft,
  onAudiences,
  onPageInstagramOverride,
  meta,
  ...shared
}: {
  step: MmlWizardStep;
  draft: ReturnType<typeof useCampaignDraft>["draft"] | null;
  onSettings: (settings: ReturnType<typeof useCampaignDraft>["draft"]["settings"]) => void;
  onApplyDraft: (updater: (draft: ReturnType<typeof useCampaignDraft>["draft"]) => ReturnType<typeof useCampaignDraft>["draft"]) => void;
  onAudiences: (audiences: AudienceSettings) => void;
  onPageInstagramOverride: (pageId: string, igId: string) => void;
  meta: ReactNode;
} & Shared) {
  if (step === 0) {
    return (
      <MmlStepClient
        planId={shared.plan.id}
        events={shared.events}
        eventId={shared.plan.intent.eventId}
        destinationUrl={shared.plan.intent.destinationUrl}
        resolved={shared.resolved}
        identityNames={shared.identityNames}
        googleAdsAccounts={shared.googleAdsAccounts}
        draft={draft}
        tiktokDraftId={shared.plan.launches.tiktok.draftId}
        googleDraftId={shared.plan.launches.google.draftId}
        channels={shared.channels}
        onChannels={shared.onChannels}
        onEvent={shared.onEvent}
        onDestination={shared.onDestination}
        onSettings={onSettings}
        onApplyDraft={onApplyDraft}
        onIdentity={shared.onIdentity}
      />
    );
  }
  if (step === 1) {
    return (
      <MmlStepObjective
        plan={shared.plan}
        draft={draft}
        channels={shared.channels}
        tiktokDraftId={shared.plan.launches.tiktok.draftId}
        onPatchIntent={shared.onPatchIntent}
        onApplyDraft={onApplyDraft}
      />
    );
  }
  if (step === 3) {
    return (
      <MmlStepAudiences
        channels={shared.channels}
        draft={draft}
        resolved={shared.resolved}
        events={shared.events}
        eventId={shared.plan.intent.eventId}
        tiktokDraftId={shared.plan.launches.tiktok.draftId}
        googleDraftId={shared.plan.launches.google.draftId}
        onAudiences={onAudiences}
        onSettings={onSettings}
        onPageInstagramOverride={onPageInstagramOverride}
        onBlockers={shared.onBlockers}
      />
    );
  }
  if (step === 2) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        {shared.benchmarks}
        {meta}
      </div>
    );
  }
  if (step === 7) return <div className="mx-auto max-w-5xl">{shared.launch}</div>;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <ChannelPills channels={shared.channels} channel={shared.channel} onChannel={shared.onChannel} />
      {shared.channel === "meta" ? (
        meta
      ) : (
        <DrawerLine
          line={mmlPlaceholderLine(step)}
          channels={{ meta: false, tiktok: shared.channel === "tiktok", google: shared.channel === "google" }}
          onOpenDrawer={shared.onOpenDrawer}
        />
      )}
    </div>
  );
}

function MetaStepBody({
  step,
  channel,
  controller,
  resolved,
  onBlockers,
  plan,
  channels,
}: {
  step: MmlWizardStep;
  channel: MmlChannel;
  controller: ReturnType<typeof useCampaignDraft>;
  resolved: ResolvedChannelDefaults | null;
  onBlockers: (errors: string[]) => void;
  plan: CampaignPlan;
  channels: MmlChannelSelection;
}) {
  const {
    draft,
    updateSettings,
    updateCreatives,
    updateBudgetSchedule,
    updateAdSetSuggestions,
    markGenerateReplaceImportedConfirmed,
    updateCreativeAssignments,
    updateOptimisationStrategy,
  } = controller;
  const metaStep = channel === "meta" ? metaValidateStepForMml(step) : null;
  const blockerKey = metaStep != null ? validateStep(metaStep, draft, resolved).errors.join("\n") : "";
  useEffect(() => {
    onBlockers(blockerKey ? blockerKey.split("\n") : []);
  }, [blockerKey, onBlockers]);

  if (step === 2) {
    return (
      <OptimisationStrategy
        strategy={draft.optimisationStrategy}
        objective={draft.settings.objective}
        budgetAmount={draft.budgetSchedule.budgetAmount}
        currency={draft.budgetSchedule.currency}
        onChange={updateOptimisationStrategy}
        draftId={draft.id}
        campaignStatus={draft.status}
        clientId={draft.settings.clientId}
      />
    );
  }
  if (step === 4) {
    return (
      <Creatives
        creatives={draft.creatives}
        onChange={updateCreatives}
        settings={draft.settings}
        onSettingsChange={updateSettings}
        adAccountId={draft.settings.metaAdAccountId}
        copyNotes={draft.importMeta?.copyNotes}
        afterActive={
          channels.tiktok
            ? (creative) => (
                <MmlTikTokReelRow
                  key={creative.id}
                  planId={plan.id}
                  objectiveIntent={plan.intent.objectiveIntent}
                  tiktokDraftId={plan.launches.tiktok.draftId}
                  creative={creative}
                />
              )
            : undefined
        }
      />
    );
  }
  if (step === 5) {
    return (
      <BudgetSchedule
        budgetSchedule={draft.budgetSchedule}
        adSetSuggestions={draft.adSetSuggestions}
        audiences={draft.audiences}
        settings={draft.settings}
        onBudgetChange={updateBudgetSchedule}
        onSuggestionsChange={updateAdSetSuggestions}
        onSettingsChange={updateSettings}
        generateReplaceImportedConfirmed={draft.generateReplaceImportedConfirmed}
        onGenerateReplaceImportedConfirmed={markGenerateReplaceImportedConfirmed}
      />
    );
  }
  if (step === 6) {
    const selectedAdSets =
      draft.settings.existingMetaAdSets ??
      (draft.settings.existingMetaAdSet ? [draft.settings.existingMetaAdSet] : []);
    const isAttachAdSet = draft.settings.wizardMode === "attach_adset" && selectedAdSets.length > 0;
    const adSetsForAssign: AdSetSuggestion[] = isAttachAdSet
      ? selectedAdSets.map((row) => ({
          id: attachedAdSetKey(row.id),
          name: row.name,
          sourceType: "page_group",
          sourceId: row.id,
          sourceName: row.name,
          ageMin: 18,
          ageMax: 65,
          budgetPerDay: 0,
          advantagePlus: false,
          enabled: true,
          metaAdSetId: row.id,
        }))
      : draft.adSetSuggestions;
    return (
      <AssignCreatives
        adSets={adSetsForAssign}
        creatives={draft.creatives}
        assignments={draft.creativeAssignments}
        onChange={updateCreativeAssignments}
        onSplitRotation={
          isAttachAdSet
            ? undefined
            : (adSetId, creativeId) => {
                const creative = draft.creatives.find((item) => item.id === creativeId);
                const next = splitRotationOntoOwnAdSet({
                  adSets: draft.adSetSuggestions,
                  assignments: draft.creativeAssignments,
                  adSetId,
                  creativeId,
                  creativeName: creative?.name ?? "",
                  newId: crypto.randomUUID(),
                });
                updateAdSetSuggestions(next.adSets);
                updateCreativeAssignments(next.assignments);
              }
        }
        attachAdSetMode={isAttachAdSet}
      />
    );
  }
  return null;
}

function ChannelPills({
  channels,
  channel,
  onChannel,
}: {
  channels: MmlChannelSelection;
  channel: MmlChannel;
  onChannel: (next: MmlChannel) => void;
}) {
  const pills = (["meta", "tiktok", "google"] as const).filter((name) => channels[name] || name === channel);
  if (pills.length <= 1) return null;
  return (
    <div className="flex gap-2">
      {pills.map((name) => (
        <button
          key={name}
          type="button"
          aria-pressed={name === channel}
          onClick={() => onChannel(name)}
          className={`rounded-full border px-3 py-1 text-xs font-medium ${
            name === channel ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"
          }`}
        >
          {name === "meta" ? "Meta" : name === "tiktok" ? "TikTok" : "Google"}
        </button>
      ))}
    </div>
  );
}

function DrawerLine({
  line,
  channels,
  onOpenDrawer,
}: {
  line: string;
  channels: MmlChannelSelection;
  onOpenDrawer: (adapter: PlanAdapterName) => void;
}) {
  const links = (["meta", "tiktok", "google"] as const).filter((name) => channels[name]);
  return (
    <div className="mx-auto max-w-2xl space-y-2">
      <p className="text-sm text-foreground">{line}</p>
      <div className="flex gap-3">
        {(links.length > 0 ? links : (["meta"] as const)).map((name) => (
          <button
            key={name}
            type="button"
            className="text-sm underline underline-offset-2"
            onClick={() => onOpenDrawer(name)}
          >
            Open {name === "meta" ? "Meta" : name === "tiktok" ? "TikTok" : "Google"}
          </button>
        ))}
      </div>
    </div>
  );
}
