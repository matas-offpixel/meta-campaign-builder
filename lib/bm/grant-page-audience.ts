import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getMetaUserId,
  grantUserPageTasks,
  listUserAccessiblePages,
  resolveBusinessScopedUserId,
} from "@/lib/meta/business-manager";
import {
  getBMPages,
  getBusinessManagerToken,
  getMissingAudienceAccessPageIds,
  logAccessEvent,
  markBusinessManagerTokenExpired,
  setPageTaskState,
} from "@/lib/db/business-managers";
import { isTokenExpiredMetaError } from "@/lib/bm/sync";
import { buildAudienceGrantTasks, derivePageAccessFlags } from "@/lib/bm/page-tasks";
import type { AudienceGrantOutcome, GrantResult } from "@/lib/bm/types";
import { isMetaAdAccountRateLimitError } from "@/lib/audiences/meta-rate-limit";
import { estimateRetryAfterMinutes, type AppUsageSnapshot } from "@/lib/meta/app-usage";

/**
 * lib/bm/grant-page-audience.ts
 *
 * Grants the operator the page task Meta requires for AUDIENCE creation
 * (migration 148) — the capability the wizard's Similar-Pages / engagement
 * audience seeds need, which v1's ADVERTISE-only grant does not confer.
 *
 * Kept as a separate module from `lib/bm/grant.ts` on purpose: v1's
 * ADVERTISE grant path is load-bearing for every live launch, and this PR
 * must not be able to change its behaviour. The batching / throttling /
 * rate-limit-halt policy is copied deliberately (per the PR #712 constraint)
 * rather than refactored into a shared runner, which would have meant editing
 * the v1 path.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any, any, any>;

/** Rate-limit guard — identical policy to lib/bm/grant.ts (PR #712). */
const BATCH_SIZE = 50;
const BATCH_SLEEP_MS = 2_000;
const GRANT_REQUEST_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** See the identical helper in lib/bm/grant.ts — duck-typed to avoid importing MetaApiError. */
function extractAppUsage(err: unknown): AppUsageSnapshot | null {
  if (!err || typeof err !== "object") return null;
  const rawErrorData = (err as { rawErrorData?: unknown }).rawErrorData;
  if (!rawErrorData || typeof rawErrorData !== "object") return null;
  const usage = (rawErrorData as Record<string, unknown>).__appUsage;
  return usage ? (usage as AppUsageSnapshot) : null;
}

/**
 * `confirmed` — not `granted` — is the number that matters here: `granted` only
 * means Meta accepted the POST, which is exactly the signal that proved
 * untrustworthy for audience seeding.
 *
 * Structurally satisfies `AudienceGrantOutcome` (so it can be passed to
 * `isAudienceGrantSuccess` / `describeAudienceGrantResult`) without extending it
 * — `GrantResult` narrows `failures` to carry `pageId`, which a declared
 * multiple-inheritance would reject.
 */
export interface PageAudienceGrantResult extends GrantResult {
  confirmed: number;
  /** The read-back call itself failed. Grants may have landed; nothing was confirmed. */
  readBackFailed?: boolean;
}

/** Compile-time proof of the structural claim above. */
const _satisfiesAudienceOutcome: (r: PageAudienceGrantResult) => AudienceGrantOutcome = (r) => r;
void _satisfiesAudienceOutcome;

/**
 * Grant audience-seed access on pages within a BM, then verify by read-back.
 *
 * Why verify: this whole PR exists because a page that *looks* granted can
 * still be rejected as an audience seed. Trusting the POST response would
 * reproduce that class of bug at a different layer, so flags are written from
 * what Meta reports afterwards, never from the fact that the POST returned 200.
 * The read-back is ONE `/me/accounts` call for the whole run (page-level
 * `assigned_users` reads are not available to this token — they need
 * `pages_manage_metadata`), so verification costs O(1), not O(pages).
 *
 * @param pageIds  When omitted, targets every page currently lacking the task.
 */
