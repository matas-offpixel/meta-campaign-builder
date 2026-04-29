import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "./database.types.ts";
import {
  createDefaultTikTokDraft,
  type TikTokCampaignDraft,
  type TikTokDraftStatus,
} from "../types/tiktok-draft.ts";

const TABLE = "tiktok_campaign_drafts";
type TypedSupabaseClient = SupabaseClient<Database>;

export interface TikTokDraftListFilters {
  userId?: string;
  status?: TikTokDraftStatus;
  clientId?: string;
  eventId?: string;
}

interface TikTokDraftRow {
  id: string;
  client_id: string | null;
  event_id: string | null;
  status: TikTokDraftStatus;
  state: unknown;
  created_at: string;
  updated_at: string;
}

export async function getTikTokDraft(
  supabase: TypedSupabaseClient,
  draftId: string,
): Promise<TikTokCampaignDraft | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, client_id, event_id, status, state, created_at, updated_at")
    .eq("id", draftId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToDraft(data as TikTokDraftRow);
}

export async function upsertTikTokDraft(
  supabase: TypedSupabaseClient,
  draftId: string,
  partial: Partial<TikTokCampaignDraft> & { userId: string },
): Promise<TikTokCampaignDraft> {
  const now = new Date().toISOString();
  const draft: TikTokCampaignDraft = {
    ...createDefaultTikTokDraft(draftId),
    ...partial,
    id: draftId,
    updatedAt: now,
  };
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: draft.id,
      user_id: partial.userId,
      client_id: draft.clientId,
      event_id: draft.eventId,
      name: draft.campaignSetup.campaignName || null,
      status: draft.status,
      // The DB column is intentionally jsonb so the wizard can evolve between
      // launches. Generated Supabase types expose that as generic Json, not the
      // application-level TikTokCampaignDraft shape.
      state: draft as unknown as Json,
      updated_at: now,
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
  return draft;
}

export async function listTikTokDrafts(
  supabase: TypedSupabaseClient,
  filters: TikTokDraftListFilters = {},
): Promise<TikTokCampaignDraft[]> {
  let query = supabase
    .from(TABLE)
    .select("id, client_id, event_id, status, state, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (filters.userId) query = query.eq("user_id", filters.userId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.eventId) query = query.eq("event_id", filters.eventId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as TikTokDraftRow[]).map(rowToDraft);
}

export async function deleteTikTokDraft(
  supabase: TypedSupabaseClient,
  draftId: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

function rowToDraft(row: TikTokDraftRow): TikTokCampaignDraft {
  const base = createDefaultTikTokDraft(row.id);
  const state =
    row.state && typeof row.state === "object"
      ? (row.state as Partial<TikTokCampaignDraft>)
      : {};
  return {
    ...base,
    ...state,
    id: row.id,
    clientId: row.client_id,
    eventId: row.event_id,
    status: row.status ?? "draft",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
