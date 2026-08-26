import { NextRequest, NextResponse } from "next/server";

import {
  backfillHistoricalMetaAssets,
  collectBackfillCandidates,
  countUnregisteredMetaAssets,
  liveBackfillStorage,
} from "@/lib/plan/asset-backfill";
import { resolveLinkedRegistryAssets } from "@/lib/plan/asset-routing-execute";
import { loadLinkedMetaDraft, upsertLinkedMetaDraft } from "@/lib/plan/linked-drafts";
import { loadPlanForUser } from "@/lib/plan/load";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 120;

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
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan?.launches.meta.draftId) {
    return NextResponse.json({ ok: true, pending: 0, candidates: [] });
  }
  const draft = await loadLinkedMetaDraft(supabase, plan.launches.meta.draftId, user.id);
  const { refs } = await resolveLinkedRegistryAssets(supabase, user.id, draft);
  return NextResponse.json({
    ok: true,
    pending: countUnregisteredMetaAssets(refs),
    candidates: draft ? collectBackfillCandidates(draft).length : 0,
  });
}

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
    return NextResponse.json({ ok: false, error: "Unauthorised" }, { status: 401 });
  }
  const plan = await loadPlanForUser(supabase, id, user.id);
  if (!plan?.launches.meta.draftId) {
    return NextResponse.json({ ok: false, error: "No Meta draft to backfill" }, { status: 400 });
  }
  const draft = await loadLinkedMetaDraft(supabase, plan.launches.meta.draftId, user.id);
  if (!draft) {
    return NextResponse.json({ ok: false, error: "Linked Meta draft not found" }, { status: 404 });
  }

  const storage = liveBackfillStorage(createServiceRoleClient());
  const report = await backfillHistoricalMetaAssets({
    supabase,
    userId: user.id,
    draft,
    storage,
  });
  await upsertLinkedMetaDraft(supabase, report.draft, user.id);

  return NextResponse.json({
    ok: true,
    registered: report.registered,
    alreadyRegistered: report.alreadyRegistered,
    cannotRegister: report.cannotRegister,
    rows: report.rows,
  });
}
