import "server-only";

import { createClient } from "@/lib/supabase/server";
import type {
  AudienceSeedFilters,
  AudienceSeedInsert,
  AudienceSeedRow,
  AudienceSeedUpdate,
} from "@/lib/types/intelligence";

// ─────────────────────────────────────────────────────────────────────────────
// Server-side helpers for the `audience_seeds` table (migration 020).
//
// Filters are stored as JSONB so the cross-event filter set can evolve
// without schema churn — the AudienceSeedFilters type doubles as the API
// contract for /api/intelligence/audiences. We narrow `filters` from the
// generated `Json` back to AudienceSeedFilters at the read boundary.
// ─────────────────────────────────────────────────────────────────────────────

export type {
  AudienceSeedRow,
  AudienceSeedInsert,
  AudienceSeedUpdate,
  AudienceSeedFilters,
};

export async function listAudienceSeeds(
  userId: string,
): Promise<AudienceSeedRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audience_seeds")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("[audience-seeds listAudienceSeeds]", error.message);
    return [];
  }
  return (data ?? []) as AudienceSeedRow[];
}

export async function getAudienceSeed(
  id: string,
): Promise<AudienceSeedRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audience_seeds")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[audience-seeds getAudienceSeed]", error.message);
    return null;
  }
  return (data as AudienceSeedRow | null) ?? null;
}

export async function createAudienceSeed(
  userId: string,
  input: Omit<AudienceSeedInsert, "user_id">,
): Promise<AudienceSeedRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audience_seeds")
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      filters: input.filters ?? {},
      meta_custom_audience_id: input.meta_custom_audience_id ?? null,
    })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("createAudienceSeed returned no row");
  return data as AudienceSeedRow;
}

export async function updateAudienceSeed(
  id: string,
  patch: AudienceSeedUpdate,
): Promise<AudienceSeedRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audience_seeds")
    .update(patch)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AudienceSeedRow | null) ?? null;
}

export async function deleteAudienceSeed(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("audience_seeds")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
