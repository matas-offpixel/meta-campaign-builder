"use server";

import { revalidatePath } from "next/cache";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { getScheduledSendById, updateScheduledSendStatus } from "@/lib/db/d2c";
import { mergeAutorespResultJsonb } from "@/lib/d2c/autoresp/helpers";

/**
 * lib/actions/d2c-sends.ts
 *
 * Approver-only mutations on scheduled sends, backing the operator dashboard
 * action buttons. All writes use the service-role client (an approver acts on
 * sends owned by another operator, which RLS would otherwise block) and are
 * gated by the D2C approver allowlist. The public share view never imports
 * these — it renders read-only.
 */

export interface SendActionResult {
  ok: boolean;
  error?: string;
}

async function requireApprover(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isD2CApprover(user.id)) return null;
  return user.id;
}

export async function approveSend(
  sendId: string,
  eventId: string,
): Promise<SendActionResult> {
  const userId = await requireApprover();
  if (!userId) return { ok: false, error: "Not authorized" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }
  const updated = await updateScheduledSendStatus(admin, sendId, {
    approvalStatus: "approved",
    approvedBy: userId,
    approvedAt: new Date().toISOString(),
  });
  if (!updated) return { ok: false, error: "Could not approve send" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}

export async function rejectSend(
  sendId: string,
  eventId: string,
): Promise<SendActionResult> {
  const userId = await requireApprover();
  if (!userId) return { ok: false, error: "Not authorized" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }
  const updated = await updateScheduledSendStatus(admin, sendId, {
    approvalStatus: "rejected",
    approvedBy: userId,
    approvedAt: new Date().toISOString(),
  });
  if (!updated) return { ok: false, error: "Could not reject send" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}

export async function cancelSend(
  sendId: string,
  eventId: string,
): Promise<SendActionResult> {
  const userId = await requireApprover();
  if (!userId) return { ok: false, error: "Not authorized" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }
  const updated = await updateScheduledSendStatus(admin, sendId, {
    status: "cancelled",
  });
  if (!updated) return { ok: false, error: "Could not cancel send" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}

/**
 * Arm the autoresponder on an `autoresp_setup` send (Goal 4). Flips
 * `result_jsonb.autoresp_config.enabled = true` (preserving every other key) and
 * marks the send approved.
 *
 * What "armed" means depends on the channel (2026-07-09 pivot, PR #704):
 *   - **Email:** Mailchimp delivers the autoresp via a Customer Journey
 *     (`tag-added` trigger) — our system never sends the email. Arming just
 *     gates the operator checklist in the dashboard ("confirm the Journey
 *     exists"); no send leaves here and the old per-fire campaign path is gone.
 *   - **WhatsApp:** unchanged — the Bird poll cron fires a single-recipient
 *     template message per new contact, deduped, under the 3-of-3 live gate.
 */
export async function armAutoresponder(
  sendId: string,
  eventId: string,
): Promise<SendActionResult> {
  const userId = await requireApprover();
  if (!userId) return { ok: false, error: "Not authorized" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }
  const send = await getScheduledSendById(admin, sendId);
  if (!send) return { ok: false, error: "Send not found" };
  if (send.job_type !== "autoresp_setup") {
    return { ok: false, error: "Not an autoresponder send" };
  }
  const resultJsonb = mergeAutorespResultJsonb(send.result_jsonb, {
    config: { enabled: true, armed_at: new Date().toISOString(), armed_by: userId },
  });
  const updated = await updateScheduledSendStatus(admin, sendId, {
    resultJsonb,
    approvalStatus: "approved",
    approvedBy: userId,
    approvedAt: new Date().toISOString(),
    status: "scheduled",
  });
  if (!updated) return { ok: false, error: "Could not arm autoresponder" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}

/**
 * Disarm an armed autoresponder. Flips `autoresp_config.enabled = false` and
 * preserves the fire history in d2c_autoresp_fires. For WhatsApp, new signups
 * stop firing. For email, this removes the dashboard checklist state — but note
 * the Mailchimp Customer Journey keeps sending until it's paused/turned off in
 * Mailchimp itself (disarming here does NOT touch the Journey — there's no
 * Journey pause API; PR #704).
 */
export async function disarmAutoresponder(
  sendId: string,
  eventId: string,
): Promise<SendActionResult> {
  const userId = await requireApprover();
  if (!userId) return { ok: false, error: "Not authorized" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }
  const send = await getScheduledSendById(admin, sendId);
  if (!send) return { ok: false, error: "Send not found" };
  const prev = (send.result_jsonb &&
  typeof send.result_jsonb === "object" &&
  "autoresp_config" in (send.result_jsonb as Record<string, unknown>)
    ? (send.result_jsonb as Record<string, unknown>).autoresp_config
    : null) as { armed_at?: string | null } | null;
  const resultJsonb = mergeAutorespResultJsonb(send.result_jsonb, {
    config: {
      enabled: false,
      armed_at: prev?.armed_at ?? null,
      armed_by: userId,
    },
  });
  const updated = await updateScheduledSendStatus(admin, sendId, {
    resultJsonb,
    approvalStatus: "rejected",
  });
  if (!updated) return { ok: false, error: "Could not disarm autoresponder" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}

export async function toggleDryRun(
  sendId: string,
  eventId: string,
  dryRun: boolean,
): Promise<SendActionResult> {
  const userId = await requireApprover();
  if (!userId) return { ok: false, error: "Not authorized" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }
  const updated = await updateScheduledSendStatus(admin, sendId, {
    dryRun,
  });
  if (!updated) return { ok: false, error: "Could not toggle dry-run" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}
