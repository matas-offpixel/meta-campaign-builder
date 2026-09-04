"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { AssignCreativesStep } from "@/components/tiktok-wizard/steps/assign-creatives";
import { AudiencesStep } from "@/components/tiktok-wizard/steps/audiences";
import { CreativesStep } from "@/components/tiktok-wizard/steps/creatives";
import { ReviewLaunchStep } from "@/components/tiktok-wizard/steps/review-launch";
import { TikTokLoadTemplateModal } from "@/components/tiktok-wizard/load-template-modal";
import { SaveTemplateModal } from "@/components/templates/save-template-modal";
import type { TikTokWizardContext } from "@/components/tiktok-wizard/wizard-shell";
import { StepSurfaceProvider } from "@/components/steps/step-surface";
import { BlockerBadge } from "@/components/viz/blocker-badge";
import { Drawer } from "@/components/viz/drawer";
import { InfoTip } from "@/components/viz/info-tip";
import {
  fillTikTokChannelDefaultsIfEmpty,
  type ResolvedChannelDefaults,
} from "@/lib/clients/channel-defaults";
import { listClients } from "@/lib/db/clients";
import {
  deleteTikTokTemplateFromDb,
  loadTikTokTemplatesFromDb,
  saveTikTokTemplateToDb,
} from "@/lib/db/tiktok-templates";
import { createClient } from "@/lib/supabase/client";
import {
  TIKTOK_DRAWER_COPY,
  TIKTOK_DRAWER_TABS,
  isTikTokDrawerTab,
  tabForAnchor,
  tiktokAssignTabVisible,
  tiktokNeedsVideoBlockers,
  type TikTokDrawerTab,
} from "@/lib/plan/drawer";
import { applyTikTokTemplate, type TikTokCampaignTemplate } from "@/lib/tiktok-wizard/templates";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import type { VizStatus } from "@/lib/viz/tokens";
import {
  useTikTokDraft,
  type TikTokDraftController,
} from "@/lib/wizard/use-tiktok-draft";

import { TikTokDrawerDetails } from "./tiktok-drawer-details";

/**
 * Loads the TikTok draft, then renders the drawer. Mounted only while
 * the drawer is open so the draft is fetched on first open.
 */
export function TikTokDrawerMount({
  draftId,
  ...rest
}: { draftId: string } & Omit<Parameters<typeof TikTokDrawer>[0], "controller">) {
  const controller = useTikTokDraft(draftId);
  return <TikTokDrawer controller={controller} {...rest} />;
}

/**
 * The TikTok drawer — the TikTok wizard, from PR 5 on.
 *
 * Two tabs carry what is still judgement (the video, the derived
 * interests). Assignment appears only when there is more than one
 * video. Everything else reads DONE in `details`. Steps mount
 * unchanged behind `surface="drawer"`.
 *
 * `variant="page"` is `/tiktok-campaign/[id]`. A standalone draft
 * keeps Launch; a plan-linked draft does not.
 */
