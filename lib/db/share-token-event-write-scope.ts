import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import {
  isEventScopedShare,
  resolveShareByToken,
} from "@/lib/db/report-shares";

export type ShareTokenEventWriteScope =
  | { ok: true; eventId: string; ownerUserId: string }
  | {
      ok: false;
      status: number;
      body: { ok: false; error: string };
    };

/**
 * Validates a public report share token for mutating event-scoped data
 * (additional spend, rollup-sync, etc.): enabled, unexpired, event scope,
 * and event owner still matches the share's user_id.
 */
export async function assertEventShareTokenWritable(
  token: string,
  supabase: SupabaseClient<Database>,
): Promise<ShareTokenEventWriteScope> {
  const resolved = await resolveShareByToken(token, supabase);
  if (!resolved.ok) {
    if (resolved.reason === "error") {
      return {
        ok: false,
        status: 500,
        body: { ok: false, error: "Share lookup failed" },
      };
    }
    return {
      ok: false,
      status: 404,
      body: { ok: false, error: "Share not found" },
    };
  }

  if (!isEventScopedShare(resolved.share)) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error:
          "Token is client-scope; additional spend requires an event-scope share.",
      },
    };
  }

  const eventId = resolved.share.event_id;
  const ownerUserId = resolved.share.user_id;

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("id", eventId)
    .maybeSingle();

  if (eventErr) {
    return {
      ok: false,
      status: 500,
      body: { ok: false, error: eventErr.message },
    };
  }
  if (!event) {
    return {
      ok: false,
      status: 404,
      body: { ok: false, error: "Event not found" },
    };
  }
  if (event.user_id !== ownerUserId) {
    console.warn(
      `[share-token-write-scope] owner mismatch token=${token.slice(0, 6)} event_owner=${event.user_id} share_owner=${ownerUserId}`,
    );
    return {
      ok: false,
      status: 409,
      body: { ok: false, error: "Share owner does not match event owner" },
    };
  }

  return { ok: true, eventId, ownerUserId };
}
