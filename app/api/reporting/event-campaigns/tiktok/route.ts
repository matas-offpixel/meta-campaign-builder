import { NextResponse, type NextRequest } from "next/server";

import { getEventByIdServer } from "@/lib/db/events-server";
import { createClient } from "@/lib/supabase/server";
import { getTikTokCredentials } from "@/lib/tiktok/credentials";
import { TikTokApiError } from "@/lib/tiktok/client";
import { fetchTikTokEventCampaignInsights } from "@/lib/tiktok/insights";

function parseDateParam(value: string | null): string | null {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function resolveWindow(
  since: string | null,
  until: string | null,
  rangeKey: string | null,
): { since: string; until: string } {
  if (since && until) return { since, until };
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const days =
    rangeKey === "yesterday"
      ? 1
      : rangeKey === "3d"
        ? 3
        : rangeKey === "7d"
          ? 7
          : rangeKey === "14d"
            ? 14
            : rangeKey === "all"
              ? 365 * 5
              : 30;
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const end =
    rangeKey === "yesterday"
      ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : today;
  return { since: start, until: end };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, reason: "not_signed_in", error: "Not signed in" },
      { status: 401 },
    );
  }

  const eventId = req.nextUrl.searchParams.get("eventId")?.trim() ?? "";
  if (!eventId) {
    return NextResponse.json(
      { ok: false, reason: "bad_request", error: "eventId is required" },
      { status: 400 },
    );
  }

  const event = await getEventByIdServer(eventId);
  if (!event) {
    return NextResponse.json(
      { ok: false, reason: "event_not_found", error: "Event not found" },
      { status: 404 },
    );
  }

  const eventCode = event.event_code?.trim() ?? "";
  const accountId =
    event.tiktok_account_id ?? event.client?.tiktok_account_id ?? null;
  if (!eventCode) {
    return NextResponse.json({
      ok: true,
      reason: "no_event_code",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: null,
      ad_account_id: null,
      window: null,
    });
  }
  if (!accountId) {
    return NextResponse.json({
      ok: true,
      reason: "no_tiktok_account",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: null,
      window: null,
    });
  }

  const { data: account, error: accountError } = await supabase
    .from("tiktok_accounts")
    .select("id, tiktok_advertiser_id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (accountError) {
    return NextResponse.json(
      { ok: false, reason: "tiktok_account_failed", error: accountError.message },
      { status: 500 },
    );
  }
  if (!account) {
    return NextResponse.json(
      { ok: false, reason: "tiktok_account_not_found", error: "TikTok account not found" },
      { status: 404 },
    );
  }
  if (!account.tiktok_advertiser_id) {
    return NextResponse.json({
      ok: true,
      reason: "no_advertiser_id",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: null,
      window: null,
    });
  }

  const range = req.nextUrl.searchParams.get("range");
  const sinceParam = parseDateParam(req.nextUrl.searchParams.get("since"));
  const untilParam = parseDateParam(req.nextUrl.searchParams.get("until"));
  const window = resolveWindow(sinceParam, untilParam, range);

  let credentials;
  try {
    credentials = await getTikTokCredentials(supabase, account.id);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "tiktok_credentials_failed",
        error: err instanceof Error ? err.message : "TikTok credentials failed",
      },
      { status: 502 },
    );
  }
  if (!credentials) {
    return NextResponse.json({
      ok: true,
      reason: "no_access_token",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: account.tiktok_advertiser_id,
      window,
    });
  }

  try {
    const campaigns = await fetchTikTokEventCampaignInsights({
      advertiserId: account.tiktok_advertiser_id,
      token: credentials.access_token,
      eventCode,
      window,
    });
    return NextResponse.json({
      ok: true,
      campaigns,
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: account.tiktok_advertiser_id,
      window,
    });
  } catch (err) {
    const msg =
      err instanceof TikTokApiError
        ? `${err.message}${err.requestId ? ` (request ${err.requestId})` : ""}`
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[reporting/event-campaigns/tiktok] insights failed:", msg);
    return NextResponse.json(
      { ok: false, reason: "tiktok_insights_failed", error: msg },
      { status: 502 },
    );
  }
}

function nullBenchmarks(): {
  ctr: null;
  cpm: null;
  cpr: null;
  campaignsCounted: 0;
} {
  return {
    ctr: null,
    cpm: null,
    cpr: null,
    campaignsCounted: 0,
  };
}
