import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { MetaApiError } from "@/lib/meta/client";
import {
  listClientPages,
  listOwnedPages,
  listUserAccessiblePages,
  type MetaBMPage,
} from "@/lib/meta/business-manager";
import {
  getBusinessManagerToken,
  logAccessEvent,
  logAccessEventsBulk,
  markBusinessManagerTokenExpired,
  updateBusinessManagerScanState,
  upsertBMPages,
  type UpsertPageInput,
} from "@/lib/db/business-managers";
import type { BusinessManager, ScanResult } from "@/lib/bm/types";
import { chunk } from "@/lib/bm/chunk";

/**
 * Checkpoint boundary for the detected_new event-logging phase: after every
 * chunk of this many pages, bulk-insert their events in ONE round trip and
 * bump `last_scanned_at`. On a large BM (Columbo Group, ~1060 pages / 700+
 * newly-detected), this replaced 700+ sequential single-row inserts — the
 * actual cause of the 120s timeout, not the Meta API fetch — and means a
 * mid-loop timeout still leaves `last_scanned_at` reflecting real progress
 * instead of going silently stale (2026-07-09 scan-timeout fix).
 */
const DETECTED_NEW_CHECKPOINT_BOUNDARY = 100;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/**
 * A Meta error means the token is invalid/expired when either the top-level
 * code or the error_subcode is 190 (OAuthException). Handled specially so the
 * caller can flag `token_expired` and surface the reconnect banner.
 */
export function isTokenExpiredMetaError(err: unknown): boolean {
  return err instanceof MetaApiError && (err.code === 190 || err.subcode === 190);
}

function toUpsertInput(p: MetaBMPage, ownedByBm: boolean, accessible: Set<string>): UpsertPageInput {
  return {
    page_id: p.id,
    page_name: p.name ?? null,
    category: p.category ?? null,
    is_owned_by_bm: ownedByBm,
    user_has_access: accessible.has(p.id),
    followers: typeof p.fan_count === "number" ? p.fan_count : null,
    avatar_url: p.picture?.data?.url ?? null,
  };
}

/**
 * Scan a single Business Manager: enumerate owned + client pages, compare each
 * against the operator's directly-accessible pages, upsert into `bm_pages`, and
 * write a `detected_new` event for any page seen for the first time.
 *
 * NEVER grants access — detection only (the "flag, don't auto-action" invariant;
 * grants live behind an explicit UI click, never in the cron).
 *
 * Logs with the "[bm-page-scan]" prefix for Vercel log filtering.
 */
export async function scanBusinessManager(
  supabase: AnySupabaseClient,
  bm: BusinessManager,
  opts: { actorUserId?: string | null } = {},
): Promise<ScanResult> {
  const bizId = bm.business_id;
  const actorUserId = opts.actorUserId ?? bm.added_by_user_id ?? null;

  let token: string | null;
  try {
    token = await getBusinessManagerToken(supabase, bm.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "decrypt_failed";
    console.error(`[bm-page-scan] biz=${bizId} token decrypt failed: ${msg}`);
    await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
    return { businessId: bizId, scannedPages: 0, newPages: 0, missingAccess: 0, ok: false, error: msg };
  }
  if (!token) {
    const msg = "no_token_stored";
    console.error(`[bm-page-scan] biz=${bizId} ${msg}`);
    await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
    return { businessId: bizId, scannedPages: 0, newPages: 0, missingAccess: 0, ok: false, error: msg };
  }

  let owned: MetaBMPage[];
  let clientPages: MetaBMPage[];
  let accessiblePages: { id: string }[];
  try {
    [owned, clientPages, accessiblePages] = await Promise.all([
      listOwnedPages(bizId, token),
      listClientPages(bizId, token),
      listUserAccessiblePages(token),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTokenExpiredMetaError(err)) {
      console.error(`[bm-page-scan] biz=${bizId} token expired (subcode 190): ${msg}`);
      await markBusinessManagerTokenExpired(supabase, bizId, msg);
      await logAccessEvent(supabase, {
        businessId: bizId,
        pageId: "-",
        userId: actorUserId,
        action: "sync_error",
        detail: { error: "token_expired", message: msg },
      });
      return { businessId: bizId, scannedPages: 0, newPages: 0, missingAccess: 0, ok: false, error: "token_expired" };
    }
    console.error(`[bm-page-scan] biz=${bizId} fetch failed: ${msg}`);
    await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
    await logAccessEvent(supabase, {
      businessId: bizId,
      pageId: "-",
      userId: actorUserId,
      action: "sync_error",
      detail: { message: msg },
    });
    return { businessId: bizId, scannedPages: 0, newPages: 0, missingAccess: 0, ok: false, error: msg };
  }

  const accessible = new Set(accessiblePages.map((p) => p.id));

  // Merge owned + client pages; owned wins the ownership flag on collision.
  const merged = new Map<string, UpsertPageInput>();
  for (const p of clientPages) merged.set(p.id, toUpsertInput(p, false, accessible));
  for (const p of owned) merged.set(p.id, toUpsertInput(p, true, accessible));
  const pages = Array.from(merged.values());

  const { newPageIds } = await upsertBMPages(supabase, bizId, pages);

  // bm_pages itself is now fully written (the missing_access_count the UI
  // shows is always computed live from bm_pages — see
  // listBusinessManagerSummaries — so it's already correct at this point
  // even if everything below times out). Checkpoint immediately: this is
  // the boundary between the fast bulk-fetch/upsert phase and the
  // historically-slow per-page event-logging phase below.
  await updateBusinessManagerScanState(supabase, bizId, { lastError: null });

  try {
    for (const idsChunk of chunk(newPageIds, DETECTED_NEW_CHECKPOINT_BOUNDARY)) {
      await logAccessEventsBulk(
        supabase,
        idsChunk.map((pageId) => {
          const page = merged.get(pageId);
          return {
            businessId: bizId,
            pageId,
            userId: actorUserId,
            action: "detected_new" as const,
            detail: {
              page_name: page?.page_name ?? null,
              user_has_access: page?.user_has_access ?? false,
            },
          };
        }),
      );
      // Checkpoint after every chunk so a mid-loop timeout still leaves
      // last_scanned_at reflecting real forward progress, not the start.
      await updateBusinessManagerScanState(supabase, bizId, { lastError: null });
    }
  } catch (err) {
    // bm_pages is already correct (upserted above); only the audit trail
    // of *which* pages were newly detected this run is incomplete. Record
    // the failure but don't fail the whole scan over it.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[bm-page-scan] biz=${bizId} detected_new event logging failed: ${msg}`);
    await updateBusinessManagerScanState(supabase, bizId, { lastError: msg });
  }

  const missingAccess = pages.filter((p) => !p.user_has_access).length;
  await updateBusinessManagerScanState(supabase, bizId, { lastError: null });

  console.error(
    `[bm-page-scan] biz=${bizId} scanned=${pages.length} new=${newPageIds.length} missing_access=${missingAccess}`,
  );

  return {
    businessId: bizId,
    scannedPages: pages.length,
    newPages: newPageIds.length,
    missingAccess,
    ok: true,
  };
}
