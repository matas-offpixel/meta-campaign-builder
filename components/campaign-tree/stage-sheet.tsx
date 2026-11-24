"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  SHEET_AD_SETS_SHOWN,
  canWrite,
  moreLine,
  sheetButton,
  sheetCampaignLine,
  selectionCounts,
  toggleAdSet,
  toggleCampaign,
  type TreeCampaign,
  type TreeSelection,
} from "@/lib/campaign-tree/tree";
import { FRAME_WORDS, TREE_WORDS } from "@/lib/campaign-tree/words";

/**
 * The stage sheet (RC6, frame RC-F): the stage's campaigns, each with its ad
 * sets, ticked by the rules in lib/campaign-tree/tree.ts (live ticked, paused
 * unticked). Each campaign reads "{n} of {m} ad sets" or "paused"; the first
 * three ad sets show, then "… and {n} more". The button reads
 * "Add to {n} ad sets in {m} campaigns" and the note "Logged under each
 * campaign." Presentational: the caller runs the write.
 */
export function StageSheetPanel({
  title,
  campaigns,
  selection,
  onSelection,
  onCancel,
  onConfirm,
  busy = false,
  blocked = null,
  error = null,
  before,
  after,
  expandAll = false,
}: {
  title: string;
  campaigns: TreeCampaign[];
  selection: TreeSelection;
  onSelection: (next: TreeSelection) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  /** Why the button is off (a write switch), shown under it. */
  blocked?: string | null;
  error?: string | null;
  /** Above the campaign list (the audience picker). */
  before?: ReactNode;
  /** Under the list (a run's result). */
  after?: ReactNode;
  expandAll?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const counts = selectionCounts(selection);
  return (
    <div className="rounded-md border border-border bg-background p-5 shadow-md sm:p-6" data-stage-sheet="">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="dialog-title" className="min-w-0 break-words font-heading text-lg tracking-wide text-foreground">
          {title}
        </h2>
        <button type="button" onClick={onCancel} aria-label="Close" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          ✕
        </button>
      </div>
      {before}
      <ul className="space-y-3">
        {campaigns.map((c) => {
          const ticked = selection[c.metaCampaignId] ?? [];
          const open = expandAll || expanded.has(c.metaCampaignId);
          const shown = open ? c.adSets : c.adSets.slice(0, SHEET_AD_SETS_SHOWN);
          const more = moreLine(c.adSets.length - shown.length);
          const writable = canWrite(c);
          const showAdSets = c.status !== "paused" || ticked.length > 0;
          return (
            <li key={c.metaCampaignId} data-sheet-campaign={c.metaCampaignId}>
              <label className={`flex items-start gap-2 text-[13px] ${writable ? "" : "opacity-50"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-foreground"
                  checked={ticked.length > 0}
                  disabled={!writable}
                  onChange={() => onSelection(toggleCampaign(selection, c))}
                />
                <span className="min-w-0 break-words">
                  <span className="font-semibold text-foreground">{c.name}</span>
                  <span className="text-muted-foreground"> · {sheetCampaignLine(c, selection)}</span>
                </span>
              </label>
              {showAdSets && c.adSets.length > 0 ? (
                <ul className="ml-5 mt-1 space-y-0.5">
                  {shown.map((a) => (
                    <li key={a.id}>
                      <label className={`flex items-center gap-2 text-[12.5px] text-foreground ${writable ? "" : "opacity-50"}`}>
                        <input
                          type="checkbox"
                          className="h-3 w-3 shrink-0 accent-foreground"
                          checked={ticked.includes(a.id)}
                          disabled={!writable}
                          onChange={() => onSelection(toggleAdSet(selection, c, a.id))}
                        />
                        <span className="min-w-0 truncate">{a.name}</span>
                      </label>
                    </li>
                  ))}
                  {more ? (
                    <li>
                      <button
                        type="button"
                        className="ml-5 text-[12.5px] text-muted-foreground underline-offset-2 hover:underline"
                        onClick={() => setExpanded((s) => new Set(s).add(c.metaCampaignId))}
                      >
                        {more}
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {after}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-xs text-muted-foreground">{TREE_WORDS["tree.sheet.note"]}</p>
        <div className="flex justify-end gap-2 sm:ml-auto">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {FRAME_WORDS.cancel}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy || Boolean(blocked) || counts.adSets === 0}>
            {sheetButton(selection)}
          </Button>
        </div>
      </div>
      {blocked ? <p className="mt-2 text-right text-xs text-muted-foreground">{blocked}</p> : null}
    </div>
  );
}
