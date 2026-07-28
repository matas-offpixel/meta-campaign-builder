/**
 * lib/bm/types.ts
 *
 * Shared types for the Business Manager Asset Sync tool (V1 — Pages only).
 * Mirrors the migration-145 tables plus the API/UI view models.
 */

/** Meta page-user role. V1 grants ADVERTISER only (safe — runs ads, no owner-level destructive actions). */
export type BMPageRole = "ADVERTISER" | "ANALYST" | "EDITOR" | "ADMIN";

export const DEFAULT_GRANT_ROLE: BMPageRole = "ADVERTISER";


export type BMAccessAction =
  | "granted"
  | "revoked"
  | "detected_new"
  | "sync_error"
  | "rate_limited";

/** Row of client_business_managers (never carries the encrypted token). */
export interface BusinessManager {
  id: string;
  client_id: string | null;
  business_id: string;
  business_name: string | null;
  added_by_user_id: string | null;
  scopes: string[];
  token_expired: boolean;
  last_scanned_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Row of bm_pages. */
export interface BMPage {
  id: string;
  business_id: string;
  page_id: string;
  page_name: string | null;
  category: string | null;
  is_owned_by_bm: boolean;
  user_has_access: boolean;
  /**
   * The operator's real page tasks as read back from Meta (migration 149).
   * Evidence, not a verdict — `user_has_access` is only "holds some role", so
   * this is the field that says WHICH capabilities exist.
   */
  user_tasks: string[];
  /** Tasks the most recent grant asked for; compare against user_tasks to see what Meta did. */
  last_grant_requested_tasks: string[] | null;
  last_grant_at: string | null;
  followers: number | null;
  avatar_url: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/** A BM row decorated with summary counts for the list UI. */
export interface BusinessManagerSummary extends BusinessManager {
  client_name: string | null;
  total_pages: number;
  missing_access_count: number;
}

/** A newly-detected page joined with its BM/client context for the inbox cards. */
export interface DetectedNewPage {
  business_id: string;
  business_name: string | null;
  client_name: string | null;
  page_id: string;
  page_name: string | null;
  category: string | null;
  avatar_url: string | null;
  detected_at: string;
  user_has_access: boolean;
}

/** Result of a single scan run (cron or "Sync now"). */
export interface ScanResult {
  businessId: string;
  scannedPages: number;
  newPages: number;
  missingAccess: number;
  ok: boolean;
  error?: string;
}

/**
 * The parts of a grant run that are identical whether the assets were pages
 * (v1) or ad accounts / pixels / IG accounts (v2, migration 147). Extracted so
 * `isFullGrantSuccess` and `describeGrantResult` serve both without either
 * result type having to misuse the other's id field name.
 */
export interface GrantRunOutcome {
  attempted: number;
  granted: number;
  failed: number;
  batches: number;
  failures: { error: string }[];
  tokenExpired?: boolean;
  totalTargeted?: number;
  rateLimited?: boolean;
  retryAfterMinutes?: number;
}

/**
 * Result of a bulk / single grant run.
 *
 * Inherited from GrantRunOutcome and worth knowing about:
 *   - `totalTargeted` — the full intended set, which differs from `attempted`
 *     only when the run halted early. `attempted` counts what was actually tried.
 *   - `rateLimited` — the run halted because Meta's app/user/ad-account request
 *     quota was hit (#4/#17/#80004). It stops immediately rather than continuing
 *     to hammer an already-rejected quota window; see lib/bm/grant.ts and the
 *     2026-07-09 Columbo Group incident.
 *   - `retryAfterMinutes` — best-effort safe-retry estimate when rate limited.
 */
export interface GrantResult extends GrantRunOutcome {
  businessId: string;
  failures: { pageId: string; error: string }[];
}

/**
 * A grant run whose success is established by READ-BACK rather than by the POST
 * returning 200 (migration 149). `granted` counts accepted POSTs; `confirmed`
 * counts assets where Meta subsequently reported the requested tasks.
 */
export interface TaskGrantOutcome extends GrantRunOutcome {
  confirmed: number;
  /** The verification call failed. Grants may have landed; nothing was confirmed. */
  readBackFailed?: boolean;
  /** The task set that was requested, for the operator-facing message. */
  requestedTasks?: string[];
}

/**
 * True only when every attempted grant actually succeeded and the run
 * wasn't halted by a Meta rate limit. Used by the API routes to compute
 * their `ok` response field and by the dashboard to decide whether to show
 * a success or a partial-failure notice.
 *
 * Regression note (2026-07-09): `grant-all/route.ts` used to compute
 * `ok: !result.tokenExpired`, which is true even when every single grant
 * failed (e.g. the "Unknown path components" bug) — the UI showed a false
 * "Missing access resolved" toast while `missing_access_count` never
 * budged. `result.failed` must be part of the success signal.
 */
export function isFullGrantSuccess(result: GrantRunOutcome): boolean {
  return !result.tokenExpired && !result.rateLimited && result.failed === 0;
}

/**
 * Human-readable summary of a grant run, for API responses + UI notices.
 * `noun` names the asset type so v2 runs read "3/3 pixel(s)" rather than
 * claiming pages were granted.
 */
export function describeGrantResult(result: GrantRunOutcome, noun = "page"): string {
  if (result.tokenExpired) {
    return "Facebook token expired — reconnect required.";
  }
  if (result.rateLimited) {
    const total = result.totalTargeted ?? result.attempted;
    return (
      `Granted ${result.granted} of ${total} — Meta rate limit hit, ` +
      `retry in ~${result.retryAfterMinutes ?? 45} minutes.`
    );
  }
  if (result.attempted === 0) {
    return "Nothing to grant — already up to date.";
  }
  if (result.failed === 0) {
    return `Granted access on ${result.granted}/${result.attempted} ${noun}(s).`;
  }
  const firstError = result.failures[0]?.error;
  return (
    `Granted ${result.granted}/${result.attempted}. ${result.failed} failed` +
    (firstError ? `: ${firstError}` : ".")
  );
}

/**
 * Success for a task-grant run requires CONFIRMATION, not just accepted POSTs.
 * A page that reports a successful grant but still lacks the task in Meta's own
 * read-back is the exact silent-failure shape this arc keeps running into, and
 * PR #726 verified that Meta both expands and quietly reshapes grants. An
 * unverifiable run (read-back call failed) is therefore not a success either.
 */
export function isTaskGrantSuccess(result: TaskGrantOutcome): boolean {
  return (
    !result.tokenExpired &&
    !result.rateLimited &&
    !result.readBackFailed &&
    result.failed === 0 &&
    result.confirmed === result.attempted
  );
}

/** Human-readable summary of a task-grant run, for API responses + UI notices. */
export function describeTaskGrantResult(result: TaskGrantOutcome): string {
  const what = result.requestedTasks?.length ? result.requestedTasks.join(" + ") : "tasks";

  if (result.tokenExpired) {
    return "Facebook token expired — reconnect required.";
  }
  if (result.rateLimited) {
    const total = result.totalTargeted ?? result.attempted;
    return (
      `Granted ${what} on ${result.granted} of ${total} — Meta rate limit hit, ` +
      `retry in ~${result.retryAfterMinutes ?? 45} minutes.`
    );
  }
  if (result.attempted === 0) {
    return `Nothing to grant — every page already holds ${what}.`;
  }
  if (result.readBackFailed) {
    return (
      `Sent ${result.granted}/${result.attempted} grants of ${what} but could not verify them. ` +
      `Run Sync now to confirm before relying on these pages.`
    );
  }
  if (result.failed === 0 && result.confirmed === result.attempted) {
    return `${what} confirmed on ${result.confirmed}/${result.attempted} page(s).`;
  }
  // Accepted-but-unconfirmed is called out explicitly rather than folded into a
  // generic partial-failure message: Meta returning 200 while the capability is
  // still absent is a different problem from a call that errored, and it is the
  // one that previously went unnoticed.
  const firstError = result.failures[0]?.error;
  return (
    `Granted ${result.granted}/${result.attempted}, confirmed ${result.confirmed}.` +
    (result.failed > 0
      ? ` ${result.failed} failed${firstError ? `: ${firstError}` : "."}`
      : " Meta accepted the rest but has not reported the tasks yet — rerun Sync now.")
  );
}
