"use client";

import { useState } from "react";

import { CampaignTreeView, campaignMenuItems } from "@/components/campaign-tree/campaign-tree-view";
import { StageSheetPanel } from "@/components/campaign-tree/stage-sheet";
import { ReplicatePickPanel, ReplicateShell, ReplicateSummaryPanel } from "@/components/replicate/replicate-panels";
import { OverflowMenuItems } from "@/components/viz/overflow-menu";
import { AudienceSheetPanel } from "@/components/campaign-tree/audience-stage-sheet";
import { creativesSheetTitle } from "@/lib/campaign-tree/tree";
import { TREE_WORDS } from "@/lib/campaign-tree/words";
import { errorText } from "@/components/replicate/replicate-dialog";
import { REPLICATE_WORDS } from "@/lib/replicate/words";
import {
  PICK_EVENTS,
  onSaleSheet,
  replicateSummary,
  signupAudienceSheet,
  sourceTreeView,
  treeView,
  type CampaignTreeFrameId,
} from "@/scripts/plan-frames/campaign-tree-fixtures";

/**
 * /frames/campaign-tree/{id}: RC-A (RC-A2 with the ⋯ menu), RC-A-nomatch,
 * RC-A-error, RC-B (RC-B2), RC-B-notset, RC-F (RC-F2), RC-F-sheet, RC-F-off
 * and RC-G of records 2026-11-24-campaign-creator-replicate and
 * 2026-11-24-campaign-creator-tree-as-built, from
 * scripts/plan-frames/campaign-tree-fixtures.ts. The real panels, drawn in
 * place (the live ones sit in a dialog); the ⋯ menu is drawn open.
 */

const noop = () => undefined;
const HANDLERS = { onReplicate: noop, onDuplicate: noop, onEdit: noop, adsManagerHref: () => "https://adsmanager.facebook.com/" };

function Frame({ id, children }: { id: CampaignTreeFrameId; children: React.ReactNode }) {
  return (
    <div data-frame-ready={`campaign-tree/${id}`} className="mx-auto w-full max-w-[1280px] bg-background px-4 py-6 sm:px-8">
      {children}
    </div>
  );
}

function PickFrame({ state = "list" }: { state?: "list" | "nomatch" | "error" }) {
  const [picked, setPicked] = useState<string | null>("event-nx27-glitterbox");
  const [query, setQuery] = useState(state === "nomatch" ? "ironworks" : "");
  const source = sourceTreeView();
  const signup = { ...source, stages: source.stages.filter((s) => s.stage === "signup") };
  const row = signup.stages[0]!.campaigns[0]!;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_minmax(0,36rem)]">
      <div className="hidden space-y-2 lg:block">
        <CampaignTreeView view={signup} />
        <ul role="menu" className="ml-auto w-max min-w-[13rem] rounded-md border border-border bg-background py-1 shadow-md">
          <OverflowMenuItems items={campaignMenuItems(row, HANDLERS).filter((item) => !item.hidden)} />
        </ul>
      </div>
      <ReplicateShell title={REPLICATE_WORDS["replicate.title"]} onClose={noop}>
        <ReplicatePickPanel
          clientName="Electric"
          events={PICK_EVENTS}
          query={query}
          onQuery={setQuery}
          picked={picked}
          onPick={setPicked}
          onCancel={noop}
          onNext={noop}
          error={state === "error" ? errorText("event_not_found") : null}
        />
      </ReplicateShell>
    </div>
  );
}

function SummaryFrame({ target }: { target: "nx" | "brixton" }) {
  const summary = replicateSummary(target);
  const [answers, setAnswers] = useState<Record<string, "keep" | "change">>({});
  return (
    <div className="mx-auto max-w-2xl">
      <ReplicateShell title={summary.title} onClose={noop}>
        <ReplicateSummaryPanel
          summary={summary}
          answers={answers}
          onAnswer={(pageId, answer) => setAnswers((a) => ({ ...a, [pageId]: answer }))}
          onBack={noop}
          onCreate={noop}
        />
      </ReplicateShell>
    </div>
  );
}

function SheetFrame({ off = false }: { off?: boolean }) {
  const sheet = onSaleSheet();
  const [selection, setSelection] = useState(sheet.selection);
  return (
    <div className="mx-auto max-w-xl">
      <StageSheetPanel
        title={creativesSheetTitle(1, "on_sale")}
        campaigns={sheet.campaigns}
        selection={selection}
        onSelection={setSelection}
        onCancel={noop}
        onConfirm={noop}
        off={off ? TREE_WORDS["tree.sheet.off.creatives"] : null}
      />
    </div>
  );
}

function AudienceFrame() {
  const sheet = signupAudienceSheet();
  const [selection, setSelection] = useState(sheet.selection);
  const [audienceId, setAudienceId] = useState(sheet.audiences[0]!.id);
  return (
    <div className="mx-auto max-w-xl">
      <AudienceSheetPanel
        stage="signup"
        campaigns={sheet.campaigns}
        audiences={sheet.audiences}
        audienceId={audienceId}
        onAudience={setAudienceId}
        selection={selection}
        onSelection={setSelection}
        writesEnabled
        notAdded={sheet.notAdded}
        onCancel={noop}
        onConfirm={noop}
      />
    </div>
  );
}

export function CampaignTreeFrameMount({ id }: { id: CampaignTreeFrameId }) {
  return (
    <Frame id={id}>
      {id === "RC-A" ? <PickFrame /> : null}
      {id === "RC-A-nomatch" ? <PickFrame state="nomatch" /> : null}
      {id === "RC-A-error" ? <PickFrame state="error" /> : null}
      {id === "RC-B" ? <SummaryFrame target="nx" /> : null}
      {id === "RC-B-notset" ? <SummaryFrame target="brixton" /> : null}
      {id === "RC-F" ? <CampaignTreeView view={treeView()} onAction={noop} menuFor={(c) => campaignMenuItems(c, HANDLERS)} /> : null}
      {id === "RC-F-sheet" ? <SheetFrame /> : null}
      {id === "RC-F-off" ? <SheetFrame off /> : null}
      {id === "RC-G" ? <AudienceFrame /> : null}
    </Frame>
  );
}
