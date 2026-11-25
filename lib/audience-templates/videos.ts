/**
 * Video-viewer items' videos (record 2026-11-25-signups-into-meta, the
 * 25 Nov ruling for #1363's follow-up): a template stores a threshold and
 * days only, so the videos are picked per show, on the draft.
 *
 * A pick is this draft's and this event's: it carries the event it was made
 * for, and a pick for another event (a draft copied by Replicate, or an
 * event changed since) is never used. Templates never store picks: they
 * aren't TemplateItems, and Save to template saves pages only.
 *
 * Pure. No `@/` imports, so node --test loads it.
 */

import type { TemplateVideoPick } from "../types.ts";
import type { TemplateItem } from "./resolve.ts";

export type { TemplateVideoPick };

export function isVideoViewers(it: TemplateItem): boolean {
  return it.kind === "retargeting_pool" && it.listRole === "video_viewers";
}

/** The item's threshold (50 = 50%), defaulting as the builder does. */
export function itemThreshold(it: TemplateItem): number {
  return typeof it.detail.threshold === "number" ? it.detail.threshold : 50;
}

/** The draft's event, as a pick records it. */
export interface PickEvent {
  eventId: string;
  code: string;
}

/** A pick Create can use: videos and the page they're on (Meta's rule needs both). */
export function isUsablePick(p: TemplateVideoPick | null | undefined): p is TemplateVideoPick {
  return Boolean(p && p.videoIds.length > 0 && p.videoIds.every((id) => /^\d+$/.test(id)) && p.contextId && /^\d+$/.test(p.contextId));
}

/** The draft's pick for one item of one template, for this event only. */
export function pickFor(picks: readonly TemplateVideoPick[] | undefined, template: string, it: TemplateItem, event: PickEvent): TemplateVideoPick | null {
  if (!isVideoViewers(it)) return null;
  return (
    (picks ?? []).find(
      (p) =>
        p.template === template &&
        p.threshold === itemThreshold(it) &&
        p.retentionDays === (it.retentionDays ?? 0) &&
        p.eventId === event.eventId &&
        p.code === event.code,
    ) ?? null
  );
}

/** The draft's picks with this one set (replacing the item's earlier pick for this event). */
export function withPick(picks: readonly TemplateVideoPick[] | undefined, next: TemplateVideoPick): TemplateVideoPick[] {
  const same = (p: TemplateVideoPick) =>
    p.template === next.template && p.threshold === next.threshold && p.retentionDays === next.retentionDays && p.eventId === next.eventId && p.code === next.code;
  return [...(picks ?? []).filter((p) => !same(p)), next];
}
