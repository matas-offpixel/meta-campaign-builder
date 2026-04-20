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
// contract for /api/intelligence/audiences.
//
// TODO(post-020): drop the `as never` casts once types regenerate.
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
    .from("audience_seeds" as never)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.warn("[audience-seeds listAudienceSeeds]", error.message);
    return [];
  }
  return ((data as unknown as AudienceSeedRow[]) ?? []) as AudienceSeedRow[];
}

export async function getAudienceSeed(
  id: string,
): Promise<AudienceSeedRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audience_seeds" as never)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.warn("[audience-seeds getAudienceSeed]", error.message);
    return null;
  }
  return (data as unknown as AudienceSeedRow | null) ?? null;
}

export async function createAudienceSeed(
  userId: string,
  input: Omit<AudienceSeedInsert, "user_id">,
): Promise<AudienceSeedRow> {
  const supabase = await createClient();
  const payload = {
    user_id: userId,
    name: input.name,
    description: input.description ?? null,
    filters: input.filters ?? {},
    meta_custom_audience_id: input.meta_custom_audience_id ?? null,
  };
  const { data, error } = await supabase
    .from("audience_seeds" as never)
    .insert(payload as never)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("createAudienceSeed returned no row");
  return data as unknown as AudienceSeedRow;
}

export async function updateAudienceSeed(
  id: string,
  patch: AudienceSeedUpdate,
): Promise<AudienceSeedRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audience_seeds" as never)
    .update(patch as never)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as AudienceSeedRow | null) ?? null;
}

export async function deleteAudienceSeed(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("audience_seeds" as never)
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}
