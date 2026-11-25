"use client";

import { useState, type ReactNode } from "react";

import { keepCounts } from "@/components/campaign-tree/keep-counts";
import { Button } from "@/components/ui/button";
import {
  SHEET_AD_SETS_SHOWN,
  canWrite,
  moreLine,
  notAddedLines,
  sheetButton,
  sheetCampaignLine,
  selectionCounts,
  toggleAdSet,
  toggleCampaign,
  type NotAdded,
  type TreeCampaign,
  type TreeSelection,
} from "@/lib/campaign-tree/tree";
import { TREE_WORDS } from "@/lib/campaign-tree/words";
import { FRAME_WORDS } from "@/lib/campaign-tree/words";

/**
 * The stage sheet (RC6, RC9–RC12; frames RC-F2, RC-F-off, RC-G): the stage's
 * campaigns, each with its ad sets, ticked by the rules in
 * lib/campaign-tree/tree.ts (live ticked, paused unticked). A campaign with
 * no draft on the event is listed, muted, with its line, and can't be ticked
 * (RC10). Under the list: `after` (the learning line), then "Not added to …"
 * after a run with misses, then the error line, then the switch line, then
 * the note and the button. Every string is a word-list row; the caller maps
 * a run's outcome to rows (notAddedLines, runErrorLine) and never passes a
 * server message. Presentational: the caller runs the write.
 */
export function StageSheetPanel({
  title,
  campaigns,
  selection,
  onSelection,
  onCancel,
  onConfirm,
  busy = false,
  off = null,
  error = null,
  notAdded = [],
  before,
  after,
  confirmReady = true,
}: {
  title: string;
  campaigns: TreeCampaign[];
  selection: TreeSelection;
  onSelection: (next: TreeSelection) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
  /** The switch line ("Adding creatives from here is switched off."); the button stays off. */
  off?: string | null;
  /** A row from the word list (runErrorLine). */
  error?: string | null;
  /** Ad sets the last run didn't add to (RC12). */
  notAdded?: NotAdded[];
  /** Above the campaign list (the audience picker). */
  before?: ReactNode;
  /** Under the list (the learning line). */
  after?: ReactNode;
  /** False until the caller has what the run needs (an audience picked). */
  confirmReady?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const counts = selectionCounts(selection);
  const missed = notAddedLines(notAdded);
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
          const writable = canWrite(c);
          if (!writable) {
            return (
              <li key={c.metaCampaignId} data-sheet-campaign={c.metaCampaignId} data-no-draft="" className="flex items-start gap-2 text-[13px] opacity-60">
                <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 shrink-0" checked={false} disabled aria-label={c.name} />
                <span className="min-w-0 break-words">
                  <span className="font-semibold text-foreground">{c.name}</span>
                  <span className="block text-[12px] text-muted-foreground">{TREE_WORDS["tree.campaign.no_draft"]}</span>
                </span>
              </li>
            );
          }
          const open = expanded.has(c.metaCampaignId);
          const shown = open ? c.adSets : c.adSets.slice(0, SHEET_AD_SETS_SHOWN);
          const more = moreLine(c.adSets.length - shown.length);
          const showAdSets = c.status !== "paused" || ticked.length > 0;
          return (
            <li key={c.metaCampaignId} data-sheet-campaign={c.metaCampaignId}>
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-foreground"
                  checked={ticked.length > 0}
                  onChange={() => onSelection(toggleCampaign(selection, c))}
                />
                <span className="min-w-0 break-words">
                  <span className="font-semibold text-foreground">{c.name}</span>
                  <span className="text-muted-foreground"> · {keepCounts(sheetCampaignLine(c, selection))}</span>
                </span>
              </label>
              {showAdSets && c.adSets.length > 0 ? (
                <ul className="ml-5 mt-1 space-y-0.5">
                  {shown.map((a) => (
                    <li key={a.id}>
                      <label className="flex items-center gap-2 text-[12.5px] text-foreground">
                        <input
                          type="checkbox"
                          className="h-3 w-3 shrink-0 accent-foreground"
                          checked={ticked.includes(a.id)}
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
      {missed ? (
        <div className="mt-3 text-[12.5px]" data-not-added="">
          <p className="font-medium text-destructive">{missed.heading}</p>
          <ul className="mt-0.5 space-y-0.5">
            {missed.rows.map((row) => (
              <li key={row} className="text-foreground">
                {row}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
      {off ? <p className="mt-4 text-[12.5px] font-medium text-warning-foreground" data-switch-off="">{off}</p> : null}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-xs text-muted-foreground">{TREE_WORDS["tree.sheet.note"]}</p>
        <div className="flex justify-end gap-2 sm:ml-auto">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {FRAME_WORDS.cancel}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy || Boolean(off) || counts.adSets === 0 || !confirmReady}>
            {sheetButton(selection)}
          </Button>
        </div>
      </div>
    </div>
  );
}
