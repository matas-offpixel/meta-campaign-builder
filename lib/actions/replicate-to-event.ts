"use server";

import { randomUUID } from "node:crypto";

import { isOperator } from "@/lib/auth/operator-allowlist";
import { migrateDraft } from "@/lib/autosave";
import { normalizeAdAccountId } from "@/lib/meta/ad-account";
import {
  loadAudienceRows,
  loadReplicateEvent,
  loadReplicateNames,
  loadReplicateVenue,
  type ReplicateDb,
} from "@/lib/replicate/load";
import {
  draftAudienceIds,
  replicateDraft,
  type ReplicateAudienceOutcome,
  type ReplicateChange,
  type ReplicateEventOverrides,
  type ReplicatePageQuestion,
} from "@/lib/replicate/replicate";
import { createClient } from "@/lib/supabase/server";

/**
 * Replicate to event (R1): copy a campaign draft onto another event,
 * re-deriving everything event-bound from the target (lib/replicate/replicate.ts),
 * and save it as a new draft. It never launches and never calls Meta: the
 * saved draft is status "draft", with no Meta campaign, ad set or creative ids.
 *
 * Operators only. Reads and the write go through the operator's own session,
 * so owner RLS applies to the source draft, both events, the venue and the
 * audiences.
 *
 * The dialog (components/replicate/replicate-dialog.tsx, RC1 · RC2) calls
 * listReplicateTargets for the picker, previewReplicateToEvent for "what
 * changed, what was kept" (nothing saved), then replicateToEvent on
 * "Create draft".
 */

export type ReplicateToEventResult =
  | {
      ok: true;
      draftId: string;
      title: string;
      changesTitle: string;
      changes: ReplicateChange[];
      keptTitle: string;
      kept: string;
      pages: ReplicatePageQuestion[];
      audiences: ReplicateAudienceOutcome;
    }
  | { ok: false; error: "not_signed_in" | "not_operator" | "draft_not_found" | "event_not_found" | "save_failed"; message?: string };

export type ReplicatePreviewResult =
  | ({ ok: true } & Omit<Extract<ReplicateToEventResult, { ok: true }>, "ok" | "draftId">)
  | Extract<ReplicateToEventResult, { ok: false }>;

/** RC2's summary for `eventId`, with nothing saved. */
export async function previewReplicateToEvent(
  draftId: string,
  eventId: string,
  overrides: ReplicateEventOverrides = {},
): Promise<ReplicatePreviewResult> {
  const prepared = await prepare(draftId, eventId, overrides);
  if (!prepared.ok) return prepared;
  const { result } = prepared;
  return {
    ok: true,
    title: result.title,
    changesTitle: result.changesTitle,
    changes: result.changes,
    keptTitle: result.keptTitle,
    kept: result.kept,
    pages: result.pages,
    audiences: result.audiences,
  };
}

export interface ReplicateTarget {
  id: string;
  name: string | null;
  code: string | null;
  venue: string | null;
  eventDate: string | null;
  /** The source draft's own event: "this campaign's event". */
  isSource: boolean;
}

export type ReplicateTargetsResult =
  | { ok: true; clientName: string | null; sourceEventId: string | null; events: ReplicateTarget[] }
  | { ok: false; error: "not_signed_in" | "not_operator" | "draft_not_found" };

/**
 * The picker (RC1, RC11): the source client's upcoming events only, soonest
 * first, each with its name, code, venue and show date. The source's own
 * event is listed only while it's upcoming; no other client's events.
 */
