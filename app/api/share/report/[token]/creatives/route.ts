import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  getOwnerFacebookToken,
  resolveShareByToken,
} from "@/lib/db/report-shares";
import { fetchEventCreatives } from "@/lib/insights/meta";
import {
  CREATIVE_SORT_KEYS,
  type CreativeSortKey,
} from "@/lib/insights/types";

/**
 * Public GET — lazy-loaded creative previews for the report share.
 *
 * Validates the token via the service-role client (no user session
 * required), looks up the event + owner Facebook token, then hits the
 * Meta Graph for ad creative previews + per-ad insights.
 *
 * Cached for 5 minutes per token via the segment-level `revalidate`
 * export. Lazy invocation is also gated behind a button in the UI so a
 * cold view of the report doesn't trigger this expensive call at all.
 */

export const revalidate = 300;
export const dynamic = "force-dynamic";

function parseSort(value: string | null): CreativeSortKey {
  if (value && (CREATIVE_SORT_KEYS as readonly string[]).includes(value)) {
    return value as CreativeSortKey;
  }
  return "lpv";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length > 64) {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  // Service-role client used only for the share lookup + token + event
  // reads. Reused across the resolveShare + getOwnerToken + event reads
  // so we open a single Supabase connection per request.
  const admin = createServiceRoleClient();

  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok) {
    // Generic 404 — never leak whether the token ever existed.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { event_id, user_id } = resolved.share;

  const [eventRes, providerToken] = await Promise.all([
    admin
      .from("events")
      .select("event_code, client:clients ( meta_ad_account_id )")
      .eq("id", event_id)
      .maybeSingle(),
    getOwnerFacebookToken(user_id, admin),
  ]);

  if (eventRes.error || !eventRes.data) {
    console.error(
      "[share/creatives] event lookup failed:",
      eventRes.error?.message ?? "no row",
    );
    return NextResponse.json(
      { error: "Report temporarily unavailable" },
      { status: 503 },
    );
  }

  const eventCode = eventRes.data.event_code as string | null;
  // Supabase typing surfaces the joined client as a possibly-array shape
  // depending on cardinality inference — narrow defensively.
  const clientRel = eventRes.data.client as
    | { meta_ad_account_id: string | null }
    | { meta_ad_account_id: string | null }[]
    | null;
  const adAccountId = Array.isArray(clientRel)
    ? (clientRel[0]?.meta_ad_account_id ?? null)
    : (clientRel?.meta_ad_account_id ?? null);

  if (!eventCode || !adAccountId) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          reason: !eventCode ? "no_event_code" : "no_ad_account",
          message: !eventCode
            ? "Event has no event_code set."
            : "Client has no Meta ad account linked.",
        },
      },
      { status: 200 },
    );
  }

  if (!providerToken) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          reason: "no_owner_token",
          message: "Owner Facebook token unavailable or expired.",
        },
      },
      { status: 200 },
    );
  }

  const sortBy = parseSort(req.nextUrl.searchParams.get("sortBy"));
  const result = await fetchEventCreatives({
    eventCode,
    adAccountId,
    token: providerToken,
    sortBy,
  });

  // Always 200 — failure modes carry { ok: false, error } so the lazy
  // client can render an inline error without a thrown fetch.
  return NextResponse.json(result, { status: 200 });
}
