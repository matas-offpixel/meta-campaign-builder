import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getMetaUserId,
  grantUserPagePermission,
  resolveBusinessScopedUserId,
} from "@/lib/meta/business-manager";
import {
  getBusinessManagerToken,
  getBMPages,
  logAccessEvent,
  markBusinessManagerTokenExpired,
  setPageAccessFlag,
} from "@/lib/db/business-managers";
import { isTokenExpiredMetaError } from "@/lib/bm/sync";
import { DEFAULT_GRANT_ROLE, type BusinessManager, type GrantResult } from "@/lib/bm/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/** Rate-limit guard: max grants per batch and pause between batches. */
const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Grant the operator ADVERTISER access on the given pages within a BM.
 *
 * Batching: 50 grants per batch, 2s sleep between batches, to stay well under
 * Meta's page/business request budget. Each successful grant flips the page's
 * `user_has_access` flag and writes a `granted` audit event. A Meta subcode-190
 * (invalid token) failure aborts the run, flags the BM token as expired, and
 * returns `tokenExpired: true` so the UI can prompt a reconnect.
 *
 * @param pageIds  When omitted, grants on ALL currently-missing pages.
 */
export async function grantPagesForBusinessManager(
  supabase: AnySupabaseClient,
  bm: BusinessManager,
  opts: { pageIds?: string[]; actorUserId: string | null },
): Promise<GrantResult> {
  const bizId = bm.business_id;
  const result: GrantResult = {
    businessId: bizId,
    attempted: 0,
    granted: 0,
    failed: 0,
    batches: 0,
    failures: [],
  };

  // Resolve which pages to grant on.
  let pageIds = opts.pageIds ?? null;
  if (!pageIds) {
    const pages = await getBMPages(supabase, bizId);
    pageIds = pages.filter((p) => !p.user_has_access).map((p) => p.page_id);
  }
  if (pageIds.length === 0) return result;

  const token = await getBusinessManagerToken(supabase, bm.id);
  if (!token) {
    result.tokenExpired = true;
    result.failures.push({ pageId: "-", error: "no_token_stored" });
    return result;
  }

  // fbUserId is Matas's Facebook-level id (audit/debug cross-reference
  // only). targetUserId is the BUSINESS-SCOPED id `assigned_users` actually
  // requires — resolved once here, reused for every page in this BM below
  // (resolveBusinessScopedUserId also caches per-bizId in-process).
  let fbUserId: string;
  let targetUserId: string;
  try {
    fbUserId = await getMetaUserId(token);
    targetUserId = await resolveBusinessScopedUserId(bizId, token);
  } catch (err) {
    if (isTokenExpiredMetaError(err)) {
      await markBusinessManagerTokenExpired(supabase, bizId, "token_expired");
      result.tokenExpired = true;
    }
    const msg = err instanceof Error ? err.message : String(err);
    result.failures.push({ pageId: "-", error: msg });
    return result;
  }

  for (let i = 0; i < pageIds.length; i += BATCH_SIZE) {
    const batch = pageIds.slice(i, i + BATCH_SIZE);
    result.batches += 1;

    for (const pageId of batch) {
      result.attempted += 1;
      try {
        await grantUserPagePermission(bizId, pageId, targetUserId, DEFAULT_GRANT_ROLE, token);
        result.granted += 1;
        await setPageAccessFlag(supabase, bizId, pageId, true);
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId,
          userId: opts.actorUserId,
          action: "granted",
          detail: {
            role: DEFAULT_GRANT_ROLE,
            target_user_id: targetUserId,
            fb_user_id: fbUserId,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.failed += 1;
        result.failures.push({ pageId, error: msg });
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId,
          userId: opts.actorUserId,
          action: "sync_error",
          detail: { phase: "grant", message: msg },
        });
        // Invalid token — no point continuing; flag + abort.
        if (isTokenExpiredMetaError(err)) {
          await markBusinessManagerTokenExpired(supabase, bizId, msg);
          result.tokenExpired = true;
          return result;
        }
      }
    }

    // Pause between batches (skip the pause after the final batch).
    if (i + BATCH_SIZE < pageIds.length) {
      await sleep(BATCH_SLEEP_MS);
    }
  }

  return result;
}
