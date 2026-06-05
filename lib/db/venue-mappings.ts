/**
 * venue-mappings.ts
 *
 * DB helpers for client_venue_mappings.
 * All reads are via the RLS-scoped cookie client; writes go through the same
 * client so the RLS policy enforces ownership automatically.
 */

import { createClient } from "@/lib/supabase/server";

export interface VenueMappingRow {
  id: string;
  client_id: string;
  sheet_label: string;
  event_code: string;
  nation_label: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export async function listVenueMappings(clientId: string): Promise<VenueMappingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("client_venue_mappings")
    .select("*")
    .eq("client_id", clientId)
    .order("sheet_label");
  if (error) throw error;
  return data ?? [];
}

export async function upsertVenueMappings(
  clientId: string,
  rows: Array<{ sheet_label: string; event_code: string; nation_label?: string; notes?: string }>,
): Promise<void> {
  const supabase = await createClient();
  const payload = rows.map((r) => ({
    client_id: clientId,
    sheet_label: r.sheet_label.trim(),
    event_code: r.event_code.trim(),
    nation_label: r.nation_label ?? null,
    notes: r.notes ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("client_venue_mappings")
    .upsert(payload, { onConflict: "client_id,sheet_label" });
  if (error) throw error;
}

export async function deleteVenueMapping(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_venue_mappings")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
