/**
 * lib/bm/page-tasks.ts
 *
 * The Page task vocabulary, and the pure functions that turn a task list into
 * the two access flags `bm_pages` stores (migration 148).
 *
 * Deliberately dependency-free (no `server-only`, no `client.ts`) so the unit
 * tests can import it under Node's `--experimental-strip-types` mode, and so
 * both the sync path and the grant path derive access from ONE implementation
 * instead of each re-deciding what "has audience access" means.
 */

/** Runs ads on the page — the only task v1 (migration 145) ever granted. */
export const PAGE_TASK_ADVERTISE = "ADVERTISE";

/**
 * The task Meta requires to use a page as an AUDIENCE seed (Similar Pages,
 * page-engagement custom audiences). Without it, audience creation fails with
 * subcode 1713140 "audience creation permission missing" even though the page
 * advertises fine.
 *
 * VERIFIED LIVE — see docs/session-logs for the verbatim capture. This constant
 * is the single place the string appears; nothing else hardcodes it.
 */
export const PAGE_TASK_AUDIENCE = "AUDIENCE_MANAGE";

export interface PageAccessFlags {
  /** The operator holds SOME role on the page. */
  userHasAccess: boolean;
  /** The operator holds the audience-seed task specifically. */
  userHasAudienceAccess: boolean;
  /** The raw task list, stored as the evidence behind both booleans. */
  userTasks: string[];
}

/**
 * Derive `bm_pages` access state from the operator's tasks on a page, as
 * returned by `GET /me/accounts?fields=id,name,tasks`.
 *
 * `undefined` means the page did not appear in `/me/accounts` at all — no role.
 *
 * NOTE on `userHasAccess`: it stays "appears in /me/accounts at all", exactly as
 * migration 145 computed it, rather than becoming "has ADVERTISE". Tightening it
 * would silently re-flag pages where the operator holds only ANALYZE/MODERATE
 * and cause a mass missing-access jump across ~50 BMs — a behaviour change this
 * PR has no mandate for. Only the audience flag is new.
 */
export function derivePageAccessFlags(tasks: string[] | undefined): PageAccessFlags {
  if (!tasks) {
    return { userHasAccess: false, userHasAudienceAccess: false, userTasks: [] };
  }
  return {
    userHasAccess: true,
    userHasAudienceAccess: tasks.includes(PAGE_TASK_AUDIENCE),
    userTasks: tasks,
  };
}

/**
 * The `tasks` array to POST when granting audience access on a page.
 *
 * Returns the UNION of what the operator already holds and the audience task,
 * never the audience task alone. `POST /{pageId}/assigned_users` SETS the task
 * list for that user on that asset, so posting `[AUDIENCE]` by itself is a
 * request to hold only that task — which on a page already granted ADVERTISE
 * would take advertising away and break live ad delivery. The union makes the
 * call additive and idempotent regardless of which semantics Meta applies.
 *
 * Existing order is preserved and the audience task appended, so the payload is
 * stable and byte-diffable in tests.
 */
export function buildAudienceGrantTasks(existingTasks: string[]): string[] {
  const tasks = existingTasks.filter((t) => t !== PAGE_TASK_AUDIENCE);
  tasks.push(PAGE_TASK_AUDIENCE);
  return tasks;
}
