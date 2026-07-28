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
  logAccessEvent,
  markBusinessManagerTokenExpired,
  recordPageGrantRequest,
  setPageTaskState,
} from "@/lib/db/business-managers";
import { isTokenExpiredMetaError } from "@/lib/bm/sync";
import {
  buildAdditiveTaskGrant,
  derivePageAccessState,
  grantSatisfiedForPage,
  validatePageTasks,
} from "@/lib/bm/page-tasks";
import type { GrantResult, TaskGrantOutcome } from "@/lib/bm/types";
import { isMetaAdAccountRateLimitError } from "@/lib/audiences/meta-rate-limit";
import { estimateRetryAfterMinutes, type AppUsageSnapshot } from "@/lib/meta/app-usage";

/**
 * lib/bm/grant-page-tasks.ts
 *
 * Grants an EXPLICIT, validated set of Meta page tasks to the operator, and
 * verifies the result by reading Meta back rather than trusting the POST.
 *
 * Kept as a separate module from `lib/bm/grant.ts` on purpose: v1's
 * ADVERTISE-only grant path is load-bearing for every live launch, and this PR
 * must not be able to change its behaviour. The batching / throttling /
 * rate-limit-halt policy is copied deliberately (per the PR #712 constraint)
 * rather than refactored into a shared runner, which would have meant editing
 * that path.
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
 * `confirmed` — not `granted` — is the number that matters: `granted` only means
 * Meta accepted the POST.
 *
 * Structurally satisfies `TaskGrantOutcome` (so it can be passed to
 * `isTaskGrantSuccess` / `describeTaskGrantResult`) without extending it —
 * `GrantResult` narrows `failures` to carry `pageId`, which declared multiple
 * inheritance would reject.
 */
export interface PageTaskGrantResult extends GrantResult {
  confirmed: number;
  readBackFailed?: boolean;
  requestedTasks?: string[];
  /** Set when the requested task set was rejected locally, before any Graph call. */
  invalidRequest?: boolean;
}

/** Compile-time proof of the structural claim above. */
const _satisfiesTaskOutcome: (r: PageTaskGrantResult) => TaskGrantOutcome = (r) => r;
void _satisfiesTaskOutcome;

/**
 * Grant `tasks` on pages within a BM, additively, then verify by read-back.
 *
 * Three things worth knowing:
 *
 * 1. The task set is validated LOCALLY first. This PR was originally scoped
 *    around a task string that does not exist in Meta's enum; without this
 *    check, nothing would have caught that until Meta rejected every grant with
 *    code 100 part-way through a bulk run over ~50 BMs.
 * 2. Each POST carries the UNION of the page's existing tasks and the requested
 *    ones. `assigned_users` SETS a user's task list rather than appending, so
 *    posting the new tasks alone would strip whatever the page already had —
 *    including ADVERTISE, which would stop live ad delivery.
 * 3. Verification is ONE `/me/accounts` call for the whole run, not one per
 *    page (page-node `assigned_users` reads need `pages_manage_metadata`, which
 *    this token lacks), so it costs O(1) and is always worth doing.
 *
 * @param pageIds  When omitted, targets every page that does not already hold
 *                 all of the requested tasks.
 */
