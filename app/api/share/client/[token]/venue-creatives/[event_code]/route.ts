import { NextResponse, type NextRequest } from "next/server";

import {
  getOwnerFacebookToken,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import {
  FacebookAuthExpiredError,
  FacebookRateLimitError,
  fetchActiveCreativesForEvent,
} from "@/lib/reporting/active-creatives-fetch";
import { groupByAssetSignature } from "@/lib/reporting/group-creatives";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * app/api/share/client/[token]/venue-creatives/[event_code]/route.ts
 *
 * Lazy-load endpoint for the per-venue active-creatives grid embedded
 * in each expanded card on the client portal (`/share/client/[token]`).
 *
 * The client portal shows 16+ venue cards for a wide client like
 * 4theFans. Fetching active creatives for every card up-front during
 * the server-side render would fan 16+ parallel Meta Graph calls out
 * of the share RSC and hammer the per-account rate budget — most cards
 * are collapsed on first paint anyway. So instead the venue card
 * calls this route when the operator expands it.
 *
 * Auth model: same as the rest of `/api/share/client/[token]/*` — the
 * token IS the credential, the share must be scope=client, and the
 * `event_code` must resolve to at least one event that belongs to
 * `share.client_id` (cross-tenant guard). Returns a 404-shape
 * `{ ok: false, error }` body for every failure branch so the client
 * component can render a muted "unavailable" note without having to
 * distinguish the exact reason.
 *
 * Output matches the existing `ShareActiveCreativesResult` shape used
 * on the per-event share page, minus the `kind: "ok"` discriminator —
 * this endpoint only returns 200 on happy-path data.
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
  }: { params: Promise<{ token: string; event_code: string }> },
) {
  const { token, event_code } = await params;
  const sp = req.nextUrl.searchParams;
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );
  const forceRefresh = sp.get("force") === "1" || sp.get("force") === "true";
  if (!token || token.length > 64) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }
  const eventCodeRaw = decodeURIComponent(event_code ?? "");
  if (!eventCodeRaw || eventCodeRaw.length > 128) {
    return NextResponse.json(
      { ok: false, error: "Invalid event_code" },
      { status: 400 },
    );
  }

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (
    !resolved.ok ||
    (resolved.share.scope !== "client" && resolved.share.scope !== "venue")
  ) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }
  const share = resolved.share;
  if (share.scope === "venue" && share.event_code !== eventCodeRaw) {
    return NextResponse.json(
      { ok: false, error: "Not found" },
      { status: 404 },
    );
  }
  if (!share.client_id) {
    return NextResponse.json(
      { ok: false, error: "Share missing client_id" },
      { status: 500 },
    );
  }

  // Cross-tenant guard: confirm at least one event with this
  // `event_code` belongs to the share's client. Without this a
  // malicious token holder could probe creatives from any client
  // sharing the same owner. `maybeSingle` keeps the round-trip cheap
  // — we only need existence.
  const { data: eventExists, error: eventErr } = await admin
    .from("events")
    .select("id")
    .eq("client_id", share.client_id)
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

  const { data: clientRow, error: clientErr } = await admin
    .from("clients")
    .select("meta_ad_account_id")
    .eq("id", share.client_id)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  const adAccountId = clientRow?.meta_ad_account_id ?? null;
  if (!adAccountId) {
    // Client has no Meta ad account configured — surfaced as "no data"
    // on the front end rather than a hard error.
    return NextResponse.json(
      { ok: true, groups: [], meta: emptyMeta() },
      responseOptions(forceRefresh),
    );
  }

  const ownerToken = await getOwnerFacebookToken(share.user_id, admin);
  if (!ownerToken) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Owner has not connected Facebook (or token expired). Ask your account manager to reconnect.",
      },
      { status: 503 },
    );
  }

  try {
    if (forceRefresh) {
      console.info("[venue-creatives] force-refresh", {
        token,
        eventCode: eventCodeRaw,
        datePreset,
      });
    }
    const result = await fetchActiveCreativesForEvent({
      adAccountId,
      eventCode: eventCodeRaw,
      token: ownerToken,
      datePreset,
      customRange,
      // Keep concurrency low — this route is hit once per expanded
      // card, and multiple cards may expand in quick succession on a
      // wide client like 4theFans. Two parallel cards at concurrency=3
      // would already fan six /ads requests; concurrency=1 keeps the
      // per-account rate budget predictable.
      concurrency: 1,
    });

    if (result.meta.campaigns_total === 0) {
      return NextResponse.json(
        { ok: true, groups: [], meta: emptyMeta() },
        responseOptions(forceRefresh),
      );
    }

    const allGroups = groupByAssetSignature(result.creatives);
    const groups = allGroups.slice(0, SHARE_GROUPS_CAP);

    return NextResponse.json(
      {
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
      },
      responseOptions(forceRefresh),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof FacebookRateLimitError) {
      console.warn("[venue-creatives] Meta rate limited", {
        token,
        eventCode: eventCodeRaw,
        adAccountId,
        metaCode: err.metaCode,
      });
      return NextResponse.json(
        {
          ok: false,
          error: `Meta rate limited (#${err.metaCode ?? "?"}) — retry in a few minutes.`,
        },
        { status: 429 },
      );
    }
    if (err instanceof FacebookAuthExpiredError) {
      console.error("[venue-creatives] owner FB token expired", {
        token,
        eventCode: eventCodeRaw,
        adAccountId,
      });
      return NextResponse.json(
        { ok: false, error: "Owner's Facebook session expired." },
        { status: 503 },
      );
    }
    console.error("[venue-creatives] fetch failed", {
      token,
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

function responseOptions(forceRefresh: boolean) {
  return forceRefresh
    ? { headers: { "Cache-Control": "no-store, max-age=0" } }
    : undefined;
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
