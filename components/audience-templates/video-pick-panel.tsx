"use client";

import { SourcePicker, type SourceSelection } from "@/components/audiences/source-picker";
import type { TemplateVideoPick } from "@/lib/types";
import { pickerStart, withPick, type PickEvent } from "@/lib/audience-templates/videos";

/**
 * "Pick this show's videos" (25 Nov ruling, record
 * 2026-11-25-signups-into-meta): the audience builder's video picker as it
 * is (components/audiences/source-picker.tsx, Video views), opened under the
 * item with its threshold set and its header line naming the template,
 * threshold and days. Nothing is ticked unless this draft already picked for
 * the item. Each change is the draft's pick for this event (saved as it's
 * made); the template never sees it.
 *
 * Reads: only the picker's own, when the operator uses it (the client's
 * campaigns, then the picked campaigns' videos). No page-wide video read.
 */
export function VideoPickPanel({
  title,
  template,
  threshold,
  days,
  clientId,
  event,
  picks,
  onPicks,
  onClose,
}: {
  title: string;
  template: string;
  threshold: number;
  days: number;
  clientId: string;
  event: PickEvent;
  picks?: TemplateVideoPick[];
  onPicks?: (next: TemplateVideoPick[]) => void;
  onClose: () => void;
}) {
  const start = pickerStart(template, threshold, days, picks, event);
  const value: SourceSelection = {
    threshold: start.threshold as SourceSelection["threshold"],
    videoIds: start.videoIds,
    ...(start.contextId ? { contextId: start.contextId } : {}),
    ...(start.campaignIds ? { campaignIds: start.campaignIds } : {}),
  };
  const change = (next: SourceSelection) => {
    if (!onPicks) return;
    onPicks(
      withPick(picks, {
        template,
        threshold,
        retentionDays: days,
        eventId: event.eventId,
        code: event.code,
        videoIds: next.videoIds ?? [],
        ...(next.contextId ? { contextId: next.contextId } : {}),
        ...(next.campaignIds?.length ? { campaignIds: next.campaignIds } : next.campaignId ? { campaignIds: [next.campaignId] } : {}),
      }),
    );
  };
  return (
    <div className="mt-2 rounded-md border border-border-strong bg-card p-3" data-template-video-picker>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <button type="button" onClick={onClose} aria-label={title} className="rounded px-1.5 text-sm text-muted-foreground hover:text-foreground">
          ✕
        </button>
      </div>
      <p className="mb-2 text-xs leading-5 text-muted-foreground" data-template-picker-preset>
        {start.header}
      </p>
      {/* The item's threshold is the template's: the picker's own threshold control can't move it. */}
      <SourcePicker
        clientId={clientId}
        subtype="video_views"
        value={value}
        onChange={(next) => change({ ...next, threshold: value.threshold })}
        sourcePickerInstanceId={`template:${template}:${threshold}:${days}`}
      />
    </div>
  );
}
