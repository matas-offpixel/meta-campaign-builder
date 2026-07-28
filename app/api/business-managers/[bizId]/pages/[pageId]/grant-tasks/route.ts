import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantPageTasksForBusinessManager } from "@/lib/bm/grant-page-tasks";
import { validatePageTasks } from "@/lib/bm/page-tasks";
import { describeTaskGrantResult, isTaskGrantSuccess } from "@/lib/bm/types";

/**
 * POST /api/business-managers/[bizId]/pages/[pageId]/grant-tasks
 * Body: { tasks: string[] }
 *
 * Single-page task grant (the per-row grant button), additive over whatever the
 * operator already holds and verified by read-back before stored state changes.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bizId: string; pageId: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { bizId, pageId } = await params;
  const bm = await getBusinessManagerByBizId(auth.supabase, bizId);
  if (!bm) {
    return NextResponse.json({ ok: false, error: "Business Manager not found" }, { status: 404 });
  }

  const tasks = await readTasks(req);
  const validation = validatePageTasks(tasks);
  if (!validation.ok) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 });
  }

  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Service client unavailable" }, { status: 500 });
  }

  const result = await grantPageTasksForBusinessManager(service, bm, {
    tasks,
    pageIds: [pageId],
    actorUserId: user.id,
  });

  const ok = isTaskGrantSuccess(result);
  return NextResponse.json({
    ok,
    error: ok ? undefined : describeTaskGrantResult(result),
    result,
  });
}

async function readTasks(req: NextRequest): Promise<string[]> {
  try {
    const body = (await req.json()) as { tasks?: unknown };
    if (!Array.isArray(body.tasks)) return [];
    return body.tasks.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}
