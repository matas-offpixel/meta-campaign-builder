import { NextResponse, type NextRequest } from "next/server";

import { sumVenueTicketsSoldInWindow } from "@/lib/db/venue-insights";
import { fetchEventInsights } from "@/lib/insights/meta";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";

export const revalidate = 300;

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
  const eventCode = decodeURIComponent(event_code ?? "").trim();
  const sp = req.nextUrl.searchParams;
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );
  const forceRefresh = sp.get("force") === "1" || sp.get("force") === "true";

  if (!clientId || !eventCode) {
    return NextResponse.json(
      { error: "Invalid venue insights scope" },
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

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id, meta_ad_account_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !client) {
    return NextResponse.json(
      { error: clientErr?.message ?? "Client not found" },
      { status: 404 },
    );
  }
  if (client.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const eventQuery = supabase
    .from("events")
    .select("id")
    .eq("client_id", clientId)
    .eq("event_code", eventCode);
  const eventDate = sp.get("event_date");
  if (eventDate) eventQuery.eq("event_date", eventDate);
  const { data: events, error: eventErr } = await eventQuery;
  if (eventErr) {
    return NextResponse.json({ error: eventErr.message }, { status: 500 });
  }
  const eventIds = (events ?? []).map((event) => event.id as string);
  if (eventIds.length === 0) {
    return NextResponse.json(
      { error: "Event code not found under this client" },
      { status: 404 },
    );
  }

  const adAccountId = client.meta_ad_account_id as string | null;
  if (!adAccountId) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_ad_account",
        message: "Client has no Meta ad account linked.",
      },
    });
  }

  let token: string;
  try {
    token = (await resolveServerMetaToken(supabase, user.id)).token;
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_owner_token",
        message: err instanceof Error ? err.message : "No Meta token",
      },
    });
  }

  if (forceRefresh) {
    console.log("[venue-insights] force-refresh", {
      clientId: clientId.slice(0, 8),
      eventCode,
      preset: datePreset,
    });
  }

  const result = await fetchEventInsights({
    eventCode,
    adAccountId,
    token,
    datePreset,
    customRange,
    ticketsInWindowResolver: (preset, range) =>
      sumVenueTicketsSoldInWindow(supabase, eventIds, preset, range),
  });
  const headers = forceRefresh
    ? { "Cache-Control": "no-store, max-age=0" }
    : undefined;
  return NextResponse.json(result, { headers });
}