export async function listReplicateTargets(draftId: string, today: string): Promise<ReplicateTargetsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  if (!isOperator(user.id)) return { ok: false, error: "not_operator" };

  const { data: row } = await supabase
    .from("campaign_drafts")
    .select("id, client_id, event_id, draft_json")
    .eq("id", draftId)
    .maybeSingle();
  if (!row) return { ok: false, error: "draft_not_found" };
  const settings = ((row.draft_json as { settings?: { eventId?: string; clientId?: string } } | null)?.settings ?? {});
  const sourceEventId = settings.eventId || (row.event_id as string | null) || null;
  let clientId = settings.clientId || (row.client_id as string | null) || null;
  if (!clientId && sourceEventId) {
    const { data: ev } = await supabase.from("events").select("client_id").eq("id", sourceEventId).maybeSingle();
    clientId = (ev?.client_id as string | null) ?? null;
  }
  if (!clientId) return { ok: true, clientName: null, sourceEventId, events: [] };

  const [{ data: client }, { data: events }] = await Promise.all([
    supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
    supabase
      .from("events")
      .select("id, name, event_code, venue_name, event_date")
      .eq("client_id", clientId)
      .order("event_date", { ascending: true })
      .range(0, 999),
  ]);
  const list: ReplicateTarget[] = (events ?? [])
    .filter((e) => typeof e.event_date === "string" && e.event_date >= today)
    .map((e) => ({
      id: String(e.id),
      name: (e.name as string | null) ?? null,
      code: (e.event_code as string | null) ?? null,
      venue: (e.venue_name as string | null) ?? null,
      eventDate: (e.event_date as string | null) ?? null,
      isSource: e.id === sourceEventId,
    }));
  return { ok: true, clientName: (client?.name as string | null) ?? null, sourceEventId, events: list };
}

type Prepared =
  | {
      ok: true;
      supabase: Awaited<ReturnType<typeof createClient>>;
      userId: string;
      result: ReturnType<typeof replicateDraft>;
    }
  | Extract<ReplicateToEventResult, { ok: false }>;

async function prepare(draftId: string, eventId: string, overrides: ReplicateEventOverrides): Promise<Prepared> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  if (!isOperator(user.id)) return { ok: false, error: "not_operator" };

  const db = supabase as unknown as ReplicateDb;

  const { data: row, error: draftError } = await supabase
    .from("campaign_drafts")
    .select("id, draft_json")
    .eq("id", draftId)
    .maybeSingle();
  if (draftError || !row?.draft_json) return { ok: false, error: "draft_not_found" };
  const source = migrateDraft(structuredClone(row.draft_json) as Record<string, unknown>);

  const target = await loadReplicateEvent(db, eventId);
  if (!target) return { ok: false, error: "event_not_found" };
  const venue = await loadReplicateVenue(db, target);
  const sourceEvent = source.settings.eventId ? await loadReplicateEvent(db, source.settings.eventId) : null;
  const sourceVenue = sourceEvent ? await loadReplicateVenue(db, sourceEvent) : null;

  const targetAccount =
    normalizeAdAccountId(overrides.metaAdAccountId ?? null) ??
    normalizeAdAccountId(target.meta_ad_account_id ?? null) ??
    normalizeAdAccountId(venue?.meta_ad_account_id ?? null);
  const sourceAccount = source.settings.metaAdAccountId || source.settings.adAccountId || null;
  const audienceRows = await loadAudienceRows(db, draftAudienceIds(source), targetAccount);
  const { accountNames, pageNames } = await loadReplicateNames(
    db,
    [sourceAccount, targetAccount],
    source.creatives.map((c) => c.identity?.pageId ?? ""),
  );

  const result = replicateDraft(
    source,
    { event: target, venue, eventOverrides: overrides },
    { sourceEvent, sourceVenue, audienceRows, accountNames, pageNames, now: new Date(), id: randomUUID() },
  );
  return { ok: true, supabase, userId: user.id, result };
}

export async function replicateToEvent(
  draftId: string,
  eventId: string,
  overrides: ReplicateEventOverrides = {},
): Promise<ReplicateToEventResult> {
  const prepared = await prepare(draftId, eventId, overrides);
  if (!prepared.ok) return prepared;
  const { supabase, result } = prepared;
  const user = { id: prepared.userId };
  const draft = result.draft;

  const { error: saveError } = await supabase.from("campaign_drafts").insert({
    id: draft.id,
    user_id: user.id,
    name: draft.settings.campaignName || null,
    objective: draft.settings.objective || null,
    status: "draft",
    ad_account_id: draft.settings.adAccountId || null,
    client_id: draft.settings.clientId || null,
    event_id: draft.settings.eventId || null,
    draft_json: draft,
    updated_at: draft.updatedAt,
  });
  if (saveError) return { ok: false, error: "save_failed", message: saveError.message };

  return {
    ok: true,
    draftId: draft.id,
    title: result.title,
    changesTitle: result.changesTitle,
    changes: result.changes,
    keptTitle: result.keptTitle,
    kept: result.kept,
    pages: result.pages,
    audiences: result.audiences,
  };
}
