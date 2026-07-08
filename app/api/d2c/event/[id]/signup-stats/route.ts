import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { getEventSignupStats } from "@/lib/d2c/stats";
import { loadD2CEventDashboard } from "@/lib/db/d2c-dashboard";

/**
 * GET /api/d2c/event/{id}/signup-stats
 *
 * Live signup-count poll target for the operator dashboard (Goal 8). Session
 * owner-or-approver only. Reuses the 60s-cached getEventSignupStats.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Event id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const data = await loadD2CEventDashboard(admin, id);
  if (!data) {
    return NextResponse.json({ ok: false, error: "Event not found" }, { status: 404 });
  }
  if (!isD2CApprover(user.id) && data.event.user_id !== user.id) {
    return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
  }

  try {
    const stats = await getEventSignupStats(admin, id);
    return NextResponse.json({ ok: true, stats });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Stats failed" },
      { status: 502 },
    );
  }
}
