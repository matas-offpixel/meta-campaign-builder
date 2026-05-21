/**
 * lib/google-ads/campaign-writer-types.ts
 *
 * Client-safe types + tiny pure helpers shared between the Phase 3
 * push adapter and the wizard's Push step. Lives in its own module
 * so the client bundle never pulls in `client.ts` (which imports
 * `google-auth-library`, a Node-only dependency).
 *
 * The server-only writer (`./campaign-writer.ts`) re-exports these
 * types so existing server imports keep working.
 */

// ─── Result types ─────────────────────────────────────────────────────

export interface GoogleSearchPushResult {
  /** Plan-tree row id (UUID from Supabase). */
  localId: string;
  /** Google Ads REST resource name (e.g. `customers/.../campaigns/123`). */
  resourceName: string;
  /** Human-readable name as pushed (post `[event_code]` prefix). */
  name?: string;
  /**
   * True when the row already had `pushed_resource_name` set and we
   * skipped the create — no Google API write happened for this row.
   */
  reused?: boolean;
}

export interface GoogleSearchPushFailure {
  localId: string;
  name?: string;
  error: string;
  /** Human-readable scope, e.g. "C1 Brand → Brand ad group". */
  scope?: string;
}

export interface GoogleSearchLaunchSummary {
  ok: boolean;
  planId: string;
  /** Numeric Google Ads customer id (no dashes) — feeds the deep links. */
  customerId: string;
  campaignsCreated: GoogleSearchPushResult[];
  campaignsFailed: GoogleSearchPushFailure[];
  adGroupsCreated: GoogleSearchPushResult[];
  adGroupsFailed: GoogleSearchPushFailure[];
  keywordsCreated: GoogleSearchPushResult[];
  keywordsFailed: GoogleSearchPushFailure[];
  negativesCreated: GoogleSearchPushResult[];
  negativesFailed: GoogleSearchPushFailure[];
  rsasCreated: GoogleSearchPushResult[];
  rsasFailed: GoogleSearchPushFailure[];
  budgetsCreated: GoogleSearchPushResult[];
  /** Resource names removed during best-effort cleanup. */
  budgetsRolledBack: string[];
  campaignsRolledBack: string[];
  warnings: string[];
  /** True when at least one row failed (anywhere in the tree). */
  partialFailure: boolean;
  /**
   * True when the whole push aborted before completion (auth /
   * credentials failure, or an unexpected throw outside a per-campaign
   * try). The summary still contains whatever was created up to the
   * abort point.
   */
  aborted: boolean;
  abortReason?: string;
  /** The plan status the caller should persist. */
  planStatusUpdate: "pushed" | "partially_pushed" | "draft";
}

// ─── Pure helpers (safe in either bundle) ─────────────────────────────

/**
 * Numeric customer id form (no dashes) used by both REST URLs and
 * Google Ads UI deep links. Pure string manipulation — no auth or
 * network. Duplicated from `./oauth.ts` only because that module
 * pulls in `crypto`-using server code via its own imports.
 */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export function googleAdsCampaignDeepLink(
  resourceName: string,
  customerId: string,
): string | null {
  const match = resourceName.match(/campaigns\/(\d+)$/);
  if (!match) return null;
  return `https://ads.google.com/aw/campaigns?campaignId=${match[1]}&__e=${digitsOnly(customerId)}`;
}
