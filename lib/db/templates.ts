import { createClient } from "@/lib/supabase/client";
import type { CampaignDraft, CampaignTemplate } from "@/lib/types";

function rowToTemplate(row: Record<string, unknown>): CampaignTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    tags: (row.tags as string[]) ?? [],
    snapshot: row.snapshot_json as CampaignTemplate["snapshot"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/**
 * Fetch all templates for the authenticated user, most recent first.
 */
export async function loadTemplatesFromDb(userId: string): Promise<CampaignTemplate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("campaign_templates")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.warn("Supabase template load error:", error?.message);
    return [];
  }

  return data.map((row) => rowToTemplate(row as Record<string, unknown>));
}

/**
 * Save a new template derived from the current draft.
 * Strips runtime fields (id, status, dates) and date range from budgetSchedule.
 */
export async function saveTemplateToDb(
  draft: CampaignDraft,
  name: string,
  description: string,
  tags: string[],
  userId: string,
): Promise<CampaignTemplate> {
  const { id: _id, status: _s, createdAt: _ca, updatedAt: _ua, ...snapshot } = draft;
  const cleanSnapshot: CampaignTemplate["snapshot"] = {
    ...snapshot,
    budgetSchedule: {
      ...snapshot.budgetSchedule,
      startDate: "",
      endDate: "",
    },
  };

  const supabase = createClient();
  const { data, error } = await supabase
    .from("campaign_templates")
    .insert({
      user_id: userId,
      name,
      description,
      tags,
      snapshot_json: cleanSnapshot,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save template");
  }

  return rowToTemplate(data as Record<string, unknown>);
}

/**
 * Delete a template by id. RLS ensures users can only delete their own rows.
 */
export async function deleteTemplateFromDb(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("campaign_templates").delete().eq("id", id);
  if (error) {
    console.warn("Supabase template delete error:", error.message);
  }
}
