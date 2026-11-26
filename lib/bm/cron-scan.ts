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
import {
  loadArchivedClientIds,
  logSkippedArchivedClients,
} from "@/lib/db/client-status";
import {
  createMetaCallMeter,
  withMetaCallMeter,
  type AppUsageReading,
} from "@/lib/meta/call-meter";
import { scanBusinessManager } from "@/lib/bm/sync";
import { businessClientLinks, keepForScan } from "@/lib/bm/client-links";
import { scanBusinessManagerAllAssets, type AssetScanResult } from "@/lib/bm/sync-assets";
import {
  BM_SCAN_TIME_BUDGET_MS,
  BM_SCAN_USAGE_STOP_PCT,
  createTokenContextCache,
  createUsageStopLatch,
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
  /** BMs this run could scan: every connected BM except archived clients'. */
  businessManagers: number;
  /** BMs left out because their client is archived (`client_business_managers.client_id`). */
  skippedArchivedClients: number;
  scanned: number;
  scannedOk: number;
  failed: number;
  skipped: number;
  skippedRateLimited: number;
  skippedTimeBudget: number;
  /** BMs not started because X-App-Usage reached BM_SCAN_USAGE_STOP_PCT (reason `app_usage_80`). */
  skippedUsage: number;
  /** What ended the run early, or null when every BM was started. */
  stoppedBy: BmSkipReason | null;
  rateLimitedAt: string | null;
  /** Distinct-token reads of `/me/accounts` + business-scoped ids this run. */
  tokenContextReads: number;
  /** Graph HTTP attempts this run made, retries included (lib/meta/call-meter.ts). */
  metaCalls: number;
  /** The last `X-App-Usage` reading of the run (as of the last BM scanned), or null if Meta sent none. */
  appUsageLast: AppUsageReading | null;
  /**
   * The `X-App-Usage` reading on the response that tripped the breaker. Null
   * when the run was not rate-limited, or Meta sent no header on that response.
   */
  appUsageAtLimit: AppUsageReading | null;
  /** True when the run stopped itself at BM_SCAN_USAGE_STOP_PCT (`stoppedBy === "app_usage_80"`). */
  stoppedAtUsage: boolean;
  /** The first reading at or over the stop percentage, when the run stopped on it; else null. */
  usageAtStop: AppUsageReading | null;
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
 * The nightly `/api/cron/bm-page-scan` run. See `lib/bm/scan-run.ts` for why the
 * loop has a breaker, an 80 % app-usage stop, a time budget and a rotation order.
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

  // Archived clients are out of every cron (lib/db/client-status.ts). A BM
  // with no client is kept, as rows with no client are everywhere else. Since
  // 276 a BM can serve several clients (client_id and its link rows): it is
  // left out only when every one of them is archived.
  const connected = await listBusinessManagers(supabase);
  const archivedClientIds = await loadArchivedClientIds(supabase);
  const links = await businessClientLinks(supabase, { businessIds: connected.map((bm) => bm.business_id) });
  const bms = orderForRotation(keepForScan(connected, links, new Set(archivedClientIds)));
  const skippedArchivedClients = connected.length - bms.length;
  logSkippedArchivedClients("bm-page-scan", skippedArchivedClients);
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

  // Every Graph call below is counted on this run's own meter, so another
  // request sharing the instance never shows up in meta_calls.
  // The usage stop reads every X-App-Usage reading as it arrives, not only the
  // last one per BM, so a BM that crossed 80 % and fell back still stops the run.
  const meter = createMetaCallMeter();
  const usageStop = createUsageStopLatch(BM_SCAN_USAGE_STOP_PCT);
  meter.onAppUsage = usageStop.note;
  let appUsageAtLimit: AppUsageReading | null = null;
  async function scanOneMetered(bm: BusinessManager): Promise<BmOutcome> {
    const before = meter.calls;
    const outcome = await scanOne(bm);
    if (outcome.rateLimited) appUsageAtLimit = meter.lastRateLimitedAppUsage;
    const u = meter.lastAppUsage;
    console.error(
      `[bm-page-scan] biz=${bm.business_id} meta_calls=${meter.calls - before} total_meta_calls=${meter.calls} ` +
        `app_usage=${u ? `${u.call_count}/${u.total_time}/${u.total_cputime}` : "none"}` +
        (outcome.rateLimited ? " rate_limited" : ""),
    );
    return outcome;
  }

  const loop = await withMetaCallMeter(meter, () => runBmScanLoop<BusinessManager, BmOutcome>({
    bms,
    scanOne: scanOneMetered,
    isRateLimited: (o) => o.rateLimited,
    onThrow: (bm, err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[bm-page-scan] biz=${bm.business_id} scan threw: ${msg}`);
      return { page: failedPage(bm.business_id, msg), assets: [], rateLimited: false };
    },
    startedAtMs,
    now,
    budgetMs: opts.budgetMs ?? BM_SCAN_TIME_BUDGET_MS,
    usageStop: usageStop.tripped,
  }));

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
  const skippedUsage = loop.skipped.filter((s) => s.reason === "app_usage_80").length;
  const stoppedAtUsage = loop.stoppedBy === "app_usage_80";
  const scannedOk = results.filter((r) => r.ok).length;

  console.error(
    `[bm-page-scan] done in ${elapsedMs}ms — bms=${bms.length} skipped_archived_clients=${skippedArchivedClients} ` +
      `scanned=${results.length} ok=${scannedOk} ` +
      `skipped_rate_limited=${skippedRateLimited} skipped_time_budget=${skippedTimeBudget} ` +
      `skipped_usage=${skippedUsage} stopped_by=${loop.stoppedBy ?? "none"}` +
      (loop.usageAtStop
        ? ` usage_at_stop=${loop.usageAtStop.call_count}/${loop.usageAtStop.total_time}/${loop.usageAtStop.total_cputime}`
        : "") +
      (loop.rateLimitedAt ? ` rate_limited_at=${loop.rateLimitedAt.business_id}` : "") +
      ` token_reads=${tokenContexts.loads()} meta_calls=${meter.calls} | pages=${totals.pages} new=${totals.newPages} ` +
      `missing_access=${totals.missing} errors=${totals.errors} | ` +
      `assets=${assetTotals.assets} new=${assetTotals.newAssets} missing_access=${assetTotals.missing} errors=${assetTotals.errors}`,
  );

  return {
    ok: true,
    elapsedMs,
    businessManagers: bms.length,
    skippedArchivedClients,
    scanned: results.length,
    scannedOk,
    failed: results.length - scannedOk,
    skipped: loop.skipped.length,
    skippedRateLimited,
    skippedTimeBudget,
    skippedUsage,
    stoppedBy: loop.stoppedBy,
    rateLimitedAt: loop.rateLimitedAt?.business_id ?? null,
    tokenContextReads: tokenContexts.loads(),
    metaCalls: meter.calls,
    appUsageLast: meter.lastAppUsage,
    appUsageAtLimit: loop.stoppedBy === "rate_limited" ? appUsageAtLimit : null,
    stoppedAtUsage,
    usageAtStop: stoppedAtUsage ? loop.usageAtStop : null,
    totals,
    assetTotals,
    skippedBusinessIds: loop.skipped.map((s) => ({ businessId: s.bm.business_id, reason: s.reason })),
    results,
    assetResults,
  };
}
