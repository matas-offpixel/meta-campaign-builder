import { NextRequest, NextResponse } from "next/server";

import {
  loadCreativeIntakeView,
  matchIntakeAssets,
  moveIntakeAsset,
  registerIntakeUpload,
  syncPlanCreativeIntake,
  unmatchIntakeGroup,
} from "@/lib/plan/creative-intake-server";
import { INTAKE_BUCKETS, type IntakeBucket } from "@/lib/plan/creative-intake";
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

function isBucket(value: unknown): value is IntakeBucket {
  return typeof value === "string" && (INTAKE_BUCKETS as readonly string[]).includes(value);
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
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  const plan = await loadOwnedPlan(supabase, id, user.id);
  if (!plan) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  const view = await loadCreativeIntakeView(supabase, plan);
  if (!view.ok) return NextResponse.json(view, { status: 500 });
  return NextResponse.json(view);
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
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  const plan = await loadOwnedPlan(supabase, id, user.id);
  if (!plan) return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "bad JSON" }, { status: 400 });
  }
  const action = body.action;

  if (action === "register") {
    const storagePath = typeof body.storagePath === "string" ? body.storagePath : "";
    const filename = typeof body.filename === "string" ? body.filename.trim() : "";
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const contentHash = typeof body.contentHash === "string" ? body.contentHash : "";
    const byteSize = typeof body.byteSize === "number" ? body.byteSize : -1;
    const mediaKind = body.mediaKind === "image" || body.mediaKind === "video" ? body.mediaKind : null;
    if (!/^(images|videos)\/[A-Za-z0-9._-]+$/.test(storagePath)) {
      return NextResponse.json({ ok: false, error: "storagePath must be images/ or videos/ in campaign-assets" }, { status: 400 });
    }
    if (!filename || !mediaKind || !/^[a-f0-9]{64}$/.test(contentHash) || byteSize < 0) {
      return NextResponse.json({ ok: false, error: "filename, mediaKind, contentHash and byteSize are required" }, { status: 400 });
    }
    const saved = await registerIntakeUpload(supabase, plan, {
      storagePath,
      filename,
      contentType,
      contentHash,
      byteSize,
      mediaKind,
      width: typeof body.width === "number" ? body.width : null,
      height: typeof body.height === "number" ? body.height : null,
      durationSeconds: typeof body.durationSeconds === "number" ? body.durationSeconds : null,
    });
    if (!saved.ok) return NextResponse.json(saved, { status: saved.status });
    const view = await loadCreativeIntakeView(supabase, plan);
    return NextResponse.json({ ...saved, view });
  }

  if (action === "override") {
    const assetId = typeof body.assetId === "string" ? body.assetId : "";
    if (!assetId || !isBucket(body.bucket)) {
      return NextResponse.json({ ok: false, error: "assetId and bucket are required" }, { status: 400 });
    }
    const saved = await moveIntakeAsset(supabase, plan, assetId, body.bucket);
    if (!saved.ok) return NextResponse.json(saved, { status: saved.status });
    return NextResponse.json({ ok: true, view: await loadCreativeIntakeView(supabase, plan) });
  }

  if (action === "match") {
    const assetIds = Array.isArray(body.assetIds) ? body.assetIds.filter((id): id is string => typeof id === "string") : [];
    const saved = await matchIntakeAssets(supabase, plan, assetIds);
    if (!saved.ok) return NextResponse.json(saved, { status: saved.status });
    return NextResponse.json({ ok: true, groupId: saved.groupId, view: await loadCreativeIntakeView(supabase, plan) });
  }

  if (action === "unmatch") {
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (!groupId) return NextResponse.json({ ok: false, error: "groupId is required" }, { status: 400 });
    const saved = await unmatchIntakeGroup(supabase, plan, groupId);
    if (!saved.ok) return NextResponse.json(saved, { status: saved.status });
    return NextResponse.json({ ok: true, notes: saved.notes, view: await loadCreativeIntakeView(supabase, plan) });
  }

  if (action === "send") {
    const saved = await syncPlanCreativeIntake(supabase, plan);
    if (!saved.ok) return NextResponse.json(saved, { status: saved.status });
    return NextResponse.json({ ok: true, notes: saved.notes, changed: saved.changed, view: await loadCreativeIntakeView(supabase, plan) });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
