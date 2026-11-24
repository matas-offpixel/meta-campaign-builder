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
 * audiences. No UI calls this yet (CC-4 wires the dialog).
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

export async function replicateToEvent(
  draftId: string,
  eventId: string,
  overrides: ReplicateEventOverrides = {},
): Promise<ReplicateToEventResult> {
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
