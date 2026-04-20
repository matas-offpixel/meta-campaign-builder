import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

/**
 * POST /api/meta/campaign-spend
 *
 * Refresh the cached lifetime Meta campaign spend for an event's
 * meta_campaign_id, and propagate the result to every event row owned
 * by the caller that shares the same campaign id.
 *
 * Why this lives server-side:
 *   - The Meta token comes from `user_facebook_tokens` (or the env
 *     fallback), which never leaves the server.
 *   - The fan-out write touches multiple rows; doing it client-side
 *     would either need a service-role key or a custom Postgres function.
 *
 * Body:
 *   { campaign_id: string, ad_account_id: string }
 *
 * The `ad_account_id` isn't strictly needed for the Graph call (the
 * `/{campaign_id}/insights` endpoint scopes itself), but we accept it so
 * the admin UI can keep its existing prop wiring and so a future change
 * (e.g. validating the campaign actually lives in this account) lands
 * without an API contract break.
 *
 * Response:
 *   200 { ok: true, spend, campaign_id, events_updated }
 *   400 { ok: false, error }   — missing fields
 *   401 { ok: false, error }   — not signed in
 *   502 { ok: false, error }   — Meta API or token failure
 */

interface PostBody {
  campaign_id?: unknown;
  ad_account_id?: unknown;
}

interface InsightsResponse {
  data?: Array<{ spend?: string }>;
}

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

  const campaignId =
    typeof body.campaign_id === "string" ? body.campaign_id.trim() : "";
  const adAccountId =
    typeof body.ad_account_id === "string" ? body.ad_account_id.trim() : "";
  if (!campaignId) {
    return NextResponse.json(
      { ok: false, error: "campaign_id is required" },
      { status: 400 },
    );
  }
  if (!adAccountId) {
    return NextResponse.json(
      { ok: false, error: "ad_account_id is required" },
      { status: 400 },
    );
  }

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "No Meta token available";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  // Lifetime insights — Meta returns an empty `data` array when the
  // campaign has no spend yet; treat that as 0, not as failure, so the
  // admin can hit Refresh on a brand-new campaign without seeing red.
  let spend = 0;
  try {
    const res = await graphGetWithToken<InsightsResponse>(
      `/${campaignId}/insights`,
      { fields: "spend", date_preset: "lifetime" },
      token,
    );
    const raw = res.data?.[0]?.spend;
    if (raw !== undefined && raw !== null) {
      const parsed = Number.parseFloat(raw);
      if (Number.isFinite(parsed)) spend = parsed;
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(err.toJSON(), { status: 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/meta/campaign-spend] insights fetch failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateErr } = await supabase
    .from("events")
    .update({
      meta_spend_cached: spend,
      meta_spend_cached_at: nowIso,
    })
    .eq("user_id", user.id)
    .eq("meta_campaign_id", campaignId)
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
    campaign_id: campaignId,
    spend,
    events_updated: updated?.length ?? 0,
    refreshed_at: nowIso,
  });
}
