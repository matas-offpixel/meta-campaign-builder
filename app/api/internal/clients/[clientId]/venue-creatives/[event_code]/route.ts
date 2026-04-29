import { NextResponse, type NextRequest } from "next/server";

import { getOwnerFacebookToken } from "@/lib/db/report-shares";
import {
  FacebookAuthExpiredError,
  fetchActiveCreativesForEvent,
} from "@/lib/reporting/active-creatives-fetch";
import { groupByAssetSignature } from "@/lib/reporting/group-creatives";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

/**
 * GET /api/internal/clients/[clientId]/venue-creatives/[event_code]
 *
 * Session-authenticated twin of
 * `/api/share/client/[token]/venue-creatives/[event_code]`. Powers the
 * "Top creatives" strip inside the expanded venue card on the internal
 * dashboard (`/clients/[id]/dashboard`, `/clients/[id]` events tab)
 * where the operator doesn't hold a share token.
 *
 * Why a separate route and not "pass the token through":
 *
 *   Internal callers land on a Next.js route group without a token in
 *   the URL. The `<ClientPortal isInternal />` render previously reused
 *   the token-based endpoint by passing an empty string, producing a
 *   malformed URL (`/api/share/client//venue-creatives/...`) that Next
 *   served as the default HTML 404 instead of routing to the dynamic
 *   handler. The client fetcher then saw HTML in place of JSON and
 *   surfaced "Creative breakdown unavailable" with the raw DOCTYPE in
 *   the error. A dedicated internal endpoint removes the ambiguity and
 *   lets the auth model stay honest (session cookie, not share token).
 *
 * Auth:
 *
 *   1. `createClient()` — user-scoped Supabase client with the
 *      session cookie. `auth.getUser()` must return a user or the
 *      response is 401.
 *   2. `clients.user_id === user.id` — belt+braces ownership check
 *      on top of RLS. RLS would silently 0-row a cross-tenant read,
 *      but we want an explicit 403/404 split for the inline error
 *      surface.
 *
 * Downstream body shape mirrors the share route so
 * `<VenueActiveCreatives>` can consume either without branching on
 * payload structure.
 */

const SHARE_GROUPS_CAP = 30;

export const revalidate = 0;
export const dynamic = "force-dynamic";

function parseDatePreset(value: string | null): DatePreset {
  if (value === "custom") return "custom";
  if (value && (DATE_PRESETS as readonly string[]).includes(value)) {
    return value as DatePreset;
  }
  return "maximum";
}

function parseCustomRange(
  preset: DatePreset,
  since: string | null,
  until: string | null,
): CustomDateRange | undefined {
  if (preset !== "custom") return undefined;
  if (!since || !until) return undefined;
  return { since, until };
}

export async function GET(
  req: NextRequest,
  {
    params,
  }: { params: Promise<{ clientId: string; event_code: string }> },
) {
  const { clientId, event_code } = await params;
  const sp = req.nextUrl.searchParams;
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );
  if (!clientId || clientId.length > 64) {
    return NextResponse.json(
      { ok: false, error: "Invalid client id" },
      { status: 400 },
    );
  }
  const eventCodeRaw = decodeURIComponent(event_code ?? "");
  if (!eventCodeRaw || eventCodeRaw.length > 128) {
    return NextResponse.json(
      { ok: false, error: "Invalid event_code" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  // Ownership + meta account lookup in one round trip. Service-role
  // client is only used downstream for the Meta token read, which is
  // cross-schema (`user_identities`) and would otherwise need a
  // second RLS policy.
  const { data: clientRow, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id, meta_ad_account_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!clientRow) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }
  if (clientRow.user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Forbidden" },
      { status: 403 },
    );
  }

  // Cross-check the event_code belongs to this client. Prevents a
  // valid session from probing creatives under an event_code the
  // client never owned (shouldn't matter since Meta queries are
  // scoped by ad account, but cheaper to fail here than round-trip).
  const { data: eventExists, error: eventErr } = await supabase
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .eq("event_code", eventCodeRaw)
    .limit(1)
    .maybeSingle();
  if (eventErr) {
    return NextResponse.json(
      { ok: false, error: eventErr.message },
      { status: 500 },
    );
  }
  if (!eventExists) {
    return NextResponse.json(
      { ok: false, error: "Event code not found under this client" },
      { status: 404 },
    );
  }

  const adAccountId = clientRow.meta_ad_account_id ?? null;
  if (!adAccountId) {
    return NextResponse.json({ ok: true, groups: [], meta: emptyMeta() });
  }

  const admin = createServiceRoleClient();
  const ownerToken = await getOwnerFacebookToken(user.id, admin);
  if (!ownerToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Facebook not connected (or token expired). Reconnect in Settings → Integrations.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await fetchActiveCreativesForEvent({
      adAccountId,
      eventCode: eventCodeRaw,
      token: ownerToken,
      datePreset,
      customRange,
      // Match the share route's concurrency budget. The internal
      // dashboard can fan several expanded venue cards at once; a
      // single in-flight /ads call per card keeps us under Meta's
      // per-account rate budget even with four cards open.
      concurrency: 1,
    });

    if (result.meta.campaigns_total === 0) {
      return NextResponse.json({ ok: true, groups: [], meta: emptyMeta() });
    }

    const allGroups = groupByAssetSignature(result.creatives);
    const groups = allGroups.slice(0, SHARE_GROUPS_CAP);

    return NextResponse.json({
      ok: true,
      groups,
      meta: {
        campaigns_total: result.meta.campaigns_total,
        campaigns_failed: result.meta.campaigns_failed,
        ads_fetched: result.meta.ads_fetched,
        dropped_no_creative: result.meta.dropped_no_creative,
        truncated:
          result.meta.truncated || allGroups.length > SHARE_GROUPS_CAP,
        unattributed: result.meta.unattributed,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof FacebookAuthExpiredError) {
      console.error("[internal venue-creatives] owner FB token expired", {
        clientId,
        eventCode: eventCodeRaw,
        adAccountId,
      });
      return NextResponse.json(
        { ok: false, error: "Facebook session expired. Reconnect in Settings." },
        { status: 503 },
      );
    }
    console.error("[internal venue-creatives] fetch failed", {
      clientId,
      eventCode: eventCodeRaw,
      adAccountId,
      error: msg,
    });
    return NextResponse.json(
      { ok: false, error: msg || "Creative breakdown unavailable" },
      { status: 502 },
    );
  }
}

function emptyMeta() {
  return {
    campaigns_total: 0,
    campaigns_failed: 0,
    ads_fetched: 0,
    dropped_no_creative: 0,
    truncated: false,
    unattributed: {
      ads_count: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      inline_link_clicks: 0,
      landingPageViews: 0,
      registrations: 0,
      purchases: 0,
    },
  };
}
