import { NextResponse, type NextRequest } from "next/server";

import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { updateScheduledSendStatus } from "@/lib/db/d2c";

/**
 * PATCH /api/d2c/scheduled/[id]/approve
 * Sets approval_status=approved for pending rows (operator allowlist only).
 * Uses the service role for the write so an approver can act on another
 * operator's scheduled rows without RLS blocking the update.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Send id is required" },
      { status: 400 },
    );
  }

  const supabaseUser = await createClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  if (!isD2CApprover(user.id)) {
    return NextResponse.json(
      { ok: false, error: "Not authorized to approve D2C sends." },
      { status: 403 },
    );
  }

  let supabaseAdmin: ReturnType<typeof createServiceRoleClient>;
  try {
    supabaseAdmin = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 },
    );
  }

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("d2c_scheduled_sends")
    .select("id, approval_status, status")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json(
      { ok: false, error: "Scheduled send not found" },
      { status: 404 },
    );
  }

  if (row.status !== "scheduled") {
    return NextResponse.json(
      { ok: false, error: "Only scheduled sends can be approved." },
      { status: 400 },
    );
  }
  if (row.approval_status !== "pending_approval") {
    return NextResponse.json(
      { ok: false, error: "Send is not pending approval." },
      { status: 400 },
    );
  }

  const approvedAt = new Date().toISOString();
  const updated = await updateScheduledSendStatus(supabaseAdmin, id, {
    approvalStatus: "approved",
    approvedBy: user.id,
    approvedAt,
  });

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: "Failed to update send" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, send: updated });
}
