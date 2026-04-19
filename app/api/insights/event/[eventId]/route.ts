import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchEventInsights } from "@/lib/insights/meta";

/**
 * Authenticated insights for an event the current user owns.
 *
 * Lives under `app/api/insights/*` (not `app/api/meta/*`) so the existing
 * Meta route prefix stays frozen during Meta app review. Same data shape
 * the public share route renders — used by the future internal Reporting
 * tab without a refactor.
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await params;

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

  const result = await fetchEventInsights({
    eventCode,
    adAccountId,
    token,
  });
  return NextResponse.json(result, { status: 200 });
}
