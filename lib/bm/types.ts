/**
 * lib/bm/types.ts
 *
 * Shared types for the Business Manager Asset Sync tool (V1 — Pages only).
 * Mirrors the migration-145 tables plus the API/UI view models.
 */

/** Meta page-user role. V1 grants ADVERTISER only (safe — runs ads, no owner-level destructive actions). */
export type BMPageRole = "ADVERTISER" | "ANALYST" | "EDITOR" | "ADMIN";

export const DEFAULT_GRANT_ROLE: BMPageRole = "ADVERTISER";

/**
 * What a page grant is FOR.
 *
 * Pages carry two INDEPENDENT capabilities on the same assigned_users edge:
 * running ads (the ADVERTISE task, v1's only grant) and seeding audiences (the
 * audience task, migration 148). They are granted separately and tracked in
 * separate columns, so every page-grant call has to say which it means rather
 * than assuming ADVERTISE.
 */
export type BMPageGrantIntent = "advertise" | "audience";

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
   * Audience-seed access — a SEPARATE Meta task from ADVERTISE (migration 148).
   * A page can be true for `user_has_access` and false here, which is exactly
   * the state that makes the wizard's audience builder skip it (subcode 1713140).
   */
  user_has_audience_access: boolean;
  /** The operator's real page tasks, as read back from Meta. Evidence for both flags above. */
  user_tasks: string[];
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
  /** Pages lacking the audience task — counted separately from missing_access_count. */
  missing_audience_access_count: number;
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
  /** Pages lacking the audience task (migration 148) — tracked alongside, never merged in. */
  missingAudienceAccess: number;
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
 * returning 200 (the migration-148 audience grants). `granted` counts accepted
 * POSTs; `confirmed` counts pages where Meta subsequently reported the task.
 */
export interface AudienceGrantOutcome extends GrantRunOutcome {
  confirmed: number;
  /** The verification call failed. Grants may have landed; nothing was confirmed. */
  readBackFailed?: boolean;
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
 * Success for an audience-grant run requires CONFIRMATION, not just accepted
 * POSTs — a page that reports a successful grant but still lacks the task in
 * Meta's own read-back is precisely the silent failure this PR exists to stop.
 * An unverifiable run (read-back call failed) is therefore not a success either.
 */
export function isAudienceGrantSuccess(result: AudienceGrantOutcome): boolean {
  return (
    !result.tokenExpired &&
    !result.rateLimited &&
    !result.readBackFailed &&
    result.failed === 0 &&
    result.confirmed === result.attempted
  );
}

/** Human-readable summary of an audience-grant run, for API responses + UI notices. */
export function describeAudienceGrantResult(result: AudienceGrantOutcome): string {
  if (result.tokenExpired) {
    return "Facebook token expired — reconnect required.";
  }
  if (result.rateLimited) {
    const total = result.totalTargeted ?? result.attempted;
    return (
      `Granted audience access on ${result.granted} of ${total} — Meta rate limit hit, ` +
      `retry in ~${result.retryAfterMinutes ?? 45} minutes.`
    );
  }
  if (result.attempted === 0) {
    return "Nothing to grant — every page already has audience access.";
  }
  if (result.readBackFailed) {
    return (
      `Sent ${result.granted}/${result.attempted} audience grants but could not verify them. ` +
      `Run Sync now to confirm before relying on these pages as audience seeds.`
    );
  }
  if (result.failed === 0 && result.confirmed === result.attempted) {
    return `Audience access confirmed on ${result.confirmed}/${result.attempted} page(s).`;
  }
  // Accepted-but-unconfirmed is called out explicitly: it is the shape of the
  // original bug (Meta reports success, the audience call still gets refused).
  const firstError = result.failures[0]?.error;
  return (
    `Granted ${result.granted}/${result.attempted}, confirmed ${result.confirmed}.` +
    (result.failed > 0
      ? ` ${result.failed} failed${firstError ? `: ${firstError}` : "."}`
      : " Meta accepted the rest but has not reported the task yet — rerun Sync now.")
  );
}
