import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { getScheduledSendById } from "@/lib/db/d2c";
import { refreshSendMetrics } from "@/lib/d2c/metrics/refresh";

/**
 * POST /api/d2c/scheduled-sends/{id}/metrics
 *
 * Manual "Refresh" button (Goal 4). Owner-or-approver only. Delegates to the
 * shared, 60s-rate-limited refreshSendMetrics so the button and the cron can't
 * hammer the provider. Returns the fresh metrics or a rate-limit notice.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ ok: false, error: "Send id is required" }, { status: 400 });
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

  const send = await getScheduledSendById(admin, id);
  if (!send) {
    return NextResponse.json({ ok: false, error: "Send not found" }, { status: 404 });
  }
  if (send.user_id !== user.id && !isD2CApprover(user.id)) {
    return NextResponse.json({ ok: false, error: "Not authorized" }, { status: 403 });
  }

  const result = await refreshSendMetrics(admin, id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, rateLimited: result.rateLimited ?? false },
      { status: result.rateLimited ? 429 : 502 },
    );
  }
  return NextResponse.json({ ok: true, metrics: result.metrics });
}
