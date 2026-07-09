import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { getScheduledSendById, updateScheduledSendStatus } from "@/lib/db/d2c";
import { isAutorespArmed, mergeAutorespResultJsonb } from "@/lib/d2c/autoresp/helpers";
import { initialBackfillState, readBackfillState } from "@/lib/d2c/autoresp/backfill";

export const dynamic = "force-dynamic";

/**
 * POST /api/d2c/scheduled-sends/[id]/autoresp-backfill/start
 *
 * Operator-only (event owner or D2C approver). Seeds a resumable backfill that
 * fires the armed autoresponder for every EXISTING tagged member / list contact
 * (signups that pre-date arming). Actual work runs in chunks via
 * /api/cron/d2c-autoresp-backfill-tick. Idempotent: a still-running job is
 * returned as-is. NOT reachable from the public share view.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
  if (send.job_type !== "autoresp_setup") {
    return NextResponse.json({ ok: false, error: "Not an autoresponder send" }, { status: 400 });
  }

  // Email backfill is retired (2026-07-09 pivot, PR #704): the email autoresp
  // is a Mailchimp Customer Journey now, so firing per-member campaigns for
  // existing members would re-introduce campaigns-list pollution + double-send
  // against the Journey. To reach already-tagged members once, send a single
  // regular campaign to the tag segment in the Mailchimp UI. WhatsApp backfill
  // (Bird) is unaffected.
  if (send.channel === "email") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Email autoresponder is delivered by a Mailchimp Customer Journey. Backfill existing members with a one-time campaign to the tag segment in Mailchimp — not per-fire.",
      },
      { status: 400 },
    );
  }

  // Authorise: event owner OR D2C approver.
  const { data: ev } = await admin
    .from("events")
    .select("user_id")
    .eq("id", send.event_id)
    .maybeSingle();
  const ownerId = (ev as { user_id?: string } | null)?.user_id ?? null;
  if (ownerId !== user.id && !isD2CApprover(user.id)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  if (!isAutorespArmed(send.result_jsonb)) {
    return NextResponse.json(
      { ok: false, error: "Arm the autoresponder before backfilling." },
      { status: 400 },
    );
  }

  const existing = readBackfillState(send.result_jsonb);
  if (existing && (existing.status === "pending" || existing.status === "running")) {
    return NextResponse.json({ ok: true, state: existing, message: "Backfill already in progress" });
  }

  const nowIso = new Date().toISOString();
  const state = initialBackfillState(send.channel === "email" ? "mailchimp" : "bird", nowIso);
  const updated = await updateScheduledSendStatus(admin, sendId, {
    resultJsonb: mergeAutorespResultJsonb(send.result_jsonb, { backfill: state }),
  });
  if (!updated) return NextResponse.json({ ok: false, error: "Could not start backfill" }, { status: 500 });

  return NextResponse.json({ ok: true, state });
}
