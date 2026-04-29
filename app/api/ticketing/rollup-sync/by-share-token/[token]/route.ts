import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { runRollupSyncForEvent } from "@/lib/dashboard/rollup-sync-runner";
import {
  isEventScopedShare,
  resolveShareByToken,
} from "@/lib/db/report-shares";

/**
 * POST /api/ticketing/rollup-sync/by-share-token/[token]
 *
 * Public-safe entry point for the per-event daily rollup sync. Auth
 * is the share token itself — the same credential the visitor used
 * to load `/share/report/[token]`. No user session is required.
 *
 * Pre-PR #67 the rollup-sync route only ran during a signed-in
 * dashboard visit. Clients viewing the share URL saw a stale Daily
 * Tracker (today's row missing) until a staffer opened the internal
 * event page. This route lets the share page's Refresh button fire a
 * sync without exposing arbitrary write access — the share token
 * scopes the sync to exactly one event, and the credentials used for
 * the upstream Meta + Eventbrite calls belong to the share's owning
 * user (not the visitor).
 *
 * Restrictions:
 *   - Token must resolve, be enabled, and not be expired
 *     (`resolveShareByToken` returns one of `missing` / `disabled` /
 *     `expired` / `malformed` / `error` otherwise — all collapse to
 *     a 404 from the public surface).
 *   - Token must be `scope === "event"`. Client-portal tokens are
 *     rejected with a 400 because there's no single event to sync.
 *
 * Rate-limit posture:
 *   - The share page's Refresh button is wired to call this on every
 *     click. We don't rate-limit here because the upstream Meta API
 *     already enforces per-account quotas, and Eventbrite is read-
 *     only. If abuse becomes a concern we'd add a per-token
 *     `last_refresh_at` column on `report_shares` and gate writes on
 *     it.
 */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const resolved = await resolveShareByToken(token, supabase);
  if (!resolved.ok) {
    // Collapse missing / disabled / expired / malformed into a 404 so
    // the surface doesn't leak which exact failure mode applied —
    // matches the share page's own narrowing in
    // `app/share/report/[token]/page.tsx`.
    if (resolved.reason === "error") {
      return NextResponse.json(
        { ok: false, error: "Share lookup failed" },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { ok: false, error: "Share not found" },
      { status: 404 },
    );
  }

  if (!isEventScopedShare(resolved.share)) {
    // Client-portal tokens cover an aggregate of every event under a
    // client and have no single event_id to sync. Return 400 so a
    // mis-wired client doesn't silently no-op.
    return NextResponse.json(
      {
        ok: false,
        error: "Token is client-scope; rollup-sync requires an event-scope share.",
      },
      { status: 400 },
    );
  }

  const share = resolved.share;
  const eventId = share.event_id;
  const ownerUserId = share.user_id;

  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select(
      "id, user_id, event_code, event_timezone, event_date, client_id, tiktok_account_id, google_ads_account_id, client:clients ( meta_ad_account_id, tiktok_account_id, google_ads_account_id )",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!event) {
    return NextResponse.json(
      { ok: false, error: "Event not found" },
      { status: 404 },
    );
  }
  // Defensive: confirm the event still belongs to the share's owning
  // user. A share token whose owner has been transferred (rare) or
  // whose event was reassigned should not let the visitor sync rows
  // under the new owner — keep the runner scoped to the original
  // creator's credentials.
  if (event.user_id !== ownerUserId) {
    console.warn(
      `[rollup-sync/by-share-token] owner mismatch token=${token.slice(0, 6)} event_owner=${event.user_id} share_owner=${ownerUserId}`,
    );
    return NextResponse.json(
      { ok: false, error: "Share owner does not match event owner" },
      { status: 409 },
    );
  }

  const eventCode = (event.event_code as string | null) ?? null;
  const eventTimezone = (event.event_timezone as string | null) ?? null;
  const eventDate = (event.event_date as string | null) ?? null;
  const clientId = (event.client_id as string | null) ?? null;
  const eventTikTokAccountId = (event.tiktok_account_id as string | null) ?? null;
  const eventGoogleAdsAccountId =
    (event.google_ads_account_id as string | null) ?? null;
  const clientRel = event.client as
    | { meta_ad_account_id: string | null; tiktok_account_id: string | null; google_ads_account_id: string | null }
    | { meta_ad_account_id: string | null; tiktok_account_id: string | null; google_ads_account_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);
  const clientTikTokAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.tiktok_account_id ?? null)
    : (clientRel?.tiktok_account_id ?? null);
  const clientGoogleAdsAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.google_ads_account_id ?? null)
    : (clientRel?.google_ads_account_id ?? null);

  const result = await runRollupSyncForEvent({
    supabase,
    eventId,
    userId: ownerUserId,
    eventCode,
    eventTimezone,
    adAccountId,
    clientId,
    eventDate,
    eventTikTokAccountId,
    clientTikTokAccountId,
    eventGoogleAdsAccountId,
    clientGoogleAdsAccountId,
  });

  return NextResponse.json(
    {
      ok: result.ok,
      summary: result.summary,
      meta: result.meta,
      tiktok: result.tiktok,
      googleAds: result.googleAds,
      eventbrite: result.eventbrite,
      diagnostics: result.diagnostics,
    },
    { status: result.ok ? 200 : result.anyOk ? 207 : 200 },
  );
}