export function TikTokDrawer({
  open,
  controller,
  initialAnchor,
  triggerRef,
  onClose,
  variant = "sheet",
  status = "idle",
  planId = null,
  doneLabel,
  onTabChange,
  wizardContext,
  destinationUrl = "",
  channelDefaults = null,
}: {
  open: boolean;
  controller: TikTokDraftController;
  initialAnchor?: BlockerAnchor | null;
  triggerRef?: RefObject<Element | null>;
  onClose: () => void;
  variant?: "sheet" | "page";
  status?: VizStatus;
  planId?: string | null;
  doneLabel?: string;
  onTabChange?: (tab: string) => void;
  wizardContext?: TikTokWizardContext;
  destinationUrl?: string;
  channelDefaults?: ResolvedChannelDefaults | null;
}) {
  const { draft, hydrated, saveStatus, flush, saveDraft, setDraft, draftRef } = controller;

  const appliedDefaults = useRef(false);
  useEffect(() => {
    if (!hydrated || !channelDefaults || appliedDefaults.current) return;
    const next = fillTikTokChannelDefaultsIfEmpty(draft, channelDefaults);
    appliedDefaults.current = true;
    if (!next) return;
    setDraft(next);
    void saveDraft(next);
  }, [hydrated, channelDefaults, draft, setDraft, saveDraft]);

  const [tab, setTabState] = useState<TikTokDrawerTab>(() => {
    const from = tabForAnchor("tiktok", initialAnchor);
    return isTikTokDrawerTab(from) ? from : "tt-video";
  });
  const setTab = useCallback(
    (next: TikTokDrawerTab) => {
      setTabState(next);
      onTabChange?.(next);
    },
    [onTabChange],
  );

  const [templateOpen, setTemplateOpen] = useState(false);
  const [templates, setTemplates] = useState<TikTokCampaignTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaveSuccess, setTemplateSaveSuccess] = useState(false);
  const [templateSaveError, setTemplateSaveError] = useState<string | null>(null);
  const [templateClientNameById, setTemplateClientNameById] = useState<
    Record<string, string>
  >({});

  const videoCount = draft.creatives.items.filter((item) => Boolean(item.videoId)).length;
  const showAssign = tiktokAssignTabVisible(draft.creatives.items.length);

  const blockers = useMemo(
    () => tiktokNeedsVideoBlockers({ items: draft.creatives.items }),
    [draft.creatives.items],
  );

  const tabs = useMemo(() => {
    const base = TIKTOK_DRAWER_TABS.map((entry) => ({
      id: entry.id,
      glyph: entry.glyph,
      label: entry.label,
    }));
    if (!showAssign) return base;
    return [...base, { id: "tt-assign", glyph: "⊞", label: "assign" }];
  }, [showAssign]);

  const done = useCallback(() => {
    void flush().then(onClose);
  }, [flush, onClose]);

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
      setTemplateOpen(false);
    },
    [draftRef, saveDraft, setDraft],
  );

  const onOpenAnchor = useCallback((anchor: BlockerAnchor) => {
    const next = tabForAnchor("tiktok", anchor);
    if (isTikTokDrawerTab(next)) setTab(next);
  }, [setTab]);

  return (
    <>
      <Drawer
        open={open}
        variant={variant}
        platform="tiktok"
        tabs={tabs}
        activeTab={tab}
        onTabChange={(id) => {
          if (isTikTokDrawerTab(id) || id === "tt-assign") setTab(id as TikTokDrawerTab);
        }}
        status={blockers.length > 0 ? "blocked" : status}
        onDone={done}
        doneLabel={doneLabel}
        onLoadTemplate={() => void openTemplates()}
        onSaveTemplate={() => {
          setSaveTemplateOpen(true);
          setTemplateSaveSuccess(false);
          setTemplateSaveError(null);
        }}
        triggerRef={triggerRef}
        footer={
          <span className="text-[11px] text-muted-foreground" role="status">
            {saveStatus === "saving" ? "◌" : saveStatus === "saved" ? "✓" : null}
          </span>
        }
      >
        <StepSurfaceProvider surface="drawer">
          {blockers.length > 0 ? (
            <div className="mb-3">
              <BlockerBadge rows={blockers} onOpenAnchor={onOpenAnchor} />
              <InfoTip label={TIKTOK_DRAWER_COPY.needsVideoTip} />
            </div>
          ) : null}

          {tab === "tt-video" ? (
            <CreativesStep
              surface="drawer"
              draft={draft}
              onSave={saveDraft}
              planDestinationUrl={destinationUrl}
            />
          ) : null}

          {tab === "tt-refine" ? (
            <AudiencesStep surface="drawer" draft={draft} onSave={saveDraft} />
          ) : null}

          {tab === "tt-assign" && showAssign ? (
            <AssignCreativesStep surface="drawer" draft={draft} onSave={saveDraft} />
          ) : null}

          <TikTokDrawerDetails
            draft={draft}
            onSave={saveDraft}
            planId={planId}
            channelDefaults={channelDefaults}
          />

          {/*
            Standalone `/tiktok-campaign/[id]` keeps Launch. A plan-linked
            draft launches from the canvas — rendering Launch here would
            be a second way to create ACTIVE (friction #6).
          */}
          {variant === "page" && !planId ? (
            <ReviewLaunchStep
              surface="drawer"
              draft={draft}
              onSave={saveDraft}
              context={wizardContext}
            />
          ) : null}
        </StepSurfaceProvider>
      </Drawer>

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
            await saveTikTokTemplateToDb(draftRef.current, name, description, tags, user.id);
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
    </>
  );
}
