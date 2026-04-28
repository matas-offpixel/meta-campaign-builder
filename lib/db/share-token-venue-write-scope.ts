import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import {
  isVenueScopedShare,
  resolveShareByToken,
} from "@/lib/db/report-shares";

/**
 * lib/db/share-token-venue-write-scope.ts
 *
 * Venue-scope analogue of `assertEventShareTokenWritable`. Resolves a
 * `scope='venue'` share token to its `(client_id, event_code)` pivot
 * plus an "anchor" `event_id` the caller can use when writing
 * additional-spend rows — the DB keeps `event_id` non-null even for
 * venue-scope rows (so RLS + FK stay unchanged) and we point every
 * write at an arbitrary event inside the group.
 *
 * Contract:
 *   - Returns `ok: true` with `{ clientId, eventCode, anchorEventId,
 *     ownerUserId }` when the token is a valid, enabled, non-expired
 *     venue share AND the client still owns at least one event under
 *     that `event_code`.
 *   - Returns a structured `{ ok: false, status, body }` error otherwise.
 *
 * `requireCanEdit` defaults to true — POST/PATCH/DELETE callers should
 * leave it at the default; GET callers pass `requireCanEdit: false` so
 * view-only shares can still list the rows.
 *
 * Why resolve to an anchor event here rather than make every caller do
 * it: the additional-spend insert/update helpers already scope by
 * `user_id` under RLS; the caller doesn't need to know *which* event
 * backs the row, only that one exists. Centralising the lookup keeps
 * cross-tenant leakage impossible — a malformed share row that lists
 * `event_code` with no backing events 404s at the edge.
 */

export type ShareTokenVenueWriteScope =
  | {
      ok: true;
      clientId: string;
      eventCode: string;
      /**
       * Stable event_id we route writes through. Picked deterministically
       * (lowest id under the group) so the same row on repeat inserts stays
       * attributable to the same event FK — useful when inspecting raw
       * data, even though the aggregator pivots on `venue_event_code`.
       */
      anchorEventId: string;
      ownerUserId: string;
    }
  | {
      ok: false;
      status: number;
      body: { ok: false; error: string };
    };

export async function assertVenueShareTokenWritable(
  token: string,
  supabase: SupabaseClient<Database>,
  options?: { requireCanEdit?: boolean },
): Promise<ShareTokenVenueWriteScope> {
  const requireCanEdit = options?.requireCanEdit !== false;

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

  if (!isVenueScopedShare(resolved.share)) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error:
          "Token scope is not 'venue'; venue additional spend requires a venue-scope share.",
      },
    };
  }

  const { client_id: clientId, event_code: eventCode } = resolved.share;
  const ownerUserId = resolved.share.user_id;

  // Pick a stable anchor event — the lowest id under the group, owned
  // by the share's user. If the share's user no longer owns any event
  // in the group (rename / transfer) we 409 so the operator knows the
  // token is stale rather than silently writing against another tenant.
  const { data: candidate, error: anchorErr } = await supabase
    .from("events")
    .select("id, user_id")
    .eq("client_id", clientId)
    .eq("event_code", eventCode)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (anchorErr) {
    return {
      ok: false,
      status: 500,
      body: { ok: false, error: anchorErr.message },
    };
  }
  if (!candidate) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        error: "Venue has no events under this event_code",
      },
    };
  }
  if (candidate.user_id !== ownerUserId) {
    console.warn(
      `[venue-share-token] owner mismatch token=${token.slice(0, 6)} event_owner=${candidate.user_id} share_owner=${ownerUserId}`,
    );
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "Share owner does not match venue event owner",
      },
    };
  }

  if (requireCanEdit && !resolved.share.can_edit) {
    return {
      ok: false,
      status: 403,
      body: { ok: false, error: "Share link is view-only" },
    };
  }

  return {
    ok: true,
    clientId,
    eventCode,
    anchorEventId: candidate.id,
    ownerUserId,
  };
}
