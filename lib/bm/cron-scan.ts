import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  listBusinessScopedUserIds,
  listUserAccessiblePages,
  type MetaAccessiblePage,
} from "@/lib/meta/business-manager";
import {
  getBusinessManagerToken,
  listBusinessManagers,
  logAccessEvent,
  markBusinessManagerTokenExpired,
} from "@/lib/db/business-managers";
import { scanBusinessManager } from "@/lib/bm/sync";
import { scanBusinessManagerAllAssets, type AssetScanResult } from "@/lib/bm/sync-assets";
import {
  BM_SCAN_TIME_BUDGET_MS,
  createTokenContextCache,
  isMetaRateLimitError,
  isMetaTokenExpiredError,
  orderForRotation,
  runBmScanLoop,
  type BmSkipReason,
} from "@/lib/bm/scan-run";
import type { BusinessManager, ScanResult } from "@/lib/bm/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/** Token-wide reads, done once per distinct token value per run. */
interface TokenContext {
  accessiblePages: MetaAccessiblePage[];
  /** bizId → business-scoped user id. Null when that read failed (non-fatal). */
  businessScopedUserIds: Map<string, string> | null;
}

interface BmOutcome {
  page: ScanResult;
  assets: AssetScanResult[];
  rateLimited: boolean;
}

export interface BmCronScanSummary {
  ok: true;
  elapsedMs: number;
  businessManagers: number;
  scanned: number;
  scannedOk: number;
  failed: number;
  skipped: number;
  skippedRateLimited: number;
  skippedTimeBudget: number;
  /** What ended the run early, or null when every BM was started. */
  stoppedBy: BmSkipReason | null;
  rateLimitedAt: string | null;
  /** Distinct-token reads of `/me/accounts` + business-scoped ids this run. */
  tokenContextReads: number;
  totals: { pages: number; newPages: number; missing: number; errors: number };
  assetTotals: { assets: number; newAssets: number; missing: number; errors: number };
  skippedBusinessIds: Array<{ businessId: string; reason: BmSkipReason }>;
  results: ScanResult[];
  assetResults: AssetScanResult[];
}

function failedPage(bizId: string, error: string, rateLimited = false): ScanResult {
  return {
    businessId: bizId,
    scannedPages: 0,
    newPages: 0,
    missingAccess: 0,
    ok: false,
    error,
    ...(rateLimited ? { rateLimited: true } : {}),
  };
}

/**
 * The daily `/api/cron/bm-page-scan` run. See `lib/bm/scan-run.ts` for why the
 * loop has a breaker, a time budget and a rotation order.
 *
 * Meta reads per run, before: `/me/accounts` and `/me?fields=business_users`
 * once per BM (71 + 71), on top of each BM's own edges. After: once per
 * distinct stored token (normally one), then only each BM's own edges.
 */
