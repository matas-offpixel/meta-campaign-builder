/**
 * lib/db/user-ad-account-list-cache.ts
 *
 * Last-known-good cache for `/api/meta/ad-accounts` (migration 153).
 * Service-role only — the table has RLS enabled with no client policies.
 */

import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";
import type { MetaAdAccount } from "@/lib/types";

export type CachedAdAccountList = {
  accounts: MetaAdAccount[];
  updatedAt: string;
};

function isMetaAdAccountArray(value: unknown): value is MetaAdAccount[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof (row as MetaAdAccount).id === "string" &&
      typeof (row as MetaAdAccount).name === "string",
  );
}

/** Read the user's cached list. Returns null on miss or soft failure. */
export async function readUserAdAccountListCache(
  userId: string,
): Promise<CachedAdAccountList | null> {
  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin
      .from("user_ad_account_list_cache")
      .select("accounts, updated_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.warn("[user-ad-account-list-cache] read failed:", error.message);
      return null;
    }
    if (!data) return null;

    const row = data as { accounts: unknown; updated_at: string };
    if (!isMetaAdAccountArray(row.accounts)) {
      console.warn(
        "[user-ad-account-list-cache] rejecting non-array / malformed accounts payload",
      );
      return null;
    }
    return { accounts: row.accounts, updatedAt: row.updated_at };
  } catch (err) {
    console.warn(
      "[user-ad-account-list-cache] read threw:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Upsert the user's last-known-good list. Fire-and-forget from the route —
 * never throw; log and return.
 */
export async function upsertUserAdAccountListCache(
  userId: string,
  accounts: MetaAdAccount[],
): Promise<void> {
  try {
    const admin = createServiceRoleClient();
    const { error } = await admin.from("user_ad_account_list_cache").upsert(
      {
        user_id: userId,
        accounts,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.warn("[user-ad-account-list-cache] upsert failed:", error.message);
    }
  } catch (err) {
    console.warn(
      "[user-ad-account-list-cache] upsert threw:",
      err instanceof Error ? err.message : err,
    );
  }
}