export async function grantPageAudienceAccessForBusinessManager(
  supabase: AnySupabaseClient,
  bm: { id: string; business_id: string },
  opts: { pageIds?: string[]; actorUserId: string | null },
): Promise<PageAudienceGrantResult> {
  const bizId = bm.business_id;
  const result: PageAudienceGrantResult = {
    businessId: bizId,
    attempted: 0,
    granted: 0,
    confirmed: 0,
    failed: 0,
    batches: 0,
    failures: [],
  };

  let pageIds = opts.pageIds ?? null;
  if (!pageIds) {
    pageIds = await getMissingAudienceAccessPageIds(supabase, bizId);
  }
  if (pageIds.length === 0) return result;
  result.totalTargeted = pageIds.length;

  const token = await getBusinessManagerToken(supabase, bm.id);
  if (!token) {
    result.tokenExpired = true;
    result.failures.push({ pageId: "-", error: "no_token_stored" });
    return result;
  }

  // Existing tasks per page — the audience grant is built as a UNION with
  // these so it can never revoke a capability the page already had (see
  // buildAudienceGrantTasks for the live-verified reason this matters).
  const existingTasksByPage = new Map<string, string[]>();
  for (const page of await getBMPages(supabase, bizId)) {
    existingTasksByPage.set(page.page_id, page.user_tasks);
  }

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
    result.failures.push({
      pageId: "-",
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  const attemptedPageIds: string[] = [];

  for (let i = 0; i < pageIds.length; i += BATCH_SIZE) {
    const batch = pageIds.slice(i, i + BATCH_SIZE);
    result.batches += 1;

    for (let b = 0; b < batch.length; b += 1) {
      const pageId = batch[b];
      const tasks = buildAudienceGrantTasks(existingTasksByPage.get(pageId) ?? []);
      result.attempted += 1;
      attemptedPageIds.push(pageId);
      try {
        await grantUserPageTasks(bizId, pageId, targetUserId, tasks, token);
        result.granted += 1;
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId,
          userId: opts.actorUserId,
          action: "granted",
          detail: {
            intent: "audience",
            requested_tasks: tasks,
            target_user_id: targetUserId,
            fb_user_id: fbUserId,
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);

        // Meta's app/user/ad-account quota — HALT the run rather than deepen an
        // already-rejected quota window (2026-07-09 Columbo Group incident).
        if (isMetaAdAccountRateLimitError(err)) {
          const appUsage = extractAppUsage(err);
          const retryAfterMinutes = estimateRetryAfterMinutes(appUsage);
          result.rateLimited = true;
          result.retryAfterMinutes = retryAfterMinutes;
          console.warn(
            `[bm audience-grant] biz=${bizId} HALT on Meta rate limit at page=${pageId} ` +
              `(${result.granted}/${result.totalTargeted} granted so far): ${msg}`,
          );
          await logAccessEvent(supabase, {
            businessId: bizId,
            pageId,
            userId: opts.actorUserId,
            action: "rate_limited",
            detail: {
              phase: "audience_grant",
              message: msg,
              granted_so_far: result.granted,
              total_targeted: result.totalTargeted,
              retry_after_minutes: retryAfterMinutes,
              app_usage: appUsage,
            },
          });
          await reconcile(supabase, bizId, token, attemptedPageIds, result);
          return result;
        }

        result.failed += 1;
        result.failures.push({ pageId, error: msg });
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId,
          userId: opts.actorUserId,
          action: "sync_error",
          detail: { phase: "audience_grant", message: msg },
        });
        if (isTokenExpiredMetaError(err)) {
          await markBusinessManagerTokenExpired(supabase, bizId, msg);
          result.tokenExpired = true;
          return result;
        }
      }

      const isLastPageOverall = i + b === pageIds.length - 1;
      if (!isLastPageOverall) await sleep(GRANT_REQUEST_DELAY_MS);
    }

    if (i + BATCH_SIZE < pageIds.length) await sleep(BATCH_SLEEP_MS);
  }

  await reconcile(supabase, bizId, token, attemptedPageIds, result);
  return result;
}

/**
 * Re-read the operator's real page tasks once and write the observed state for
 * every page this run touched. A page missing from `/me/accounts` afterwards
 * keeps its stored flags — Meta's read-your-writes on this edge is not
 * guaranteed to be immediate, and a lagging read must not clear a flag.
 */
async function reconcile(
  supabase: AnySupabaseClient,
  bizId: string,
  token: string,
  attemptedPageIds: string[],
  result: PageAudienceGrantResult,
): Promise<void> {
  if (attemptedPageIds.length === 0) return;

  let observed: Map<string, string[]>;
  try {
    const accessible = await listUserAccessiblePages(token);
    observed = new Map(accessible.map((p) => [p.id, p.tasks ?? []]));
  } catch (err) {
    result.readBackFailed = true;
    console.warn(
      `[bm audience-grant] biz=${bizId} read-back failed: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  for (const pageId of attemptedPageIds) {
    const tasks = observed.get(pageId);
    if (!tasks) continue;
    const flags = derivePageAccessFlags(tasks);
    if (flags.userHasAudienceAccess) result.confirmed += 1;
    await setPageTaskState(supabase, bizId, pageId, flags);
  }

  console.log(
    `[bm audience-grant] biz=${bizId} granted=${result.granted} confirmed=${result.confirmed} ` +
      `attempted=${result.attempted} failed=${result.failed}`,
  );
}
