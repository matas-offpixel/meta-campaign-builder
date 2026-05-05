import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import {
  isClientScopedShare,
  isVenueScopedShare,
  resolveShareByToken,
} from "@/lib/db/report-shares";

/**
 * lib/db/share-token-venue-write-scope.ts
 *
 * Venue-scope analogue of `assertEventShareTokenWritable`. Resolves a
 * `scope='venue'` share token to its `(client_id, event_code)` pivot.
 * It also accepts a `scope='client'` token when the caller supplies an
 * `eventId`; in that case the event anchors the venue group and must
 * belong to the client share. This lets client-wide share URLs render
 * venue subpages without requiring a separate venue token.
 *
 * Contract:
 *   - Returns `ok: true` with `{ clientId, eventCode, anchorEventId,
 *     ownerUserId, canEdit }` when the token is a valid, enabled,
 *     non-expired venue share, or a client share with an event anchor,
 *     AND the share owner still owns the resolved venue event(s).
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
      canEdit: boolean;
    }
  | {
      ok: false;
      status: number;
      body: { ok: false; error: string };
    };

export async function assertVenueShareTokenWritable(
  token: string,
  supabase: SupabaseClient<Database>,
  options?: { requireCanEdit?: boolean; eventId?: string },
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

  if (!isVenueScopedShare(resolved.share) && !isClientScopedShare(resolved.share)) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error:
          "Token scope is not 'venue' or 'client'; venue writes require a venue or client share.",
      },
    };
  }

  const clientId = resolved.share.client_id;
  const ownerUserId = resolved.share.user_id;
  let eventCode: string;
  let anchorEventId: string | null = null;

  if (isVenueScopedShare(resolved.share)) {
    eventCode = resolved.share.event_code;
  } else {
    if (!options?.eventId) {
      return {
        ok: false,
        status: 400,
        body: {
          ok: false,
          error: "event_id is required when using a client-scoped share token",
        },
      };
    }
    const { data: event, error: eventErr } = await supabase
      .from("events")
      .select("id, user_id, event_code")
      .eq("id", options.eventId)
      .eq("client_id", clientId)
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
        body: {
          ok: false,
          error: "Event does not belong to this client share",
        },
      };
    }
    if (event.user_id !== ownerUserId) {
      console.warn(
        `[venue-share-token] owner mismatch token=${token.slice(0, 6)} event_owner=${event.user_id} share_owner=${ownerUserId}`,
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
    if (!event.event_code) {
      return {
        ok: false,
        status: 404,
        body: {
          ok: false,
          error: "Event has no venue event_code",
        },
      };
    }
    eventCode = event.event_code;
    anchorEventId = event.id;
  }

  // Pick a stable anchor event — the lowest id under the group, owned
  // by the share's user. If the share's user no longer owns any event
  // in the group (rename / transfer) we 409 so the operator knows the
  // token is stale rather than silently writing against another tenant.
  const { data: candidate, error: anchorErr } = anchorEventId
    ? await supabase
        .from("events")
        .select("id, user_id")
        .eq("id", anchorEventId)
        .eq("client_id", clientId)
        .eq("event_code", eventCode)
        .maybeSingle()
    : await supabase
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
    canEdit: resolved.share.can_edit,
  };
}
