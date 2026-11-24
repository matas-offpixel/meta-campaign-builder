"use client";

import { Copy, ExternalLink, Files, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OverflowMenu, type OverflowMenuItem } from "@/components/viz/overflow-menu";
import { isTreeStage, type TreeCampaignView, type TreeStage, type TreeView } from "@/lib/campaign-tree/tree";
import { FRAME_WORDS, TREE_WORDS } from "@/lib/campaign-tree/words";
import { REPLICATE_WORDS } from "@/lib/replicate/words";

/**
 * The event's campaign tree (RC6, frame RC-F): stages, each with "Add
 * creatives to…" and "Add audience to…"; under each, its campaigns with the
 * master chip, status and ad set count; under each campaign, what was added
 * to it, oldest first. Presentational: the live container and the frames
 * mount it.
 */

export interface CampaignMenuHandlers {
  onReplicate: (c: TreeCampaignView) => void;
  onDuplicate: (c: TreeCampaignView) => void;
  onEdit: (c: TreeCampaignView) => void;
  adsManagerHref: (c: TreeCampaignView) => string | null;
}

/** RC1 / RC-A: Replicate to event… first, Duplicate directly under it. */
export function campaignMenuItems(c: TreeCampaignView, h: CampaignMenuHandlers): OverflowMenuItem[] {
  const href = h.adsManagerHref(c);
  return [
    { id: "replicate", icon: <Files />, label: REPLICATE_WORDS["replicate.menu"], sub: REPLICATE_WORDS["replicate.menu.sub"], hidden: !c.draftId, onSelect: () => h.onReplicate(c) },
    { id: "duplicate", icon: <Copy />, label: REPLICATE_WORDS["duplicate.menu"], sub: REPLICATE_WORDS["duplicate.menu.sub"], hidden: !c.draftId, onSelect: () => h.onDuplicate(c) },
    { id: "edit", icon: <Pencil />, label: FRAME_WORDS.editDraft, hidden: !c.draftId, onSelect: () => h.onEdit(c) },
    { id: "ads-manager", icon: <ExternalLink />, label: FRAME_WORDS.adsManager, hidden: !href, onSelect: () => href && window.open(href, "_blank", "noopener") },
  ];
}

export function adsManagerCampaignHref(c: { adAccountId: string | null; metaCampaignId: string }): string | null {
  const act = (c.adAccountId ?? "").replace(/^act_/, "");
  if (!/^\d+$/.test(act)) return null;
  const params = new URLSearchParams({ act, selected_campaign_ids: c.metaCampaignId });
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?${params.toString()}`;
}

function CampaignRow({ c, menu }: { c: TreeCampaignView; menu?: OverflowMenuItem[] }) {
  return (
    <li data-tree-campaign={c.metaCampaignId} data-no-draft={c.noDraft ? "" : undefined} className={`py-2 ${c.noDraft ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-[13px]">
          <span className="font-semibold text-foreground">{c.name}</span>
          {c.master ? (
            <span className="ml-1.5 inline-flex items-center rounded border border-border-strong px-1 py-px align-[1px] font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-foreground">
              {TREE_WORDS["tree.master"]}
            </span>
          ) : null}
          <span className={c.status === "paused" ? "text-warning-foreground" : "text-muted-foreground"}> · {c.meta}</span>
          {c.noDraft ? <span className="block text-[12px] text-muted-foreground">{c.noDraft}</span> : null}
        </p>
        {menu && menu.some((item) => !item.hidden) ? <OverflowMenu items={menu} /> : null}
      </div>
      {c.additions.length > 0 ? (
        <ul className="ml-3 mt-1 space-y-0.5 border-l border-border pl-3">
          {c.additions.map((a) => (
            <li key={a.id} data-tree-addition={a.id} className="text-[12.5px]">
              <span className="font-medium text-foreground">{a.head}</span>
              <span className="text-muted-foreground"> {a.line}</span>
              {a.refresh ? <span className="text-muted-foreground"> · {a.refresh}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CampaignTreeView({
  view,
  onAction,
  menuFor,
}: {
  view: TreeView;
  onAction?: (stage: TreeStage, kind: "creatives" | "audience") => void;
  menuFor?: (c: TreeCampaignView) => OverflowMenuItem[];
}) {
  return (
    <div className="space-y-4" data-campaign-tree="">
      {view.stages.map((s) => (
        <section key={s.stage} data-tree-stage={s.stage} className="rounded-md border border-border bg-card px-4 py-3">
          <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border pb-2">
            <h3 className="font-heading text-base tracking-wide text-foreground">{s.label}</h3>
            {s.actions && isTreeStage(s.stage) ? (
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!onAction || s.campaigns.length === 0}
                  onClick={() => isTreeStage(s.stage) && onAction?.(s.stage, "creatives")}
                >
                  {TREE_WORDS["tree.action.creatives"]}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!onAction || s.campaigns.length === 0}
                  onClick={() => isTreeStage(s.stage) && onAction?.(s.stage, "audience")}
                >
                  {TREE_WORDS["tree.action.audience"]}
                </Button>
              </div>
            ) : null}
            {s.line ? <p className="w-full text-[12px] text-muted-foreground">{s.line}</p> : null}
          </header>
          {s.campaigns.length > 0 ? (
            <ul className="divide-y divide-border">
              {s.campaigns.map((c) => (
                <CampaignRow key={c.metaCampaignId} c={c} menu={menuFor?.(c)} />
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </div>
  );
}
