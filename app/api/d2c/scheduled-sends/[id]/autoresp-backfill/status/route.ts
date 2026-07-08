import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { getScheduledSendById } from "@/lib/db/d2c";
import { readBackfillState } from "@/lib/d2c/autoresp/backfill";
import { getAutorespFiresForSend } from "@/lib/db/d2c-autoresp";

export const dynamic = "force-dynamic";

/**
 * GET /api/d2c/scheduled-sends/[id]/autoresp-backfill/status
 *
 * Operator-only progress read for the backfill UI (event owner or approver).
 * Returns the backfill state + the live fire summary so the progress bar can
 * reflect real deduped fires.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: sendId } = await params;

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return NextResponse.json({ ok: false, error: "Server misconfigured" }, { status: 500 });
  }

  const send = await getScheduledSendById(admin, sendId);
  if (!send) return NextResponse.json({ ok: false, error: "Send not found" }, { status: 404 });

  const { data: ev } = await admin
    .from("events")
    .select("user_id")
    .eq("id", send.event_id)
    .maybeSingle();
  const ownerId = (ev as { user_id?: string } | null)?.user_id ?? null;
  if (ownerId !== user.id && !isD2CApprover(user.id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const state = readBackfillState(send.result_jsonb);
  const fires = await getAutorespFiresForSend(admin, sendId, { recentLimit: 5 });
  return NextResponse.json({ ok: true, state, fires: { total: fires.total, email: fires.email, whatsapp: fires.whatsapp, dryRun: fires.dryRun } });
}
