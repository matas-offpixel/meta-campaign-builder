import { createClient } from "@/lib/supabase/client";
import {
  buildDuplicatedCampaign,
  describeCodeEventMismatch,
  joinEventWarnings,
  type CampaignEventIdentity,
} from "@/lib/campaign-event";
import type { CampaignDraft, CampaignListItem } from "@/lib/types";
import { migrateDraft } from "@/lib/autosave";

// ─── List ────────────────────────────────────────────────────────────────────

export async function loadCampaignList(
  userId: string,
  status?: CampaignDraft["status"],
): Promise<CampaignListItem[]> {
  const supabase = createClient();
  let query = supabase
    .from("campaign_drafts")
    .select("id, name, objective, status, ad_account_id, created_at, updated_at, event_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error || !data) {
    console.warn("Supabase campaign list error:", error?.message);
    return [];
  }

  const listRows = data as Array<{
    id: string;
    name: string | null;
    objective: string | null;
    status: string | null;
    ad_account_id: string | null;
    created_at: string;
    updated_at: string;
    event_id: string | null;
  }>;

  const eventIds = [
    ...new Set(
      listRows
        .map((row) => row.event_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const eventsById = new Map<string, CampaignEventIdentity>();
  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, event_code, name, venue_city, venue_name, event_date, client_id")
      .in("id", eventIds);
    if (eventsError) {
      console.warn("Supabase campaign list events error:", eventsError.message);
    }
    for (const event of (events ?? []) as CampaignEventIdentity[]) {
      eventsById.set(event.id, event);
    }
  }

  return listRows.map((row) => {
    const eventId = row.event_id?.trim() || "";
    const event = eventId ? (eventsById.get(eventId) ?? null) : null;
    return {
      id: row.id,
      name: row.name,
      objective: row.objective,
      status: (row.status as CampaignDraft["status"]) ?? "draft",
      adAccountId: row.ad_account_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      eventWarning: joinEventWarnings(
        describeCodeEventMismatch({
          campaignCode: null,
          campaignName: row.name,
          event,
        }),
      ),
    };
  });
}

// ─── Load one ────────────────────────────────────────────────────────────────

export async function loadDraftById(id: string): Promise<CampaignDraft | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("draft_json")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  try {
    return migrateDraft(data.draft_json as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function loadLatestDraft(userId: string): Promise<CampaignDraft | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("draft_json")
    .eq("user_id", userId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  try {
    return migrateDraft(data.draft_json as Record<string, unknown>);
  } catch {
    return null;
  }
}

// ─── Save / upsert ──────────────────────────────────────────────────────────

export async function saveDraftToDb(draft: CampaignDraft, userId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("campaign_drafts").upsert(
    {
      id: draft.id,
      user_id: userId,
      name: draft.settings.campaignName || null,
      objective: draft.settings.objective || null,
      status: draft.status ?? "draft",
      ad_account_id: draft.settings.adAccountId || null,
      // FK columns added in migration 003. Empty strings come from the
      // default settings shape (`createDefaultDraft`) before the library
      // picker has run — coerce to SQL NULL so the uuid FK does not error.
      client_id: draft.settings.clientId || null,
      // Column follows settings.eventId — JSON is the source of truth.
      event_id: draft.settings.eventId || null,
      draft_json: draft,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    console.warn("Supabase draft save error:", error.message);
  }
}

// ─── Publish (status + Meta campaign ID in one call) ─────────────────────────

/**
 * Marks a campaign as published and records the Meta campaign ID.
 * Stores metaCampaignId both in `draft_json` (for full fidelity) and as a
 * top-level column when the column exists in the schema.
 */
export async function publishCampaign(
  draft: CampaignDraft,
  metaCampaignId: string,
  userId: string,
): Promise<void> {
  const supabase = createClient();
  const published: CampaignDraft = {
    ...draft,
    metaCampaignId,
    status: "published",
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase.from("campaign_drafts").upsert(
    {
      id: published.id,
      user_id: userId,
      name: published.settings.campaignName || null,
      objective: published.settings.objective || null,
      status: "published",
      ad_account_id: published.settings.adAccountId || null,
      client_id: published.settings.clientId || null,
      event_id: published.settings.eventId || null,
      draft_json: published,
      updated_at: published.updatedAt,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.warn("Supabase publishCampaign error:", error.message);
  }
}

// ─── Status updates ──────────────────────────────────────────────────────────

export async function updateCampaignStatus(
  id: string,
  status: CampaignDraft["status"],
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("campaign_drafts")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.warn("Supabase status update error:", error.message);
  }
}

// ─── Duplicate ───────────────────────────────────────────────────────────────

export async function duplicateCampaign(
  id: string,
  userId: string,
  eventId: string,
): Promise<CampaignDraft | null> {
  if (!eventId?.trim()) return null;

  const original = await loadDraftById(id);
  if (!original) return null;

  const supabase = createClient();
  const { data: event, error } = await supabase
    .from("events")
    .select("id, event_code, client_id, name, venue_city, venue_name, event_date")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !event) {
    if (error) console.warn("Supabase duplicateCampaign event:", error.message);
    return null;
  }

  const copy = buildDuplicatedCampaign(
    original,
    event as CampaignEventIdentity,
    new Date().toISOString(),
    crypto.randomUUID(),
  );

  await saveDraftToDb(copy, userId);
  return copy;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteCampaign(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("campaign_drafts").delete().eq("id", id);
  if (error) {
    console.warn("Supabase campaign delete error:", error.message);
  }
}
