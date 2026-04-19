import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * GET    /api/google-ads/plans/[planId]   read a single plan
 * PATCH  /api/google-ads/plans/[planId]   update editable plan fields
 * DELETE /api/google-ads/plans/[planId]   delete a plan
 *
 * RLS on google_ad_plans (migration 017) restricts every operation to
 * auth.uid() = user_id, so we don't need extra ownership checks here —
 * a cross-tenant attempt surfaces as a 0-row affected response.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
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

  const { data, error } = await supabase
    .from("google_ad_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Plan not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, plan: data }, { status: 200 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object." },
      { status: 400 },
    );
  }

  // Whitelist editable columns — we never let callers update id, user_id,
  // event_id, or the audit timestamps from outside.
  const allowed = [
    "google_ads_account_id",
    "total_budget",
    "google_budget",
    "google_budget_pct",
    "bidding_strategy",
    "target_cpa",
    "geo_targets",
    "rlsa_adjustments",
    "ad_scheduling",
    "campaigns",
    "status",
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in (body as Record<string, unknown>)) {
      patch[key] = (body as Record<string, unknown>)[key];
    }
  }

  const { data, error } = await supabase
    .from("google_ad_plans")
    .update(patch)
    .eq("id", planId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { ok: false, error: "Plan not found" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, plan: data }, { status: 200 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
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

  const { error } = await supabase
    .from("google_ad_plans")
    .delete()
    .eq("id", planId);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
