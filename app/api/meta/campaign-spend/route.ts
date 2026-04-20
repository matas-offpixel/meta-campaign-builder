import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

/**
 * POST /api/meta/campaign-spend
 *
 * Refresh the cached lifetime Meta spend for an event_code by summing
 * across every campaign in the ad account whose name contains that code,
 * then propagating the total to every event row owned by the caller
 * with a matching event_code.
 *
 * Why event_code (not a single campaign id):
 *   - Multiple campaigns can target the same venue/show (e.g. a
 *     pre-reg run + a general-sale run, or DPA reactivation pushed
 *     into its own campaign). The portal needs the *combined* spend.
 *   - The admin already names campaigns with the bracketed code in
 *     Ads Manager, so substring matching is the source of truth that
 *     never needs to be kept in sync with a manual ID input.
 *
 * Body:
 *   { event_code: string, ad_account_id: string }
 *
 * Response:
 *   200 { ok, spend, event_code, campaigns_matched, events_updated, refreshed_at }
 *   400 { ok: false, error }   — missing or empty fields
 *   401 { ok: false, error }   — not signed in
 *   502 { ok: false, error }   — Meta API or token failure
 *   500 { ok: false, error }   — Supabase write failure
 */

interface PostBody {
  event_code?: unknown;
  ad_account_id?: unknown;
}

interface InsightsRow {
  spend?: string;
  campaign_name?: string;
  campaign_id?: string;
}

interface InsightsResponse {
  data?: InsightsRow[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
}

/**
 * Hard cap on pagination so a runaway account doesn't pin the request.
 * Each insights page can hold up to 500 rows; 20 pages = 10k campaigns,
 * which is well past any sane account size.
 */
const MAX_INSIGHT_PAGES = 20;

export async function POST(req: NextRequest) {
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const eventCode =
    typeof body.event_code === "string" ? body.event_code.trim() : "";
  const adAccountIdRaw =
    typeof body.ad_account_id === "string" ? body.ad_account_id.trim() : "";
  if (!eventCode) {
    return NextResponse.json(
      { ok: false, error: "event_code is required" },
      { status: 400 },
    );
  }
  if (!adAccountIdRaw) {
    return NextResponse.json(
      { ok: false, error: "ad_account_id is required" },
      { status: 400 },
    );
  }

  // Normalise to the `act_`-prefixed form. Every Graph helper in
  // lib/meta/client.ts (fetchPixels, fetchCampaignsForAccount, etc.)
  // expects the prefix and the docstrings call it out explicitly. The
  // /api/meta/campaigns route hard-rejects when the prefix is missing;
  // here we auto-prefix instead so a single mis-saved client record
  // doesn't poison the bulk-refresh batch with a cryptic 400. Without
  // the prefix Meta resolves the bare numeric as some other object the
  // token can see and reports `(#100) Tried accessing nonexisting
  // field (insights)` because /insights isn't a valid edge on that
  // object.
  const adAccountId = adAccountIdRaw.startsWith("act_")
    ? adAccountIdRaw
    : `act_${adAccountIdRaw}`;

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "No Meta token available";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  // Account-level lifetime insights at campaign level. We page through
  // results because large accounts return more than the default 25
  // campaigns per page and we don't want to silently miss any spend.
  const eventCodeLower = eventCode.toLowerCase();
  let totalSpend = 0;
  let campaignsMatched = 0;
  let after: string | undefined;
  let pageCount = 0;

  try {
    while (pageCount < MAX_INSIGHT_PAGES) {
      const params: Record<string, string> = {
        fields: "spend,campaign_name,campaign_id",
        date_preset: "lifetime",
        level: "campaign",
        limit: "500",
      };
      if (after) params.after = after;

      const res = await graphGetWithToken<InsightsResponse>(
        `/${adAccountId}/insights`,
        params,
        token,
      );

      for (const row of res.data ?? []) {
        const name = row.campaign_name ?? "";
        if (!name.toLowerCase().includes(eventCodeLower)) continue;
        const parsed = Number.parseFloat(row.spend ?? "");
        if (Number.isFinite(parsed)) {
          totalSpend += parsed;
          campaignsMatched += 1;
        }
      }

      pageCount += 1;
      const nextCursor = res.paging?.cursors?.after;
      const hasMore = Boolean(res.paging?.next && nextCursor);
      if (!hasMore) break;
      after = nextCursor;
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(err.toJSON(), { status: 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/meta/campaign-spend] insights fetch failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  if (pageCount >= MAX_INSIGHT_PAGES) {
    console.warn(
      `[/api/meta/campaign-spend] hit MAX_INSIGHT_PAGES=${MAX_INSIGHT_PAGES} for account ${adAccountId} — totals may be partial.`,
    );
  }

  // Round to two decimals — Meta returns spend as a free-form string,
  // and float summation will leak fractional pennies that look untidy
  // in the cached column without changing any downstream maths.
  const spend = Math.round(totalSpend * 100) / 100;

  // Fan the value out to every event row the caller owns that shares
  // the same event_code. Empty result is fine — the admin may set
  // event_code on events later.
  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("events")
    .update({
      meta_spend_cached: spend,
      meta_spend_cached_at: nowIso,
    })
    .eq("user_id", user.id)
    .eq("event_code", eventCode)
    .select("id");

  if (updateErr) {
    console.error(
      "[/api/meta/campaign-spend] update failed:",
      updateErr.message,
    );
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    event_code: eventCode,
    spend,
    campaigns_matched: campaignsMatched,
    events_updated: updated?.length ?? 0,
    refreshed_at: nowIso,
  });
}
