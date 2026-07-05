"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireClientContext } from "@/lib/auth/get-client-context";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * lib/actions/fan-signups.ts — fan-table mutations (OP909 Phase 5 + Sprint 2
 * PR 6). Scope contract as everywhere: requireClientContext() first, then the
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

  // Called from the detail view too — a redirect target sends the operator
  // back to the list after the row is gone. Optional (list-page form omits it).
  const redirectTo = String(formData.get("redirect_to") ?? "");
  if (redirectTo.startsWith(`/admin/${membership.clientSlug}/`)) {
    redirect(redirectTo);
  }
}

/**
 * Irreversibly anonymise one signup (OP909 PR 6, migration 140). Nulls every
 * identifiable field — encrypted email/phone blobs + their dedupe hashes,
 * social handles, user agent, referrer, and the utm attribution blob — and
 * stamps anonymized_at. The row is RETAINED for aggregate integrity (geo,
 * timestamps, event linkage) but is no longer contactable or identifiable.
 *
 * Nulling both contact blobs on a canonical row is only valid because
 * migration 140 relaxed event_signups_contactable_check to accept
 * `anonymized_at is not null`.
 */
export async function anonymizeFanSignup(formData: FormData): Promise<void> {
  const membership = await requireClientContext();
  const signupId = String(formData.get("signup_id") ?? "");
  if (!signupId) return;

  const now = new Date().toISOString();
  const db = createServiceRoleClient();
  const { error } = await db
    .from("event_signups")
    .update({
      email_encrypted: null,
      email_hash: null,
      phone_encrypted: null,
      phone_hash: null,
      phone_country_code: null,
      ig_handle: null,
      tt_handle: null,
      user_agent: null,
      referrer_url: null,
      utm: {},
      anonymized_at: now,
      // Anonymised rows are hidden from the list/exports like deleted ones.
      deleted_at: now,
    })
    .eq("id", signupId)
    .eq("client_id", membership.clientId)
    .is("anonymized_at", null);
  if (error) {
    throw new Error(`[admin-fans] anonymise failed: ${error.message}`);
  }
  revalidatePath(`/admin/${membership.clientSlug}/fans`);

  const redirectTo = String(formData.get("redirect_to") ?? "");
  if (redirectTo.startsWith(`/admin/${membership.clientSlug}/`)) {
    redirect(redirectTo);
  }
}
