import type { SupabaseClient } from "@supabase/supabase-js";

import type { EventLinkedDraft } from "@/lib/db/events";

export async function listDraftsForEventIds(
  supabase: SupabaseClient,
  eventIds: string[],
): Promise<EventLinkedDraft[]> {
  if (eventIds.length === 0) return [];
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, name, objective, status, updated_at")
    .in("event_id", eventIds)
    .order("updated_at", { ascending: false });

  if (error) {
    console.warn("[venue-drafts] load failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? null,
    objective: (row.objective as string | null) ?? null,
    status: ((row.status as EventLinkedDraft["status"] | null) ?? "draft"),
    updated_at: row.updated_at as string,
  }));
}
