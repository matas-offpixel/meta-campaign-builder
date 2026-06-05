/**
 * lib/db/bulk-attach-drafts.ts
 *
 * Server-side CRUD for bulk_attach_drafts.
 * Every function accepts an authenticated Supabase client created by the
 * route handler (createClient from @/lib/supabase/server). RLS on the table
 * enforces user isolation — no additional user_id filtering is needed in the
 * queries, but user_id must be supplied for INSERT.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BulkAttachDraftState } from "@/lib/bulk-attach/draft-state";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkAttachDraftRow {
  id: string;
  user_id: string;
  event_id: string | null;
  client_id: string | null;
  name: string;
  state: BulkAttachDraftState;
  created_at: string;
  updated_at: string;
  last_used_at: string;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listBulkAttachDrafts(
  supabase: SupabaseClient,
  { userId, eventId }: { userId: string; eventId?: string },
): Promise<BulkAttachDraftRow[]> {
  let query = supabase
    .from("bulk_attach_drafts")
    .select("id, user_id, event_id, client_id, name, state, created_at, updated_at, last_used_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`listBulkAttachDrafts: ${error.message}`);
  return (data ?? []) as BulkAttachDraftRow[];
}

// ─── Get one ──────────────────────────────────────────────────────────────────

export async function getBulkAttachDraft(
  supabase: SupabaseClient,
  { id, userId }: { id: string; userId: string },
): Promise<BulkAttachDraftRow | null> {
  const { data, error } = await supabase
    .from("bulk_attach_drafts")
    .select("id, user_id, event_id, client_id, name, state, created_at, updated_at, last_used_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`getBulkAttachDraft: ${error.message}`);
  return (data as BulkAttachDraftRow | null) ?? null;
}

// ─── Save (upsert) ────────────────────────────────────────────────────────────

export async function saveBulkAttachDraft(
  supabase: SupabaseClient,
  {
    id,
    userId,
    eventId,
    clientId,
    name,
    state,
  }: {
    id?: string;
    userId: string;
    eventId?: string | null;
    clientId?: string | null;
    name: string;
    state: BulkAttachDraftState;
  },
): Promise<BulkAttachDraftRow> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    event_id: eventId ?? null,
    client_id: clientId ?? null,
    name: name.trim() || "Untitled draft",
    state,
    last_used_at: new Date().toISOString(),
  };
  if (id) payload.id = id;

  const { data, error } = await supabase
    .from("bulk_attach_drafts")
    .upsert(payload, { onConflict: "id" })
    .select("id, user_id, event_id, client_id, name, state, created_at, updated_at, last_used_at")
    .single();

  if (error) throw new Error(`saveBulkAttachDraft: ${error.message}`);
  return data as BulkAttachDraftRow;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteBulkAttachDraft(
  supabase: SupabaseClient,
  { id, userId }: { id: string; userId: string },
): Promise<void> {
  const { error } = await supabase
    .from("bulk_attach_drafts")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`deleteBulkAttachDraft: ${error.message}`);
}

// ─── Touch last_used_at ───────────────────────────────────────────────────────

export async function touchBulkAttachDraft(
  supabase: SupabaseClient,
  { id, userId }: { id: string; userId: string },
): Promise<void> {
  const { error } = await supabase
    .from("bulk_attach_drafts")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`touchBulkAttachDraft: ${error.message}`);
}
