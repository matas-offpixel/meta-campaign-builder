import { NextRequest, NextResponse } from "next/server";

import { upsertTikTokDraft } from "@/lib/db/tiktok-drafts";
import { loadPlanLaunchRecords } from "@/lib/plan/load";
import {
  rowToCampaignPlanIntent,
  upsertCampaignPlan,
  upsertPlanLaunchRow,
} from "@/lib/plan/persist";
import {
  GOOGLE_PREPARE_REASON,
  buildPrefillMetaDraft,
  buildPrefillTikTokDraft,
  resolvePreparedDraftId,
  wizardHrefForDraft,
  type PreparableAdapter,
} from "@/lib/plan/prepare-draft";
import { upsertLinkedMetaDraft } from "@/lib/plan/linked-drafts";
import type { CampaignPlan } from "@/lib/plan/types";
import { createClient } from "@/lib/supabase/server";

function isPreparable(value: unknown): value is PreparableAdapter {
  return value === "meta" || value === "tiktok";
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

  let adapter: unknown;
  let clientId: string | null = null;
  try {
    const body = (await req.json()) as { adapter?: unknown; clientId?: string | null };
    adapter = body.adapter;
    clientId = body.clientId ?? null;
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "bad JSON" },
      { status: 400 },
    );
  }

  if (adapter === "google") {
    return NextResponse.json(
      { ok: false, error: GOOGLE_PREPARE_REASON },
      { status: 400 },
    );
  }
  if (!isPreparable(adapter)) {
    return NextResponse.json({ ok: false, error: "adapter must be meta or tiktok" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("campaign_plans")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "Plan not found — save the plan before preparing a draft" },
      { status: 404 },
    );
  }

  const row = data as {
    id: string;
    user_id: string;
    name: string | null;
    status: CampaignPlan["status"];
    created_at: string;
    updated_at: string;
  } & Parameters<typeof rowToCampaignPlanIntent>[0];

  const launches = await loadPlanLaunchRecords(supabase, row.id);
  const plan: CampaignPlan = {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    status: row.status,
    intent: rowToCampaignPlanIntent(row),
    launches,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  const existing = launches[adapter].draftId;
  if (existing) {
    return NextResponse.json({
      ok: true,
      reused: true,
      adapter,
      draftId: existing,
      href: wizardHrefForDraft(adapter, existing),
      launches,
    });
  }

  if (adapter === "meta") {
    const draft = buildPrefillMetaDraft(plan, clientId);
    const saved = await upsertLinkedMetaDraft(supabase, draft, user.id);
    if (!saved.ok) {
      return NextResponse.json({ ok: false, error: saved.error }, { status: 500 });
    }
    const resolved = resolvePreparedDraftId(null, draft.id);
    const record = {
      ...launches.meta,
      draftId: resolved.draftId,
    };
    const launchWrite = await upsertPlanLaunchRow(supabase, {
      planId: plan.id,
      userId: user.id,
      adapter: "meta",
      record,
    });
    if (!launchWrite.ok) {
      return NextResponse.json({ ok: false, error: launchWrite.error }, { status: 500 });
    }
    launches.meta = record;
    return NextResponse.json({
      ok: true,
      reused: false,
      adapter,
      draftId: resolved.draftId,
      href: wizardHrefForDraft("meta", resolved.draftId),
      launches,
    });
  }

  const draft = buildPrefillTikTokDraft(plan, clientId);
  const saved = await upsertTikTokDraft(supabase as never, draft.id, {
    ...draft,
    userId: user.id,
  });
  const resolved = resolvePreparedDraftId(null, saved.id);
  const record = {
    ...launches.tiktok,
    draftId: resolved.draftId,
  };
  const launchWrite = await upsertPlanLaunchRow(supabase, {
    planId: plan.id,
    userId: user.id,
    adapter: "tiktok",
    record,
  });
  if (!launchWrite.ok) {
    return NextResponse.json({ ok: false, error: launchWrite.error }, { status: 500 });
  }
  launches.tiktok = record;
  await upsertCampaignPlan(supabase, plan);
  return NextResponse.json({
    ok: true,
    reused: false,
    adapter,
    draftId: resolved.draftId,
    href: wizardHrefForDraft("tiktok", resolved.draftId),
    launches,
  });
}
