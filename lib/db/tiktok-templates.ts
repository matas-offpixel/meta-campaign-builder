import { createClient } from "@/lib/supabase/client";
import {
  snapshotTikTokDraft,
  type TikTokCampaignTemplate,
} from "../tiktok-wizard/templates.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import { throwIfTikTokTemplateDeleteFailed } from "./tiktok-template-delete.ts";

export { throwIfTikTokTemplateDeleteFailed } from "./tiktok-template-delete.ts";

function rowToTemplate(row: Record<string, unknown>): TikTokCampaignTemplate {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    tags: (row.tags as string[]) ?? [],
    snapshot: row.snapshot as TikTokCampaignTemplate["snapshot"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function loadTikTokTemplatesFromDb(
  userId: string,
): Promise<TikTokCampaignTemplate[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tiktok_campaign_templates")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error || !data) {
    console.warn("Supabase TikTok template load error:", error?.message);
    return [];
  }
  return data.map((row) => rowToTemplate(row as Record<string, unknown>));
}

export async function saveTikTokTemplateToDb(
  draft: TikTokCampaignDraft,
  name: string,
  description: string,
  tags: string[],
  userId: string,
): Promise<TikTokCampaignTemplate> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tiktok_campaign_templates")
    .insert({
      user_id: userId,
      name,
      description,
      tags,
      snapshot: snapshotTikTokDraft(draft),
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save TikTok template");
  }
  return rowToTemplate(data as Record<string, unknown>);
}

export async function deleteTikTokTemplateFromDb(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("tiktok_campaign_templates")
    .delete()
    .eq("id", id);
  throwIfTikTokTemplateDeleteFailed(error);
}

