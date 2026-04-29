import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { getEventByIdServer } from "@/lib/db/events-server";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import {
  computeBenchmarks,
  type AdAccountBenchmarks,
} from "@/lib/reporting/ad-account-benchmarks";
import {
  fetchEventCampaignInsights,
  normaliseAdAccountId,
} from "@/lib/reporting/event-insights";

/**
 * GET /api/reporting/event-campaigns?eventId=…&since=…&until=…&platform=meta
 *
 * Returns the live performance snapshot for every Meta campaign whose
 * name (case-insensitive) contains the event's `event_code`, plus the
 * ad account's rolling 90-day benchmark used by the UI to colour-code
 * each metric cell.
 *
 *   {
 *     ok: true,
 *     campaigns: [{ id, name, status, spend, impressions, clicks,
 *                   ctr, cpm, cpr, results, ad_account_id }],
 *     benchmarks: { ctr, cpm, cpr, campaignsCounted },
 *     event_code,
 *     ad_account_id,
 *     window: { since, until },
 *   }
 *
 * Failure modes (`ok: false`):
 *   - `not_signed_in`            — 401
 *   - `event_not_found`          — 404 (RLS-filtered miss; never leak)
 *   - `no_event_code`            — 200, empty campaigns, message in `reason`
 *   - `no_ad_account`            — 200, ditto, no client default ad account
 *   - `meta_token_failed`        — 502
 *   - `meta_insights_failed`     — 502
 */

function parseDateParam(
  value: string | null,
): string | null {
  if (!value) return null;
  // Accepts YYYY-MM-DD only — anything else is silently ignored so a
  // malformed querystring doesn't 400 the whole panel. Defensive
  // because the UI builds these client-side from a presets dropdown.
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
  const startMs = now.getTime() - days * 24 * 60 * 60 * 1000;
  const start = new Date(startMs).toISOString().slice(0, 10);
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
  const platform = req.nextUrl.searchParams.get("platform")?.trim() ?? "meta";
  if (platform === "google") {
    return getGoogleEventCampaigns({
      supabase,
      userId: user.id,
      event,
      eventCode,
      req,
    });
  }
  if (platform !== "meta") {
    return NextResponse.json(
      { ok: false, reason: "bad_request", error: `Unsupported platform: ${platform}` },
      { status: 400 },
    );
  }

  const adAccountIdRaw =
    (event.client?.meta_ad_account_id as string | null | undefined) ?? null;

  if (!eventCode) {
    return NextResponse.json({
      ok: true,
      reason: "no_event_code",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: null,
      ad_account_id: adAccountIdRaw,
      window: null,
    });
  }
  if (!adAccountIdRaw) {
    return NextResponse.json({
      ok: true,
      reason: "no_ad_account",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: null,
      window: null,
    });
  }

  const adAccountId = normaliseAdAccountId(adAccountIdRaw);

  const range = req.nextUrl.searchParams.get("range");
  const sinceParam = parseDateParam(req.nextUrl.searchParams.get("since"));
  const untilParam = parseDateParam(req.nextUrl.searchParams.get("until"));
  const window = resolveWindow(sinceParam, untilParam, range);

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "No Meta token available";
    return NextResponse.json(
      { ok: false, reason: "meta_token_failed", error: msg },
      { status: 502 },
    );
  }

  let campaigns;
  try {
    campaigns = await fetchEventCampaignInsights({
      adAccountId,
      eventCode,
      token,
      window,
    });
  } catch (err) {
    const msg =
      err instanceof MetaApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error("[reporting/event-campaigns] insights failed:", msg);
    return NextResponse.json(
      { ok: false, reason: "meta_insights_failed", error: msg },
      { status: 502 },
    );
  }

  // Benchmarks always run against the rolling 90-day window
  // regardless of the active time-range toggle so the colour-coding
  // baseline doesn't move under the user's feet when they switch
  // ranges.
  let benchmarks: AdAccountBenchmarks;
  try {
    benchmarks = await computeBenchmarks({
      adAccountId,
      token,
    });
  } catch (err) {
    console.warn(
      "[reporting/event-campaigns] benchmarks failed:",
      err instanceof Error ? err.message : String(err),
    );
    benchmarks = nullBenchmarks();
  }

  return NextResponse.json({
    ok: true,
    campaigns,
    benchmarks,
    event_code: eventCode,
    ad_account_id: adAccountId,
    window,
  });
}

function nullBenchmarks(): AdAccountBenchmarks {
  return { ctr: null, cpm: null, cpr: null, campaignsCounted: 0 };
}

async function getGoogleEventCampaigns(input: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  event: NonNullable<Awaited<ReturnType<typeof getEventByIdServer>>>;
  eventCode: string;
  req: NextRequest;
}) {
  const { supabase, userId, event, eventCode, req } = input;
  const accountId =
    event.google_ads_account_id ?? event.client?.google_ads_account_id ?? null;
  if (!eventCode) {
    return NextResponse.json({
      ok: true,
      reason: "no_event_code",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: null,
      ad_account_id: accountId,
      window: null,
    });
  }
  if (!accountId) {
    return NextResponse.json({
      ok: true,
      reason: "no_google_ads_account",
      campaigns: [],
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: null,
      window: null,
    });
  }

  const { data: account, error: accountError } = await supabase
    .from("google_ads_accounts")
    .select("id, google_customer_id, login_customer_id")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError) {
    return NextResponse.json(
      { ok: false, reason: "google_ads_account_failed", error: accountError.message },
      { status: 500 },
    );
  }
  if (!account?.google_customer_id) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no_google_ads_customer_id",
        error: "Linked Google Ads account has no customer ID.",
      },
      { status: 502 },
    );
  }

  const range = req.nextUrl.searchParams.get("range");
  const sinceParam = parseDateParam(req.nextUrl.searchParams.get("since"));
  const untilParam = parseDateParam(req.nextUrl.searchParams.get("until"));
  const window = resolveWindow(sinceParam, untilParam, range);

  let credentials;
  try {
    credentials = await getGoogleAdsCredentials(supabase, account.id);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "google_ads_credentials_failed",
        error: err instanceof Error ? err.message : "Google Ads credentials failed.",
      },
      { status: 502 },
    );
  }
  if (!credentials) {
    return NextResponse.json(
      {
        ok: false,
        reason: "google_ads_oauth_not_connected",
        error: "Google Ads OAuth is not connected for this client.",
      },
      { status: 502 },
    );
  }

  try {
    const campaigns = await fetchEventCampaignInsights({
      platform: "google",
      customerId: account.google_customer_id,
      refreshToken: credentials.refresh_token,
      loginCustomerId: account.login_customer_id ?? credentials.login_customer_id,
      eventCode,
      window,
    });
    return NextResponse.json({
      ok: true,
      campaigns,
      benchmarks: nullBenchmarks(),
      event_code: eventCode,
      ad_account_id: account.google_customer_id,
      window,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[reporting/event-campaigns] google insights failed:", msg);
    return NextResponse.json(
      { ok: false, reason: "google_ads_insights_failed", error: msg },
      { status: 502 },
    );
  }
}