export async function grantPageTasksForBusinessManager(
  supabase: AnySupabaseClient,
  bm: { id: string; business_id: string },
  opts: { tasks: string[]; pageIds?: string[]; actorUserId: string | null },
): Promise<PageTaskGrantResult> {
  const bizId = bm.business_id;
  const tasks = opts.tasks;
  const result: PageTaskGrantResult = {
    businessId: bizId,
    attempted: 0,
    granted: 0,
    confirmed: 0,
    failed: 0,
    batches: 0,
    failures: [],
    requestedTasks: tasks,
  };

  const validation = validatePageTasks(tasks);
  if (!validation.ok) {
    result.invalidRequest = true;
    result.failures.push({ pageId: "-", error: validation.error ?? "invalid task set" });
    return result;
  }

  // Existing tasks per page, so each grant can be built as a union.
  const pages = await getBMPages(supabase, bizId);
  const existingTasksByPage = new Map(pages.map((p) => [p.page_id, p.user_tasks]));

  const pageIds =
    opts.pageIds ??
    pages
      .filter((p) => !grantSatisfiedForPage(tasks, p.user_tasks))
      .map((p) => p.page_id);
  if (pageIds.length === 0) return result;
  result.totalTargeted = pageIds.length;

  const token = await getBusinessManagerToken(supabase, bm.id);
  if (!token) {
    result.tokenExpired = true;
    result.failures.push({ pageId: "-", error: "no_token_stored" });
    return result;
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
      const payloadTasks = buildAdditiveTaskGrant(existingTasksByPage.get(pageId) ?? [], tasks);
      result.attempted += 1;
      attemptedPageIds.push(pageId);
      try {
        await grantUserPageTasks(bizId, pageId, targetUserId, payloadTasks, token);
        result.granted += 1;
        await recordPageGrantRequest(supabase, bizId, pageId, payloadTasks);
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId,
          userId: opts.actorUserId,
          action: "granted",
          detail: {
            added_tasks: tasks,
            requested_tasks: payloadTasks,
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
            `[bm page-task-grant] biz=${bizId} HALT on Meta rate limit at page=${pageId} ` +
              `(${result.granted}/${result.totalTargeted} granted so far): ${msg}`,
          );
          await logAccessEvent(supabase, {
            businessId: bizId,
            pageId,
            userId: opts.actorUserId,
            action: "rate_limited",
            detail: {
              phase: "page_task_grant",
              message: msg,
              granted_so_far: result.granted,
              total_targeted: result.totalTargeted,
              retry_after_minutes: retryAfterMinutes,
              app_usage: appUsage,
            },
          });
          await reconcile(supabase, bizId, token, attemptedPageIds, tasks, result);
          return result;
        }

        result.failed += 1;
        result.failures.push({ pageId, error: msg });
        await logAccessEvent(supabase, {
          businessId: bizId,
          pageId,
          userId: opts.actorUserId,
          action: "sync_error",
          detail: { phase: "page_task_grant", message: msg, requested_tasks: payloadTasks },
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

  await reconcile(supabase, bizId, token, attemptedPageIds, tasks, result);
  return result;
}

/**
 * Re-read the operator's real page tasks once and write the observed state for
 * every page this run touched.
 *
 * A page missing from `/me/accounts` afterwards keeps its stored state — Meta's
 * read-your-writes on this edge is not guaranteed to be immediate, and a lagging
 * read must never clear a flag. Confirmation is a SUPERSET test, never equality,
 * because Meta expands grants (PR #726: one ADVERTISE became five tasks).
 */
async function reconcile(
  supabase: AnySupabaseClient,
  bizId: string,
  token: string,
  attemptedPageIds: string[],
  requestedTasks: string[],
  result: PageTaskGrantResult,
): Promise<void> {
  if (attemptedPageIds.length === 0) return;

  let observed: Map<string, string[]>;
  try {
    const accessible = await listUserAccessiblePages(token);
    observed = new Map(accessible.map((p) => [p.id, p.tasks ?? []]));
  } catch (err) {
    result.readBackFailed = true;
    console.warn(
      `[bm page-task-grant] biz=${bizId} read-back failed: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return;
  }

  for (const pageId of attemptedPageIds) {
    const tasks = observed.get(pageId);
    if (!tasks) continue;
    if (grantSatisfiedForPage(requestedTasks, tasks)) result.confirmed += 1;
    await setPageTaskState(supabase, bizId, pageId, derivePageAccessState(tasks));
  }

  console.log(
    `[bm page-task-grant] biz=${bizId} tasks=${requestedTasks.join(",")} ` +
      `granted=${result.granted} confirmed=${result.confirmed} ` +
      `attempted=${result.attempted} failed=${result.failed}`,
  );
}
