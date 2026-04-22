import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchEventInsights } from "@/lib/insights/meta";
import { sumTicketsSoldInWindow } from "@/lib/db/event-daily-timeline";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";

/**
 * Authenticated insights for an event the current user owns.
 *
 * Lives under `app/api/insights/*` (not `app/api/meta/*`) so the existing
 * Meta route prefix stays frozen during Meta app review. Same data shape
 * the public share route renders — drives the internal Reporting mirror
 * (Slice U.1) directly via `<InternalEventReport>`.
 *
 * Cached for 5 minutes per (eventId, datePreset). `force-dynamic` was
 * dropped in U.1 so the 5-minute window actually takes effect.
 *
 * `?force=1` is a manual cache-bust signal (PR #57 #3): the operator
 * clicked Refresh on the live report footer because they just renamed
 * a creative in Ads Manager and don't want to wait for the 5-minute
 * TTL. The route is currently route-segment-cached (no DB cache
 * layer), so honoring the bust amounts to forwarding the signal as
 * a `Cache-Control: no-cache` response header + logging the bypass
 * for diagnostics. When a Supabase-backed read-through cache lands
 * here (mirroring `share_snapshots` on the public side), the same
 * param will skip the lookup and write a fresh entry — caller stays
 * the same.
 */

export const revalidate = 300;

function parseDatePreset(value: string | null): DatePreset {
  if (value === "custom") return "custom";
  if (value && (DATE_PRESETS as readonly string[]).includes(value)) {
    return value as DatePreset;
  }
  return "maximum";
}

/**
 * Build the customRange when the request asked for `?datePreset=custom`.
 * Shape-only narrowing — `fetchEventInsights` does the semantic
 * validation (since <= until, retention, etc) and returns a typed
 * `invalid_custom_range` error if anything is off.
 */
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
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const sp = req.nextUrl.searchParams;
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );
  // PR #57 #3 — manual cache-bust from the live report footer's
  // Refresh button. Logged for diagnostics so we can see in
  // production logs when ops is hammering the endpoint.
  const force = sp.get("force");
  const forceRefresh = force === "1" || force === "true";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Owner check via RLS-scoped read — also fetches the event_code +
  // client.meta_ad_account_id needed downstream.
  const { data: event, error: evErr } = await supabase
    .from("events")
    .select("id, event_code, client:clients ( meta_ad_account_id )")
    .eq("id", eventId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (evErr || !event) {
    return NextResponse.json(
      { error: "Event not found or not yours" },
      { status: 404 },
    );
  }

  const clientRel = event.client as
    | { meta_ad_account_id: string | null }
    | { meta_ad_account_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);
  const eventCode = event.event_code as string | null;

  if (!eventCode) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          reason: "no_event_code",
          message: "Event has no event_code set.",
        },
      },
      { status: 200 },
    );
  }
  if (!adAccountId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          reason: "no_ad_account",
          message: "Client has no Meta ad account linked.",
        },
      },
      { status: 200 },
    );
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          reason: "no_owner_token",
          message: err instanceof Error ? err.message : "No Meta token",
        },
      },
      { status: 200 },
    );
  }

  if (forceRefresh) {
    console.log("[insights] force-refresh", {
      eventId: eventId.slice(0, 8),
      preset: datePreset,
      userId: user.id.slice(0, 8),
    });
  }

  const result = await fetchEventInsights({
    eventCode,
    adAccountId,
    token,
    datePreset,
    customRange,
    ticketsInWindowResolver: (preset, range) =>
      sumTicketsSoldInWindow(supabase, eventId, preset, range),
  });
  // Forward the cache-bust as a no-cache response header so any
  // downstream HTTP layer (browser, CDN) treats this response as
  // single-use rather than rewarming its own cache.
  const headers = forceRefresh
    ? { "Cache-Control": "no-store, max-age=0" }
    : undefined;
  return NextResponse.json(result, { status: 200, headers });
}
