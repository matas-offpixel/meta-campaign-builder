import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { fetchEventCreatives } from "@/lib/insights/meta";
import {
  CREATIVE_SORT_KEYS,
  DATE_PRESETS,
  type CreativeSortKey,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";

/**
 * Authenticated GET — lazy creative previews for an event the current
 * user owns. Mirror of the public share-side creatives route, but
 * gated by an authed Supabase session + RLS-scoped event ownership
 * check (no token resolution needed — the session IS the credential).
 *
 * Lives under `app/api/insights/*` (not `app/api/meta/*`) so the existing
 * Meta route prefix stays frozen during Meta app review.
 *
 * Cached for 5 minutes per (eventId, sortBy, datePreset). `force-dynamic`
 * is intentionally NOT set so the 5-minute window actually takes effect
 * — a flick of the timeframe selector buys a per-preset cache bucket
 * instead of always round-tripping to Meta.
 */

export const revalidate = 300;

function parseSort(value: string | null): CreativeSortKey {
  if (value && (CREATIVE_SORT_KEYS as readonly string[]).includes(value)) {
    return value as CreativeSortKey;
  }
  return "lpv";
}

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
  // client.meta_ad_account_id needed downstream. RLS would already
  // filter by user_id, but the explicit `.eq("user_id", user.id)` keeps
  // the intent obvious to a future reader auditing the route.
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

  const sp = req.nextUrl.searchParams;
  const sortBy = parseSort(sp.get("sortBy"));
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );
  const result = await fetchEventCreatives({
    eventCode,
    adAccountId,
    token,
    sortBy,
    datePreset,
    customRange,
  });
  return NextResponse.json(result, { status: 200 });
}
