import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchEventSpendByDay } from "@/lib/insights/meta";

/**
 * Per-day Meta spend for a plan window. Drives the plan tab's
 * actual-vs-planned column (V.3, internal-only).
 *
 * Auth + owner-check identical to the sibling /api/insights/event/
 * routes — RLS-bound read of the events row gates access. The route
 * is cached for 5 minutes per (eventId, since, until) tuple; the plan
 * UI rarely reaches across timezones during a session, so the cache
 * window matches the aggregate insights route on purpose.
 *
 * Both `since` and `until` are required — there is no preset bucket
 * here. Bad windows are surfaced as `invalid_custom_range` by the
 * underlying fetcher; missing params return a 400.
 */

export const revalidate = 300;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;
  const sp = req.nextUrl.searchParams;
  const since = sp.get("since");
  const until = sp.get("until");
  if (!since || !until) {
    return NextResponse.json(
      { error: "since and until query params are required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Same owner-check shape as /api/insights/event/[eventId]/route.ts —
  // RLS-scoped read returns the event_code + linked client's ad account.
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

  const result = await fetchEventSpendByDay({
    eventCode,
    adAccountId,
    token,
    since,
    until,
  });
  return NextResponse.json(result, { status: 200 });
}
