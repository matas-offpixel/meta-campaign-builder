import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { ClientRow } from "./clients";

/**
 * Server-side counterpart to lib/db/clients.ts read helpers.
 *
 * Lives in a separate file because lib/supabase/server.ts pulls in
 * `next/headers`, which can't be bundled into client components.
 * The client-side read helpers in clients.ts continue to be used by
 * "use client" components that need to react to user interaction.
 */

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
