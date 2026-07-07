"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isD2CApprover } from "@/lib/auth/operator-allowlist";
import { generateD2CShareToken } from "@/lib/d2c/share-token";
import { buildD2CShareUrl } from "@/lib/d2c/dashboard-view";
import {
  getActiveShareForEvent,
  insertShare,
  revokeShare as revokeShareRow,
} from "@/lib/db/d2c-shares";

/**
 * lib/actions/d2c-share.ts
 *
 * Server actions backing the operator dashboard share panel. Both actions are
 * gated: the caller must be the event owner OR a D2C approver. Writes go
 * through the service-role client so an approver can share/revoke an event
 * owned by another operator.
 */

export interface ShareActionResult {
  ok: boolean;
  url?: string;
  error?: string;
}

async function resolveOrigin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return host ? `${proto}://${host}` : "";
}

/**
 * Authorise the acting user for an event: owner OR approver. Returns the
 * user id when allowed, or null.
 */
async function authorizeForEvent(
  admin: ReturnType<typeof createServiceRoleClient>,
  eventId: string,
): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (isD2CApprover(user.id)) return user.id;

  const { data } = await admin
    .from("events")
    .select("user_id")
    .eq("id", eventId)
    .maybeSingle();
  const ownerId = (data?.user_id as string | null) ?? null;
  return ownerId && ownerId === user.id ? user.id : null;
}

export async function createShare(eventId: string): Promise<ShareActionResult> {
  if (!eventId) return { ok: false, error: "Missing event id" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }

  const userId = await authorizeForEvent(admin, eventId);
  if (!userId) return { ok: false, error: "Not authorized" };

  // Idempotent: reuse an existing active share rather than minting duplicates.
  const existing = await getActiveShareForEvent(admin, eventId);
  const origin = await resolveOrigin();
  if (existing) {
    revalidatePath(`/d2c/event/${eventId}`);
    return { ok: true, url: buildD2CShareUrl(origin, existing.token) };
  }

  const token = generateD2CShareToken();
  const row = await insertShare(admin, { userId, eventId, token });
  if (!row) return { ok: false, error: "Could not create share link" };

  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true, url: buildD2CShareUrl(origin, row.token) };
}

export async function revokeShare(
  shareId: string,
  eventId: string,
): Promise<ShareActionResult> {
  if (!shareId) return { ok: false, error: "Missing share id" };
  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch {
    return { ok: false, error: "Server misconfigured" };
  }

  const userId = await authorizeForEvent(admin, eventId);
  if (!userId) return { ok: false, error: "Not authorized" };

  const ok = await revokeShareRow(admin, shareId);
  if (!ok) return { ok: false, error: "Could not revoke share link" };
  revalidatePath(`/d2c/event/${eventId}`);
  return { ok: true };
}
