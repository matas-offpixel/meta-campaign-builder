import { NextRequest, NextResponse } from "next/server";

import { loadGoogleSearchPlanTree } from "@/lib/db/google-search-plans";
import { googleLastDerivedAt } from "@/lib/plan/derive/google";
import { formatMetaStaleChip, isDerivedStale } from "@/lib/plan/live-mirror";
import { loadLinkedDraftsForPlan } from "@/lib/plan/linked-drafts";
import { loadPlanForUser } from "@/lib/plan/load";
import { createClient } from "@/lib/supabase/server";

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
  if (!plan) {
    return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 });
  }

  const linked = await loadLinkedDraftsForPlan(supabase, plan);
  const metaUpdatedAt = linked.meta?.updatedAt ?? null;
  const tiktokLastDerivedAt = linked.tiktok?.lastDerivedAt ?? null;
  let googleLast = null as string | null;
  if (plan.launches.google.draftId) {
    const tree = await loadGoogleSearchPlanTree(supabase, plan.launches.google.draftId);
    googleLast = tree ? googleLastDerivedAt(tree) : null;
  }

  const now = new Date();
  const tiktokChip = plan.launches.tiktok.draftId
    ? formatMetaStaleChip({ metaUpdatedAt, lastDerivedAt: tiktokLastDerivedAt, now })
    : null;
  const googleChip = plan.launches.google.draftId
    ? formatMetaStaleChip({ metaUpdatedAt, lastDerivedAt: googleLast, now })
    : null;

  return NextResponse.json({
    ok: true,
    metaUpdatedAt,
    tiktok: {
      lastDerivedAt: tiktokLastDerivedAt,
      stale: isDerivedStale(metaUpdatedAt, tiktokLastDerivedAt),
      chip: tiktokChip,
    },
    google: {
      lastDerivedAt: googleLast,
      stale: isDerivedStale(metaUpdatedAt, googleLast),
      chip: googleChip,
    },
  });
}
