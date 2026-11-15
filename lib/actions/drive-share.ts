"use server";

/**
 * lib/actions/drive-share.ts
 *
 * Server actions behind the Drive panel's Share with promoter (S25, HS17).
 * The caller must be signed in and own the event. The grant itself runs as
 * the export service account (lib/drive/share.ts). Never called
 * automatically — the panel calls shareEventFolder after its confirm.
 */

import { driveFromEnv } from "@/lib/drive/client";
import { shareEventFolder as share, stopSharingEventFolder as stop, type ShareResult } from "@/lib/drive/share";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

async function context(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in again to share this folder." };
  return { userId: user.id };
}

export async function shareEventFolder(input: { eventId: string; email: string }): Promise<ShareResult> {
  const who = await context();
  if ("error" in who) return { ok: false, error: who.error };
  const { drive } = driveFromEnv();
  if (!drive) return { ok: false, error: "The Drive export isn't set up on this deployment." };
  return share(createServiceRoleClient(), drive, { eventId: input.eventId, email: input.email, userId: who.userId });
}

export async function stopSharingEventFolder(input: { eventId: string }): Promise<ShareResult> {
  const who = await context();
  if ("error" in who) return { ok: false, error: who.error };
  const { drive } = driveFromEnv();
  if (!drive) return { ok: false, error: "The Drive export isn't set up on this deployment." };
  return stop(createServiceRoleClient(), drive, { eventId: input.eventId, userId: who.userId });
}
