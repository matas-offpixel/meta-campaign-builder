import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ClientRow, ClientStatus } from "./clients";

/**
 * Server-side counterpart to lib/db/clients.ts read helpers.
 *
 * Lives in a separate file because lib/supabase/server.ts pulls in
 * `next/headers`, which can't be bundled into client components.
 * The client-side read helpers in clients.ts continue to be used by
 * "use client" components that need to react to user interaction.
 */

export async function listClientsServer(
  userId: string,
  options?: {
    status?: ClientStatus;
    /**
     * Substring filter on client name. Applied in memory after fetch
     * (RLS-bounded set), mirroring the events-server convention so we
     * don't have to hand-escape user input into a PostgREST .or() query.
     * Trimmed; empty/null is treated as no filter.
     */
    q?: string | null;
  },
): Promise<ClientRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("clients")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) {
    console.warn("Supabase listClientsServer error:", error.message);
    return [];
  }
  let rows = (data ?? []) as ClientRow[];

  if (options?.q) {
    const needle = options.q.trim().toLowerCase();
    if (needle) {
      rows = rows.filter((c) => (c.name?.toLowerCase() ?? "").includes(needle));
    }
  }

  return rows;
}

export async function getClientByIdServer(id: string): Promise<ClientRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.warn("Supabase getClientByIdServer error:", error.message);
    return null;
  }
  return (data as ClientRow | null) ?? null;
}
