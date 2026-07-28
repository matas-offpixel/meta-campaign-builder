/**
 * lib/bm/page-tasks.ts
 *
 * The Page task vocabulary Meta actually accepts, plus the pure functions that
 * validate a requested task set and turn an observed one into access state.
 *
 * Deliberately dependency-free (no `server-only`, no `client.ts`) so the unit
 * tests can import it under Node's `--experimental-strip-types` mode, and so the
 * sync path and the grant path share ONE definition of what a page task is.
 */

/**
 * Every task `POST /{pageId}/assigned_users` accepts, verbatim from Graph API
 * v23.0 on 2026-07-28.
 *
 * ── Provenance ──────────────────────────────────────────────────────────────
 * Meta does not document these values (the `page/assigned_users` reference
 * describes `tasks` only as "Page permission tasks to assign this user"), and
 * the read side is permission-gated for this token — `GET
 * /{pageId}/assigned_users` returns code 10, needing `pages_manage_metadata`,
 * even via the business-node field expansion that worked for the v2 asset kinds
 * in PR #726. So the list was captured by POSTing a deliberately invalid task
 * and reading the enum out of the rejection:
 *
 *   POST /1026165617251103/assigned_users
 *   { business: "944651277948334", user: "122121443048950557",
 *     tasks: ["__ENUM_PROBE__"] }
 *   → 100 "Your request has violated JSON schema constraint 'enum' for the JSON
 *     field 'tasks.0' … expected : '[FULL_CONTROL, CONTENT, MESSAGES,
 *     COMMUNITY_ACTIVITY, ADVERTISE, ANALYZE, IG_APP_ADMIN, IG_APP,
 *     SPARK_INSIGHTS, SPARK_PUBLISH, SPARK_EVERYTHING, CREATOR_MANAGEMENT,
 *     CREATIVE_MANAGEMENT]' but got '__ENUM_PROBE__'"
 *
 * Full response in `__tests__/fixtures/page_assigned_users_enum_probe.json`.
 *
 * ── What this list disproves ────────────────────────────────────────────────
 * `AUDIENCE_MANAGE` is NOT a page task. This PR was originally scoped to grant
 * it to fix subcode 1713140 ("audience creation permission missing"); had that
 * shipped, every grant would have failed with code 100 and the bulk action
 * across ~50 BMs would have resolved nothing. Whatever governs page-based
 * audience creation, it is not a task on this edge.
 *
 * Note also that this is the same unified business-asset vocabulary PR #726
 * found on Instagram assets — `CONTENT` not `CREATE_CONTENT`, `FULL_CONTROL`
 * not `MANAGE` — plus the IG-app and Spark extras. The legacy page-role names
 * (`MANAGE`, `CREATE_CONTENT`, `MODERATE`, `MESSAGING`) are NOT accepted here.
 */
export const PAGE_PERMITTED_TASKS = [
  "FULL_CONTROL",
  "CONTENT",
  "MESSAGES",
  "COMMUNITY_ACTIVITY",
  "ADVERTISE",
  "ANALYZE",
  "IG_APP_ADMIN",
  "IG_APP",
  "SPARK_INSIGHTS",
  "SPARK_PUBLISH",
  "SPARK_EVERYTHING",
  "CREATOR_MANAGEMENT",
  "CREATIVE_MANAGEMENT",
] as const;

/** The Graph API version the enum above was captured from. */
export const PAGE_PERMITTED_TASKS_CAPTURED_FROM = "v23.0";
/** When it was captured — re-verify if Meta bumps the asset-permission model. */
export const PAGE_PERMITTED_TASKS_CAPTURED_AT = "2026-07-28";

export type PagePermittedTask = (typeof PAGE_PERMITTED_TASKS)[number];

/** Runs ads on the page — the only task v1 (migration 145) ever granted. */
export const PAGE_TASK_ADVERTISE: PagePermittedTask = "ADVERTISE";

/**
 * Grants this tool will NOT issue, regardless of caller.
 *
 * `/business-managers` promises the operator "enough to run ads, no owner-level
 * actions". `FULL_CONTROL` and `IG_APP_ADMIN` are owner-level on someone else's
 * client asset, and `SPARK_EVERYTHING` carries publishing rights. Blocking them
 * here means a future caller cannot quietly escalate what the tool grants.
 */
