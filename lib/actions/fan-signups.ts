"use server";

import { revalidatePath } from "next/cache";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * lib/actions/fan-signups.ts — fan-table mutations (OP909 Phase 5).
 * Scope contract as everywhere: requireClientContext() first, then the
 * write is pinned to that client_id — a forged signup id belonging to
 * another tenant matches zero rows.
 */

/**
 * Soft-delete one signup (sets deleted_at; the row stays for audit and
 * the dedupe indexes keep working). Repeat/attribution rows pointing at
 * it are left untouched — they carry no PII.
 */
export async function softDeleteFanSignup(formData: FormData): Promise<void> {
  const membership = await requireClientContext();
  const signupId = String(formData.get("signup_id") ?? "");
  if (!signupId) return;

  const db = createServiceRoleClient();
  const { error } = await db
    .from("event_signups")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", signupId)
    .eq("client_id", membership.clientId)
    .is("deleted_at", null);
  if (error) {
    throw new Error(`[admin-fans] soft delete failed: ${error.message}`);
  }
  revalidatePath(`/admin/${membership.clientSlug}/fans`);
}
