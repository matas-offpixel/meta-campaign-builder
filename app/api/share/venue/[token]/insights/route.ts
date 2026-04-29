import { NextResponse, type NextRequest } from "next/server";

import { resolveShareByToken } from "@/lib/db/report-shares";
import { getOwnerFacebookToken } from "@/lib/db/report-shares";
import { sumVenueTicketsSoldInWindow } from "@/lib/db/venue-insights";
import { fetchEventInsights } from "@/lib/insights/meta";
import {
  DATE_PRESETS,
  type CustomDateRange,
  type DatePreset,
} from "@/lib/insights/types";
import { createServiceRoleClient } from "@/lib/supabase/server";

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
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const sp = req.nextUrl.searchParams;
  const datePreset = parseDatePreset(sp.get("datePreset"));
  const customRange = parseCustomRange(
    datePreset,
    sp.get("since"),
    sp.get("until"),
  );
  const forceRefresh = sp.get("force") === "1" || sp.get("force") === "true";

  const admin = createServiceRoleClient();
  const resolved = await resolveShareByToken(token, admin);
  if (!resolved.ok || resolved.share.scope !== "venue") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const share = resolved.share;

  const { data: events, error: eventErr } = await admin
    .from("events")
    .select("id")
    .eq("client_id", share.client_id)
    .eq("event_code", share.event_code);
  if (eventErr) {
    return NextResponse.json({ error: eventErr.message }, { status: 500 });
  }
  const eventIds = (events ?? []).map((event) => event.id as string);
  if (eventIds.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: client, error: clientErr } = await admin
    .from("clients")
    .select("meta_ad_account_id")
    .eq("id", share.client_id)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json({ error: clientErr.message }, { status: 500 });
  }
  const adAccountId = (client?.meta_ad_account_id as string | null) ?? null;
  if (!adAccountId) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_ad_account",
        message: "Client has no Meta ad account linked.",
      },
    });
  }

  const ownerToken = await getOwnerFacebookToken(share.user_id, admin);
  if (!ownerToken) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_owner_token",
        message: "Owner has not connected Facebook (or token expired).",
      },
    });
  }

  if (forceRefresh) {
    console.log("[share-venue-insights] force-refresh", {
      token: token.slice(0, 6),
      eventCode: share.event_code,
      preset: datePreset,
    });
  }

  const result = await fetchEventInsights({
    eventCode: share.event_code,
    adAccountId,
    token: ownerToken,
    datePreset,
    customRange,
    ticketsInWindowResolver: (preset, range) =>
      sumVenueTicketsSoldInWindow(admin, eventIds, preset, range),
  });
  const headers = forceRefresh
    ? { "Cache-Control": "no-store, max-age=0" }
    : undefined;
  return NextResponse.json(result, { headers });
}
