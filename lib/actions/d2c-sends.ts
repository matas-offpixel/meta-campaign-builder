"use server";

import { revalidatePath } from "next/cache";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { updateScheduledSendStatus } from "@/lib/db/d2c";

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
