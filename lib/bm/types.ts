/**
 * lib/bm/types.ts
 *
 * Shared types for the Business Manager Asset Sync tool (V1 — Pages only).
 * Mirrors the migration-145 tables plus the API/UI view models.
 */

/** Meta page-user role. V1 grants ADVERTISER only (safe — runs ads, no owner-level destructive actions). */
export type BMPageRole = "ADVERTISER" | "ANALYST" | "EDITOR" | "ADMIN";

export const DEFAULT_GRANT_ROLE: BMPageRole = "ADVERTISER";

export type BMAccessAction = "granted" | "revoked" | "detected_new" | "sync_error";

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

/** Result of a bulk / single grant run. */
export interface GrantResult {
  businessId: string;
  attempted: number;
  granted: number;
  failed: number;
  batches: number;
  failures: { pageId: string; error: string }[];
  tokenExpired?: boolean;
}
