/**
 * Apply a resolved wiring match. Draft writes go through
 * linkDraftToEvent → applyEventToCampaignSettings. Event-code stamps
 * write events.event_code only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { migrateDraft } from "../autosave.ts";
import {
  resolveDraftEventId,
  type CampaignEventIdentity,
} from "../campaign-event.ts";
import {
  canStampEvent,
  resolveWiringMatch,
  wiringCampaignName,
  type WiringResolution,
} from "../campaign-event-rewire.ts";
import { linkDraftToEvent } from "./events.ts";

export type RewireViewer = { userId: string; isOperator: boolean };

export type ApplyWiringResult =
  | { ok: true; wiring: WiringResolution }
  | { ok: false; error: string; status: number };

export type StampWriteResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

const EVENT_SELECT =
  "id, event_code, client_id, user_id, name, venue_city, venue_name, event_date";

export async function loadClientEvents(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
  clientIds: string[],
): Promise<Map<string, CampaignEventIdentity[]>> {
  const map = new Map<string, CampaignEventIdentity[]>();
  const ids = [...new Set(clientIds.filter(Boolean))];
  if (ids.length === 0) return map;
  const PAGE = 1000;
  const rows: CampaignEventIdentity[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("events")
      .select(EVENT_SELECT)
      .in("client_id", ids)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`[rewire] events read failed: ${error.message}`);
      return map;
    }
    const page = (data ?? []) as CampaignEventIdentity[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  for (const event of rows) {
    const clientId = event.client_id ?? "";
    if (!clientId) continue;
    const list = map.get(clientId) ?? [];
    list.push(event);
    map.set(clientId, list);
  }
  return map;
}

export async function stampEventCode(
  supabase: SupabaseClient,
  eventId: string,
  code: string,
  viewer: RewireViewer,
  eventOwnerUserId: string | null | undefined,
): Promise<StampWriteResult> {
  if (!canStampEvent(viewer, eventOwnerUserId)) {
    return { ok: false, error: "Not allowed to write this event", status: 403 };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from("events")
    .update({ event_code: code })
    .eq("id", eventId)
    .is("event_code", null);
  if (!viewer.isOperator) {
    q = q.eq("user_id", viewer.userId);
  }
  const { data, error } = await q.select("id");
  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }
  if (!data?.length) {
    return { ok: false, error: "Event already has a code", status: 409 };
  }
  return { ok: true };
}

export async function applyResolvedWiring(
  supabase: SupabaseClient,
  draftId: string,
  expectedKind: "rewire" | "stamp_event",
  viewer: RewireViewer,
): Promise<ApplyWiringResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("campaign_drafts")
    .select("id, user_id, event_id, name, draft_json")
    .eq("id", draftId)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: "Draft not found", status: 404 };
  }
  const ownerId = data.user_id as string;
  if (!viewer.isOperator && ownerId !== viewer.userId) {
    return { ok: false, error: "Draft not found", status: 404 };
  }

  let draft;
  try {
    draft = migrateDraft(data.draft_json as Record<string, unknown>);
  } catch {
    return { ok: false, error: "Draft JSON is malformed", status: 500 };
  }

  const jsonEventId = draft.settings.eventId?.trim() || null;
  const columnEventId = (data.event_id as string | null)?.trim() || null;
  const wiredId = resolveDraftEventId(jsonEventId, columnEventId);
  if (!wiredId) {
    return { ok: false, error: "Draft is not wired to an event", status: 400 };
  }

  const { data: wiredRow, error: wiredErr } = await sb
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", wiredId)
    .maybeSingle();
  if (wiredErr || !wiredRow) {
    return { ok: false, error: "Wired event not found", status: 404 };
  }
  const wired = wiredRow as CampaignEventIdentity;
  const clientId = wired.client_id ?? draft.settings.clientId ?? "";
  const clientEvents = clientId
    ? ((await loadClientEvents(sb, [clientId])).get(clientId) ?? [wired])
    : [wired];

  const wiring = resolveWiringMatch({
    campaignCode: draft.settings.campaignCode,
    campaignName: wiringCampaignName(draft.settings.campaignName, data.name as string | null),
    wiredEvent: wired,
    clientEvents,
  });
  if (!wiring || wiring.kind === "ambiguous") {
    return {
      ok: false,
      error: wiring?.kind === "ambiguous" ? wiring.reason : "No matched wiring",
      status: 409,
    };
  }
  if (wiring.kind !== expectedKind) {
    return { ok: false, error: "Resolution changed — reload", status: 409 };
  }

  try {
    if (wiring.kind === "rewire") {
      await linkDraftToEvent(
        draftId,
        wiring.event.id,
        supabase,
        viewer.isOperator ? undefined : viewer.userId,
      );
    } else {
      const stamped = await stampEventCode(
        supabase,
        wiring.event.id,
        wiring.code,
        viewer,
        wiring.event.user_id,
      );
      if (!stamped.ok) return stamped;
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Write failed",
      status: 500,
    };
  }
  return { ok: true, wiring };
}

export async function applyPreviewedRewires(
  supabase: SupabaseClient,
  draftIds: string[],
  viewer: RewireViewer,
): Promise<Array<{ draftId: string; ok: boolean; error?: string; status?: number }>> {
  const results: Array<{ draftId: string; ok: boolean; error?: string; status?: number }> = [];
  for (const draftId of draftIds) {
    const result = await applyResolvedWiring(supabase, draftId, "rewire", viewer);
    results.push(
      result.ok
        ? { draftId, ok: true }
        : { draftId, ok: false, error: result.error, status: result.status },
    );
  }
  return results;
}
