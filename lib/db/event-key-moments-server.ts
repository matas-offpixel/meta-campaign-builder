import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { EventKeyMoment } from "./event-key-moments";

/**
 * Server-side counterpart to lib/db/event-key-moments.ts:listMomentsForEvent.
 * Used by the /events/[id] server page to prefetch moments alongside the
 * existing event + plan + drafts fetch — so the plan grid paints with
 * moment labels on first nav rather than after a client refetch.
 *
 * Lives in a separate file because lib/supabase/server.ts pulls in
 * `next/headers`, which can't be bundled into client components.
 */
export async function listMomentsForEventServer(
  eventId: string,
): Promise<EventKeyMoment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("event_key_moments")
    .select("*")
    .eq("event_id", eventId)
    .order("moment_date", { ascending: true });

  if (error) {
    console.warn("Supabase listMomentsForEventServer error:", error.message);
    return [];
  }
  return (data ?? []) as EventKeyMoment[];
}
