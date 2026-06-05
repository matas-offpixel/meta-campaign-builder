/**
 * lib/db/bulk-attach-templates.ts
 *
 * Server-side CRUD for bulk_attach_templates.
 * Mirrors bulk-attach-drafts.ts in structure. Every function accepts an
 * authenticated Supabase server client; RLS enforces user isolation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MatchPattern, CreativeConfig } from "@/lib/bulk-attach/template-matcher";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BulkAttachTemplateRow {
  id: string;
  user_id: string;
  client_id: string | null;
  name: string;
  description: string | null;
  match_pattern: MatchPattern;
  creative_config: CreativeConfig;
  use_count: number;
  created_at: string;
  updated_at: string;
}

// ─── List ─────────────────────────────────────────────────────────────────────

export async function listBulkAttachTemplates(
  supabase: SupabaseClient,
  { userId }: { userId: string },
): Promise<BulkAttachTemplateRow[]> {
  const { data, error } = await supabase
    .from("bulk_attach_templates")
    .select(
      "id, user_id, client_id, name, description, match_pattern, creative_config, use_count, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`listBulkAttachTemplates: ${error.message}`);
  return (data ?? []) as BulkAttachTemplateRow[];
}

// ─── Get one ──────────────────────────────────────────────────────────────────

export async function getBulkAttachTemplate(
  supabase: SupabaseClient,
  { id, userId }: { id: string; userId: string },
): Promise<BulkAttachTemplateRow | null> {
  const { data, error } = await supabase
    .from("bulk_attach_templates")
    .select(
      "id, user_id, client_id, name, description, match_pattern, creative_config, use_count, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`getBulkAttachTemplate: ${error.message}`);
  return (data as BulkAttachTemplateRow | null) ?? null;
}

// ─── Save (upsert) ────────────────────────────────────────────────────────────

export async function saveBulkAttachTemplate(
  supabase: SupabaseClient,
  {
    id,
    userId,
    clientId,
    name,
    description,
    matchPattern,
    creativeConfig,
  }: {
    id?: string;
    userId: string;
    clientId?: string | null;
    name: string;
    description?: string | null;
    matchPattern: MatchPattern;
    creativeConfig: CreativeConfig;
  },
): Promise<BulkAttachTemplateRow> {
  const payload: Record<string, unknown> = {
    user_id: userId,
    client_id: clientId ?? null,
    name: name.trim() || "Untitled template",
    description: description?.trim() || null,
    match_pattern: matchPattern,
    creative_config: creativeConfig,
  };
  if (id) payload.id = id;

  const { data, error } = await supabase
    .from("bulk_attach_templates")
    .upsert(payload, { onConflict: "id" })
    .select(
      "id, user_id, client_id, name, description, match_pattern, creative_config, use_count, created_at, updated_at",
    )
    .single();

  if (error) throw new Error(`saveBulkAttachTemplate: ${error.message}`);
  return data as BulkAttachTemplateRow;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteBulkAttachTemplate(
  supabase: SupabaseClient,
  { id, userId }: { id: string; userId: string },
): Promise<void> {
  const { error } = await supabase
    .from("bulk_attach_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) throw new Error(`deleteBulkAttachTemplate: ${error.message}`);
}

// ─── Increment use_count ──────────────────────────────────────────────────────

export async function incrementTemplateUseCount(
  supabase: SupabaseClient,
  { id, userId }: { id: string; userId: string },
): Promise<void> {
  const { error } = await supabase.rpc("increment_bulk_attach_template_use_count", {
    template_id: id,
    template_user_id: userId,
  });
  if (error) throw new Error(`incrementTemplateUseCount: ${error.message}`);
}
