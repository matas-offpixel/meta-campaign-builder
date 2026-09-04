"use client";

import { useCallback, useMemo, useState, type RefObject } from "react";

import { AdCopyStep } from "@/components/google-search-wizard/steps/ad-copy";
import { AdGroupsKeywordsStep } from "@/components/google-search-wizard/steps/ad-groups-keywords";
import { NegativesStep } from "@/components/google-search-wizard/steps/negatives";
import { PushStep } from "@/components/google-search-wizard/steps/push";
import type { GoogleSearchWizardContext } from "@/components/google-search-wizard/wizard-shell";
import { StepSurfaceProvider } from "@/components/steps/step-surface";
import { BlockerBadge } from "@/components/viz/blocker-badge";
import { Drawer } from "@/components/viz/drawer";
import { InfoTip } from "@/components/viz/info-tip";
import {
  GOOGLE_DRAWER_COPY,
  GOOGLE_DRAWER_TABS,
  googleKeywordBlockers,
  isGoogleDrawerTab,
  tabForAnchor,
  type GoogleDrawerTab,
} from "@/lib/plan/drawer";
import type { BlockerAnchor } from "@/lib/viz/blockers";
import type { VizStatus } from "@/lib/viz/tokens";
import {
  useGoogleSearchTree,
  type GoogleSearchTreeController,
} from "@/lib/wizard/use-google-search-tree";

import { GoogleDrawerDetails } from "./google-drawer-details";

export function GoogleDrawerMount({
  draftId,
  ...rest
}: { draftId: string } & Omit<Parameters<typeof GoogleDrawer>[0], "controller">) {
  const controller = useGoogleSearchTree(draftId);
  return <GoogleDrawer controller={controller} {...rest} />;
}

/**
 * The Google drawer — the Google Search wizard, from PR 5 on.
 *
 * Two tabs: keywords (groups + the campaign-level negative add row)
 * and copy (RSA + sitelinks). Google has no templates — the header
 * loader is present and disabled so every drawer looks the same.
 *
 * `variant="page"` is `/google-search/[id]`. A standalone tree keeps
 * Push; a plan-linked tree does not.
 */
export function GoogleDrawer({
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
}: {
  open: boolean;
  controller: GoogleSearchTreeController;
  initialAnchor?: BlockerAnchor | null;
  triggerRef?: RefObject<Element | null>;
  onClose: () => void;
  variant?: "sheet" | "page";
  status?: VizStatus;
  planId?: string | null;
  doneLabel?: string;
  onTabChange?: (tab: GoogleDrawerTab) => void;
  wizardContext?: GoogleSearchWizardContext;
}) {
  const { tree, saveStatus, onChange, flush } = controller;

  const [tab, setTabState] = useState<GoogleDrawerTab>(() => {
    const from = tabForAnchor("google", initialAnchor);
    return isGoogleDrawerTab(from) ? from : "g-keywords";
  });
  const setTab = useCallback(
    (next: GoogleDrawerTab) => {
      setTabState(next);
      onTabChange?.(next);
    },
    [onTabChange],
  );

  const blockers = useMemo(
    () => (tree ? googleKeywordBlockers(tree) : []),
    [tree],
  );

  const done = useCallback(() => {
    void flush().then(onClose);
  }, [flush, onClose]);

  const onOpenAnchor = useCallback(
    (anchor: BlockerAnchor) => {
      const next = tabForAnchor("google", anchor);
      if (isGoogleDrawerTab(next)) setTab(next);
    },
    [setTab],
  );

  if (!tree) {
    return (
      <Drawer
        open={open}
        variant={variant}
        platform="google"
        tabs={GOOGLE_DRAWER_TABS.map((entry) => ({
          id: entry.id,
          glyph: entry.glyph,
          label: entry.label,
        }))}
        activeTab={tab}
        onTabChange={() => undefined}
        status="idle"
        onDone={onClose}
        doneLabel={doneLabel}
        triggerRef={triggerRef}
      >
        <span className="text-[11px] text-muted-foreground">○</span>
      </Drawer>
    );
  }

  return (
    <Drawer
      open={open}
      variant={variant}
      platform="google"
      tabs={GOOGLE_DRAWER_TABS.map((entry) => ({
        id: entry.id,
        glyph: entry.glyph,
        label: entry.label,
      }))}
      activeTab={tab}
      onTabChange={(id) => {
        if (isGoogleDrawerTab(id)) setTab(id);
      }}
      status={blockers.length > 0 ? "blocked" : status}
      onDone={done}
      doneLabel={doneLabel}
      triggerRef={triggerRef}
      header={
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <span aria-disabled="true">⌁ template ▸</span>
          <InfoTip label={GOOGLE_DRAWER_COPY.noTemplatesTip} />
        </span>
      }
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
          </div>
        ) : null}

        {tab === "g-keywords" ? (
          <div className="space-y-4">
            <AdGroupsKeywordsStep surface="drawer" tree={tree} onChange={onChange} />
            <NegativesStep surface="drawer" tree={tree} onChange={onChange} />
          </div>
        ) : null}

        {tab === "g-copy" ? (
          <AdCopyStep surface="drawer" tree={tree} onChange={onChange} />
        ) : null}

        <GoogleDrawerDetails
          tree={tree}
          onChange={onChange}
          planId={planId}
          wizardContext={wizardContext}
        />

        {variant === "page" && !planId ? (
          <PushStep surface="drawer" tree={tree} onChange={onChange} />
        ) : null}
      </StepSurfaceProvider>
    </Drawer>
  );
}
