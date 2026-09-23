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
  setGoogleSearchSitelinkResource,
} from "@/lib/db/google-search-plans";
import {
  hasHardErrors,
  validateGoogleSearchPlan,
} from "@/lib/google-search/validation";
import { evaluatePushGuard } from "@/lib/google-search/push-guard";
import {
  pushGoogleSearchPlan,
  type GoogleSearchPushPersister,
} from "@/lib/google-ads/campaign-writer";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import {
  formatGoogleSearchStartBlocks,
  googleSearchLiveStartBlocks,
  parseGoogleSearchConfirmStart,
  parseGoogleSearchLaunchPaused,
} from "@/lib/google-ads/push-status";

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
 *
 * Body: `{ force?: boolean, launchPaused?: boolean, confirmStart?: boolean }`.
 * `launchPaused` defaults to live. A present non-boolean is 400 and
 * writes nothing — it is never coerced. The route refuses to re-push
 * a plan that's already been pushed (status='pushed' OR any row
 * carries a `pushed_resource_name`) unless `force: true` is sent.
 * A live campaign with a past or missing start is 422 unless
 * `confirmStart: true`. Review's hard errors, including a missing
 * RSA final URL, still 422 before any Google call.
 */
export async function POST(
  req: NextRequest,
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

  const body = (await req.json().catch(() => ({}))) as {
    force?: boolean;
    launchPaused?: unknown;
    confirmStart?: unknown;
  } | null;
  const force = body?.force === true;
  // Parsed before the plan is loaded. An unparseable value returns 400
  // and never reaches Google.
  const launchPaused = parseGoogleSearchLaunchPaused(body?.launchPaused);
  if (!launchPaused.ok) {
    return NextResponse.json(
      { ok: false, reason: "invalid_launch_paused", details: launchPaused.error },
      { status: 400 },
    );
  }
  const confirmStart = parseGoogleSearchConfirmStart(body?.confirmStart);
  if (!confirmStart.ok) {
    return NextResponse.json(
      { ok: false, reason: "invalid_confirm_start", details: confirmStart.error },
      { status: 400 },
    );
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

  if (!confirmStart.value) {
    const startBlocks = googleSearchLiveStartBlocks({
      campaigns: tree.campaigns,
      dateRange: tree.plan.date_range,
      launchPaused: launchPaused.value,
    });
    if (startBlocks.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          reason: "start_date_blocked",
          details: formatGoogleSearchStartBlocks(startBlocks),
        },
        { status: 422 },
      );
    }
  }

  if (!tree.plan.google_ads_account_id) {
    return NextResponse.json(
      { ok: false, reason: "no_google_ads_account_linked" },
      { status: 422 },
    );
  }

  // ── Re-push guard (defence in depth) ────────────────────────────────
  // Per-row idempotency in the adapter is the primary defence; this
  // guard makes a double-click / stale-tab re-launch require an
  // explicit `force: true` so the operator confirms they meant it.
  const guard = evaluatePushGuard(
    { planStatus: tree.plan.status, campaigns: tree.campaigns },
    force,
  );
  if (guard.refuse) {
    return NextResponse.json(
      {
        ok: false,
        reason: "already_pushed",
        details: guard.message,
        pushedCampaignCount: guard.pushedCampaignCount,
        planStatus: tree.plan.status,
      },
      { status: 409 },
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
    setSitelinkResource: (sitelinkId, resourceName) =>
      setGoogleSearchSitelinkResource(supabase, sitelinkId, resourceName),
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
      launchPaused: launchPaused.value,
      confirmStart: confirmStart.value,
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
