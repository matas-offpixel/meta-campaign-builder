import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * GET  /api/google-ads/plans?eventId=…   list plans for an event
 * POST /api/google-ads/plans              create a plan
 *
 * Plans live in google_ad_plans (migration 017). This route keeps the
 * shape narrow to what the plan-builder UI needs — full payload
 * validation lands when launch is wired (the types in
 * lib/types/google-ads.ts already describe the canonical shape).
 */

interface CreatePlanInput {
  event_id: string;
  google_ads_account_id?: string | null;
  total_budget?: number | null;
  google_budget?: number | null;
  google_budget_pct?: number | null;
  bidding_strategy?: string | null;
  target_cpa?: number | null;
  geo_targets?: unknown;
  rlsa_adjustments?: unknown;
  ad_scheduling?: unknown;
  campaigns?: unknown;
}

function isCreatePlanInput(value: unknown): value is CreatePlanInput {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.event_id === "string";
}

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

  const eventId = req.nextUrl.searchParams.get("eventId");
  let query = supabase
    .from("google_ad_plans" as never)
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (eventId) {
    query = query.eq("event_id", eventId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[google-ads/plans GET] read failed:", error.message);
    return NextResponse.json(
      { ok: true, plans: [] as unknown[] },
      { status: 200 },
    );
  }

  return NextResponse.json(
    { ok: true, plans: data ?? [] },
    { status: 200 },
  );
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!isCreatePlanInput(body)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing required field: event_id (string).",
      },
      { status: 400 },
    );
  }

  const payload = {
    user_id: user.id,
    event_id: body.event_id,
    google_ads_account_id: body.google_ads_account_id ?? null,
    total_budget: body.total_budget ?? null,
    google_budget: body.google_budget ?? null,
    google_budget_pct: body.google_budget_pct ?? null,
    bidding_strategy: body.bidding_strategy ?? null,
    target_cpa: body.target_cpa ?? null,
    geo_targets: body.geo_targets ?? [],
    rlsa_adjustments: body.rlsa_adjustments ?? {},
    ad_scheduling: body.ad_scheduling ?? {},
    campaigns: body.campaigns ?? [],
    status: "draft",
  };

  const { data, error } = await supabase
    .from("google_ad_plans" as never)
    .insert(payload as never)
    .select("*")
    .single();

  if (error) {
    console.warn("[google-ads/plans POST] insert failed:", error.message);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, plan: data }, { status: 200 });
}