export async function runBmCronScan(
  supabase: AnySupabaseClient,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<BmCronScanSummary> {
  const now = opts.now ?? Date.now;
  const startedAtMs = now();

  const bms = orderForRotation(await listBusinessManagers(supabase));
  console.error(
    `[bm-page-scan] starting scan of ${bms.length} business manager(s), least recently scanned first`,
  );

  const tokenContexts = createTokenContextCache<TokenContext>(
    async (token) => {
      const accessiblePages = await listUserAccessiblePages(token);
      let businessScopedUserIds: Map<string, string> | null = null;
      try {
        businessScopedUserIds = await listBusinessScopedUserIds(token);
      } catch (err) {
        // A rate limit or a dead token ends the run either way; anything else
        // only means each BM resolves its own id, as before this change.
        if (isMetaRateLimitError(err) || isMetaTokenExpiredError(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bm-page-scan] business-scoped user id list failed, resolving per BM: ${msg}`);
      }
      return { accessiblePages, businessScopedUserIds };
    },
    (err) => isMetaRateLimitError(err) || isMetaTokenExpiredError(err),
  );
  // Token values Meta has already called expired this run. A BM holding one
  // is marked expired without another Meta call.
  const expiredTokens = new Set<string>();

  async function scanOne(bm: BusinessManager): Promise<BmOutcome> {
    const bizId = bm.business_id;
    const actorUserId = bm.added_by_user_id;

    let token: string | null = null;
    try {
      token = await getBusinessManagerToken(supabase, bm.id);
    } catch {
      // scanBusinessManager records the decrypt failure itself.
    }
    if (!token) {
      const page = await scanBusinessManager(supabase, bm, { actorUserId });
      return { page, assets: [], rateLimited: false };
    }

    if (expiredTokens.has(token)) {
      console.error(`[bm-page-scan] biz=${bizId} token already expired this run, not scanned`);
      await markBusinessManagerTokenExpired(supabase, bizId, "token_expired");
      return { page: failedPage(bizId, "token_expired"), assets: [], rateLimited: false };
    }

    let ctx: TokenContext | null = null;
    try {
      ctx = await tokenContexts.get(token);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isMetaRateLimitError(err)) {
        console.error(`[bm-page-scan] biz=${bizId} rate limited on the token-wide reads: ${msg}`);
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId: "-",
          userId: actorUserId,
          action: "rate_limited",
          detail: { message: msg, phase: "token_context" },
        });
        return { page: failedPage(bizId, "rate_limited", true), assets: [], rateLimited: true };
      }
      if (isMetaTokenExpiredError(err)) {
        console.error(`[bm-page-scan] biz=${bizId} token expired (subcode 190): ${msg}`);
        expiredTokens.add(token);
        await markBusinessManagerTokenExpired(supabase, bizId, msg);
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId: "-",
          userId: actorUserId,
          action: "sync_error",
          detail: { error: "token_expired", message: msg },
        });
        return { page: failedPage(bizId, "token_expired"), assets: [], rateLimited: false };
      }
      // Anything else: let the page scan read /me/accounts itself, as before.
      console.error(`[bm-page-scan] biz=${bizId} token-wide reads failed, scanning without them: ${msg}`);
    }

    const page = await scanBusinessManager(supabase, bm, {
      actorUserId,
      token,
      accessiblePages: ctx?.accessiblePages,
    });
    if (page.rateLimited) return { page, assets: [], rateLimited: true };
    if (!page.ok && page.error === "token_expired") {
      expiredTokens.add(token);
      return { page, assets: [], rateLimited: false };
    }

    const assets = await scanBusinessManagerAllAssets(supabase, bm, {
      actorUserId,
      token,
      businessScopedUserId: ctx?.businessScopedUserIds?.get(bizId),
    });
    return { page, assets, rateLimited: assets.some((a) => a.rateLimited) };
  }

  const loop = await runBmScanLoop<BusinessManager, BmOutcome>({
    bms,
    scanOne,
    isRateLimited: (o) => o.rateLimited,
    onThrow: (bm, err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bm-page-scan] biz=${bm.business_id} scan threw: ${msg}`);
      return { page: failedPage(bm.business_id, msg), assets: [], rateLimited: false };
    },
    startedAtMs,
    now,
    budgetMs: opts.budgetMs ?? BM_SCAN_TIME_BUDGET_MS,
  });

  const results = loop.scanned.map((s) => s.result.page);
  const assetResults = loop.scanned.flatMap((s) => s.result.assets);
  const elapsedMs = now() - startedAtMs;

  const totals = results.reduce(
    (acc, r) => {
      acc.pages += r.scannedPages;
      acc.newPages += r.newPages;
      acc.missing += r.missingAccess;
      if (!r.ok) acc.errors += 1;
      return acc;
    },
    { pages: 0, newPages: 0, missing: 0, errors: 0 },
  );
  const assetTotals = assetResults.reduce(
    (acc, r) => {
      acc.assets += r.scanned;
      acc.newAssets += r.newAssets;
      acc.missing += r.missingAccess;
      if (!r.ok) acc.errors += 1;
      return acc;
    },
    { assets: 0, newAssets: 0, missing: 0, errors: 0 },
  );

  const skippedRateLimited = loop.skipped.filter((s) => s.reason === "rate_limited").length;
  const skippedTimeBudget = loop.skipped.filter((s) => s.reason === "time_budget").length;
  const scannedOk = results.filter((r) => r.ok).length;

  console.error(
    `[bm-page-scan] done in ${elapsedMs}ms — bms=${bms.length} scanned=${results.length} ok=${scannedOk} ` +
      `skipped_rate_limited=${skippedRateLimited} skipped_time_budget=${skippedTimeBudget} ` +
      `stopped_by=${loop.stoppedBy ?? "none"}` +
      (loop.rateLimitedAt ? ` rate_limited_at=${loop.rateLimitedAt.business_id}` : "") +
      ` token_reads=${tokenContexts.loads()} | pages=${totals.pages} new=${totals.newPages} ` +
      `missing_access=${totals.missing} errors=${totals.errors} | ` +
      `assets=${assetTotals.assets} new=${assetTotals.newAssets} missing_access=${assetTotals.missing} errors=${assetTotals.errors}`,
  );

  return {
    ok: true,
    elapsedMs,
    businessManagers: bms.length,
    scanned: results.length,
    scannedOk,
    failed: results.length - scannedOk,
    skipped: loop.skipped.length,
    skippedRateLimited,
    skippedTimeBudget,
    stoppedBy: loop.stoppedBy,
    rateLimitedAt: loop.rateLimitedAt?.business_id ?? null,
    tokenContextReads: tokenContexts.loads(),
    totals,
    assetTotals,
    skippedBusinessIds: loop.skipped.map((s) => ({ businessId: s.bm.business_id, reason: s.reason })),
    results,
    assetResults,
  };
}
