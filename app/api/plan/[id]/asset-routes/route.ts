import { NextRequest, NextResponse } from "next/server";

import { canRouteAssetToTikTok, TIKTOK_IMAGE_UNSUPPORTED_REASON } from "@/lib/plan/asset-routing";
import { loadPlanAssetRoutes, upsertPlanAssetRoute } from "@/lib/plan/asset-routing-db";
import { resolveLinkedRegistryAssets, tikTokLaunchIsLive } from "@/lib/plan/asset-routing-execute";
import { loadPlanRoutingMatrix } from "@/lib/plan/asset-routing-load";
import { runPlanTikTokAssetFanout } from "@/lib/plan/asset-routing-server";
import { loadLinkedDraftsForPlan } from "@/lib/plan/linked-drafts";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import { rowToCampaignPlanIntent } from "@/lib/plan/persist";
import type { CampaignPlan } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";

async function loadOwnedPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string,
): Promise<CampaignPlan | null> {
  const { data, error } = await supabase
    .from("campaign_plans")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as {
    id: string;
    user_id: string;
    name: string | null;
    status: CampaignPlan["status"];
    created_at: string;
    updated_at: string;
  } & Parameters<typeof rowToCampaignPlanIntent>[0];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    intent: rowToCampaignPlanIntent(row),
    launches: await loadPlanLaunchRecords(supabase, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const plan = await loadOwnedPlan(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }
  const matrix = await loadPlanRoutingMatrix(supabase, plan);
  return NextResponse.json({
    ok: true,
    rows: matrix.rows,
    note: matrix.note,
    tableMissing: matrix.tableMissing,
    launched: tikTokLaunchIsLive({
      planStatus: plan.launches.tiktok.status,
      publishedIds: null,
    }),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const plan = await loadOwnedPlan(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  let assetId = "";
  let enabled = false;
  try {
    const body = (await req.json()) as { assetId?: string; enabled?: boolean };
    assetId = body.assetId?.trim() ?? "";
    enabled = body.enabled === true;
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }
  if (!assetId) {
    return NextResponse.json({ ok: false, error: "assetId is required" }, { status: 400 });
  }

  const drafts = await loadLinkedDraftsForPlan(supabase, plan);
  const { assets } = await resolveLinkedRegistryAssets(supabase, user.id, drafts.meta);
  const asset = assets.find((row) => row.id === assetId);
  if (!asset) {
    return NextResponse.json({ ok: false, error: "Asset is not on this plan's Meta draft" }, { status: 404 });
  }
  if (enabled && !canRouteAssetToTikTok(asset)) {
    return NextResponse.json(
      { ok: false, error: TIKTOK_IMAGE_UNSUPPORTED_REASON },
      { status: 400 },
    );
  }

  const saved = await loadPlanAssetRoutes(supabase, plan.id, user.id);
  const current = saved.ok ? saved.routes.find((row) => row.assetId === assetId) : null;
  const write = await upsertPlanAssetRoute(supabase, {
    planId: plan.id,
    assetId,
    userId: user.id,
    channel: "tiktok",
    enabled,
    uploadStatus: current?.uploadStatus ?? "idle",
    uploadError: enabled ? null : current?.uploadError ?? null,
    derivedCreativeId: current?.derivedCreativeId ?? null,
  });
  if (!write.ok) {
    return NextResponse.json(
      { ok: false, error: write.error, tableMissing: write.tableMissing },
      { status: write.tableMissing ? 503 : 500 },
    );
  }

  if (drafts.tiktok) {
    await runPlanTikTokAssetFanout({
      supabase,
      plan,
      metaDraft: drafts.meta,
      tiktokDraft: drafts.tiktok,
    });
  }

  const matrix = await loadPlanRoutingMatrix(supabase, plan);
  return NextResponse.json({ ok: true, rows: matrix.rows, note: matrix.note });
}

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
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const plan = await loadOwnedPlan(supabase, id, user.id);
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }
  let assetId = "";
  try {
    const body = (await req.json()) as { assetId?: string };
    assetId = body.assetId?.trim() ?? "";
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }
  if (!assetId) {
    return NextResponse.json({ ok: false, error: "assetId is required" }, { status: 400 });
  }
  const saved = await loadPlanAssetRoutes(supabase, plan.id, user.id);
  const current = saved.ok ? saved.routes.find((row) => row.assetId === assetId) : null;
  await upsertPlanAssetRoute(supabase, {
    planId: plan.id,
    assetId,
    userId: user.id,
    channel: "tiktok",
    enabled: true,
    uploadStatus: "idle",
    uploadError: null,
    derivedCreativeId: current?.derivedCreativeId ?? null,
  });
  const drafts = await loadLinkedDraftsForPlan(supabase, plan);
  if (drafts.tiktok) {
    await runPlanTikTokAssetFanout({
      supabase,
      plan,
      metaDraft: drafts.meta,
      tiktokDraft: drafts.tiktok,
    });
  }
  const matrix = await loadPlanRoutingMatrix(supabase, plan);
  return NextResponse.json({ ok: true, rows: matrix.rows, note: matrix.note });
}
