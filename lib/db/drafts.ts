import { createClient } from "@/lib/supabase/client";
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
    .select("id, name, objective, status, ad_account_id, created_at, updated_at")
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

  return data.map((row) => ({
    id: row.id as string,
    name: row.name as string | null,
    objective: row.objective as string | null,
    status: (row.status as CampaignDraft["status"]) ?? "draft",
    adAccountId: row.ad_account_id as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));
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
): Promise<CampaignDraft | null> {
  const original = await loadDraftById(id);
  if (!original) return null;

  const now = new Date().toISOString();
  const copy: CampaignDraft = {
    ...original,
    id: crypto.randomUUID(),
    settings: {
      ...original.settings,
      campaignName: original.settings.campaignName
        ? `${original.settings.campaignName} (Copy)`
        : "Untitled (Copy)",
    },
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };

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
