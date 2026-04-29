import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getEventByIdServer } from "@/lib/db/events-server";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import { fetchEventCampaignInsights } from "@/lib/reporting/event-insights";
import type { GoogleAdsInsightsResult } from "@/lib/types/google-ads";

/**
 * GET /api/google-ads/insights?planId=…
 *
 * Returns Google Ads insights for the given plan, matching campaigns to the
 * plan's event by case-insensitive event_code substring.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) {
    return NextResponse.json(
      { ok: false, error: "Missing planId query param" },
      { status: 400 },
    );
  }

  const { data: plan, error: planError } = await supabase
    .from("google_ad_plans")
    .select("id, event_id, google_ads_account_id")
    .eq("id", planId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (planError) {
    return NextResponse.json(
      { ok: false, error: { reason: "google_ads_api_error", message: planError.message } },
      { status: 500 },
    );
  }
  if (!plan) {
    return NextResponse.json(
      { ok: false, error: { reason: "no_account", message: "Google Ads plan not found" } },
      { status: 404 },
    );
  }

  const event = await getEventByIdServer(plan.event_id);
  const eventCode = event?.event_code?.trim() ?? "";
  if (!event || !eventCode) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_campaigns_matched",
        message: "This event has no event_code to match Google Ads campaigns.",
      },
    } satisfies GoogleAdsInsightsResult);
  }

  const accountId =
    plan.google_ads_account_id ??
    event.google_ads_account_id ??
    event.client?.google_ads_account_id ??
    null;
  if (!accountId) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_account",
        message: "No Google Ads account is linked to this plan, event, or client.",
      },
    } satisfies GoogleAdsInsightsResult);
  }

  const { data: account, error: accountError } = await supabase
    .from("google_ads_accounts")
    .select("id, google_customer_id, login_customer_id")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (accountError) {
    return NextResponse.json(
      { ok: false, error: { reason: "google_ads_api_error", message: accountError.message } },
      { status: 500 },
    );
  }
  if (!account) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_account",
        message: "Linked Google Ads account was not found.",
      },
    } satisfies GoogleAdsInsightsResult);
  }
  if (!account.google_customer_id) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_customer_id",
        message: "Linked Google Ads account has no customer ID.",
      },
    } satisfies GoogleAdsInsightsResult);
  }

  let credentials;
  try {
    credentials = await getGoogleAdsCredentials(supabase, account.id);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          reason: "no_credentials",
          message: err instanceof Error ? err.message : "Google Ads credentials could not be decrypted.",
        },
      } satisfies GoogleAdsInsightsResult,
      { status: 502 },
    );
  }
  if (!credentials) {
    return NextResponse.json({
      ok: false,
      error: {
        reason: "no_credentials",
        message: "Google Ads account has not been connected with OAuth.",
      },
    } satisfies GoogleAdsInsightsResult);
  }

  const range = {
    since: parseDateParam(req.nextUrl.searchParams.get("since")) ??
      defaultSince(),
    until: parseDateParam(req.nextUrl.searchParams.get("until")) ??
      new Date().toISOString().slice(0, 10),
  };

  try {
    const campaigns = await fetchEventCampaignInsights({
      platform: "google",
      customerId: account.google_customer_id,
      refreshToken: credentials.refresh_token,
      loginCustomerId: account.login_customer_id ?? credentials.login_customer_id,
      eventCode,
      window: range,
    });
    if (campaigns.length === 0) {
      return NextResponse.json({
        ok: false,
        error: {
          reason: "no_campaigns_matched",
          message: `No Google Ads campaigns matched event_code ${eventCode}.`,
        },
      } satisfies GoogleAdsInsightsResult);
    }
    const payload = {
      fetchedAt: new Date().toISOString(),
      totals: toTotals(campaigns),
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        spend: campaign.spend,
        impressions: campaign.impressions,
        clicks: campaign.clicks,
        conversions: campaign.results,
        ctr: campaign.ctr,
        cpc: campaign.clicks > 0 ? campaign.spend / campaign.clicks : null,
        conversion_rate:
          campaign.clicks > 0 ? (campaign.results / campaign.clicks) * 100 : null,
        cost_per_conversion: campaign.cpr,
      })),
    };
    return NextResponse.json({ ok: true, data: payload } satisfies GoogleAdsInsightsResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[google-ads/insights] fetch failed:", message);
    return NextResponse.json(
      { ok: false, error: { reason: "google_ads_api_error", message } },
      { status: 502 },
    );
  }
}

function parseDateParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function defaultSince(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function toTotals(campaigns: Awaited<ReturnType<typeof fetchEventCampaignInsights>>) {
  const totals = campaigns.reduce(
    (acc, row) => {
      acc.spend += row.spend;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.conversions += row.results;
      return acc;
    },
    { spend: 0, impressions: 0, clicks: 0, conversions: 0 },
  );
  return {
    ...totals,
    ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
    cpc: totals.clicks > 0 ? totals.spend / totals.clicks : null,
    conversion_rate:
      totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : null,
    cost_per_conversion:
      totals.conversions > 0 ? totals.spend / totals.conversions : null,
  };
}
