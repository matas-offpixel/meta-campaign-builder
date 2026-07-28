import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import { getBusinessManagerByBizId } from "@/lib/db/business-managers";
import { grantPageTasksForBusinessManager } from "@/lib/bm/grant-page-tasks";
import { validatePageTasks } from "@/lib/bm/page-tasks";
import { describeTaskGrantResult, isTaskGrantSuccess } from "@/lib/bm/types";

/**
 * POST /api/business-managers/[bizId]/pages/grant-tasks
 * Body: { tasks: string[] }
 *
 * Grants an explicit set of Meta page tasks to the operator on every page in
 * this BM that does not already hold them, then verifies by reading Meta back.
 *
 * Separate from `pages/grant-all` (which grants ADVERTISE through v1's
 * untouched code path) so that path's behaviour cannot regress. Tasks are
 * validated against the captured Graph v23.0 enum before any Graph call — see
 * lib/bm/page-tasks.ts for why that guard exists.
 */

export const dynamic = "force-dynamic";
// Same budget as pages/grant-all — 50-page batches with a 2s inter-batch pause
// and a 500ms per-request throttle, so a large BM can legitimately run long.
export const maxDuration = 800;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bizId: string }> },
) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { bizId } = await params;
  const bm = await getBusinessManagerByBizId(auth.supabase, bizId);
  if (!bm) {
    return NextResponse.json({ ok: false, error: "Business Manager not found" }, { status: 404 });
  }

  const tasks = await readTasks(req);
  // Rejected here as a 400, with the accepted enum in the message, rather than
  // as a run that fails 50 times over against Meta.
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