export const PAGE_TASKS_NEVER_GRANTED: readonly string[] = [
  "FULL_CONTROL",
  "IG_APP_ADMIN",
  "SPARK_EVERYTHING",
];

export function isPagePermittedTask(task: string): task is PagePermittedTask {
  return (PAGE_PERMITTED_TASKS as readonly string[]).includes(task);
}

export interface TaskValidationResult {
  ok: boolean;
  /** Operator-facing reason, naming the offending values and the accepted set. */
  error?: string;
}

/**
 * Validate a requested task set BEFORE spending a Graph call on it.
 *
 * This exists because of how this PR went: the task string it was scoped around
 * did not exist, and nothing would have caught that until Meta rejected every
 * single grant with code 100 mid-way through a bulk run over ~50 BMs. Failing
 * fast, locally, with the accepted set in the message, converts that into an
 * immediate and self-explanatory error.
 */
export function validatePageTasks(tasks: string[]): TaskValidationResult {
  if (tasks.length === 0) {
    return { ok: false, error: "No tasks requested." };
  }

  const unknown = tasks.filter((t) => !isPagePermittedTask(t));
  if (unknown.length > 0) {
    return {
      ok: false,
      error:
        `Not a Meta page task: ${unknown.join(", ")}. ` +
        `Accepted (Graph ${PAGE_PERMITTED_TASKS_CAPTURED_FROM}, captured ` +
        `${PAGE_PERMITTED_TASKS_CAPTURED_AT}): ${PAGE_PERMITTED_TASKS.join(", ")}.`,
    };
  }

  const forbidden = tasks.filter((t) => PAGE_TASKS_NEVER_GRANTED.includes(t));
  if (forbidden.length > 0) {
    return {
      ok: false,
      error:
        `This tool does not grant owner-level page tasks: ${forbidden.join(", ")}. ` +
        `Do it by hand in Business Manager if it is genuinely needed.`,
    };
  }

  return { ok: true };
}

export interface PageAccessState {
  /** The operator holds SOME role on the page. */
  userHasAccess: boolean;
  /** The raw task list — evidence, stored as-is. */
  userTasks: string[];
}

/**
 * Derive `bm_pages` access state from the operator's tasks on a page, as
 * returned by `GET /me/accounts?fields=id,name,tasks`. `undefined` means the
 * page did not appear in `/me/accounts` at all — no role.
 *
 * NOTE on `userHasAccess`: it stays "appears in /me/accounts at all", exactly as
 * migration 145 computed it, rather than becoming "has ADVERTISE". Tightening it
 * would silently re-flag every page where the operator holds only a read-ish
 * role, across ~50 BMs — a behaviour change this PR has no mandate for.
 */
export function derivePageAccessState(tasks: string[] | undefined): PageAccessState {
  if (!tasks) return { userHasAccess: false, userTasks: [] };
  return { userHasAccess: true, userTasks: tasks };
}

/**
 * The `tasks` array to POST when adding capabilities to a page.
 *
 * Returns the UNION of what the operator already holds and what is being added,
 * never the added tasks alone. `POST /{pageId}/assigned_users` SETS the task
 * list for that user on that asset, so posting `[X]` by itself is a request to
 * hold only X — which on a page already granted ADVERTISE would take advertising
 * away and stop live ad delivery. The union makes the call additive and
 * idempotent regardless of which semantics Meta applies, which matters most in
 * the bulk path across ~50 client BMs.
 *
 * Existing order is preserved and new tasks appended, so the payload is stable
 * and byte-diffable in tests.
 */
export function buildAdditiveTaskGrant(existingTasks: string[], addTasks: string[]): string[] {
  const out = [...existingTasks];
  for (const task of addTasks) {
    if (!out.includes(task)) out.push(task);
  }
  return out;
}

/**
 * Did a grant land? A SUPERSET check, never equality — Meta expands grants
 * (PR #726: one requested ADVERTISE on an IG asset read back as five tasks), so
 * requiring an exact match would report false failures.
 */
export function grantSatisfiedForPage(requested: string[], observed: string[]): boolean {
  return requested.every((task) => observed.includes(task));
}
