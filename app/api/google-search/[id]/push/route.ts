import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  loadGoogleSearchPlanTree,
  setGoogleSearchAdGroupResource,
  setGoogleSearchCampaignResource,
  setGoogleSearchKeywordResource,
  setGoogleSearchNegativeResource,
  setGoogleSearchPlanStatus,
  setGoogleSearchRsaResource,
} from "@/lib/db/google-search-plans";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
} from "@/lib/google-search/validation";
import {
  pushGoogleSearchPlan,
  type GoogleSearchPushPersister,
} from "@/lib/google-ads/campaign-writer";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";

// Sequential mutate chain across many campaigns can run minutes —
// match the other ads-platform routes that talk to Google Ads.
export const maxDuration = 300;

/**
 * POST /api/google-search/[id]/push
 *
 * Phase 3 implementation. Loads the plan tree, validates, decrypts
 * the Google Ads credentials for `plan.google_ads_account_id`,
 * resolves the linked event's `event_code` for the campaign-name
 * prefix, then runs `pushGoogleSearchPlan`. Returns a
 * `GoogleSearchLaunchSummary` that the wizard's Push step renders.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  let tree;
  try {
    tree = await loadGoogleSearchPlanTree(supabase, id);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "load_failed",
        details: err instanceof Error ? err.message : "Failed to load plan",
      },
      { status: 500 },
    );
  }
  if (!tree) {
    return NextResponse.json({ ok: false, reason: "plan_not_found" }, { status: 404 });
  }

  const issues = validateGoogleSearchPlan(tree);
  if (hasHardErrors(issues)) {
    return NextResponse.json(
      {
        ok: false,
        reason: "validation_failed",
        details: issues
          .filter((i) => i.severity === "error")
          .map((i) => `• ${i.message}`)
          .join("\n"),
      },
      { status: 422 },
    );
  }

  if (!tree.plan.google_ads_account_id) {
    return NextResponse.json(
      { ok: false, reason: "no_google_ads_account_linked" },
      { status: 422 },
    );
  }

  // Decrypt credentials for the linked account. Cast to `never` because
  // the cookie-bound Supabase client isn't typed against the new
  // tables — same pattern as the Phase 1 CRUD module.
  let credentials;
  try {
    credentials = await getGoogleAdsCredentials(
      supabase as never,
      tree.plan.google_ads_account_id,
    );
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "credentials_load_failed",
        details: err instanceof Error ? err.message : "Failed to decrypt Google Ads credentials.",
      },
      { status: 500 },
    );
  }
  if (!credentials) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no_credentials_for_account",
        details:
          "The linked Google Ads account has no decrypted credentials. Reconnect via Settings → Connections.",
      },
      { status: 422 },
    );
  }

  // Resolve event_code for the campaign-name prefix. Missing event is
  // not fatal — the writer logs a warning instead.
  let eventCode: string | null = null;
  if (tree.plan.event_id) {
    const { data: eventRow } = await supabase
      .from("events")
      .select("event_code")
      .eq("id", tree.plan.event_id)
      .eq("user_id", user.id)
      .maybeSingle();
    eventCode = (eventRow as { event_code?: string | null } | null)?.event_code ?? null;
  }

  const persister: GoogleSearchPushPersister = {
    setCampaignResource: (campaignId, resourceName) =>
      setGoogleSearchCampaignResource(supabase, campaignId, resourceName),
    setAdGroupResource: (adGroupId, resourceName) =>
      setGoogleSearchAdGroupResource(supabase, adGroupId, resourceName),
    setKeywordResource: (keywordId, resourceName) =>
      setGoogleSearchKeywordResource(supabase, keywordId, resourceName),
    setNegativeResource: (negativeId, resourceName) =>
      setGoogleSearchNegativeResource(supabase, negativeId, resourceName),
    setRsaResource: (rsaId, resourceName) =>
      setGoogleSearchRsaResource(supabase, rsaId, resourceName),
    setPlanStatus: (planId, status, pushedAt) =>
      setGoogleSearchPlanStatus(supabase, planId, status, pushedAt),
  };

  try {
    const summary = await pushGoogleSearchPlan({
      tree,
      credentials: {
        customerId: credentials.customer_id,
        refreshToken: credentials.refresh_token,
        loginCustomerId: credentials.login_customer_id,
      },
      eventCode,
      persister,
    });
    return NextResponse.json(summary, { status: summary.ok ? 200 : 207 });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "writer_threw",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
