import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/db/database.types";
import { getOwnerFacebookToken, type ResolvedShare } from "@/lib/db/report-shares";
import {
  fetchActiveCreativesForEvent,
  FacebookAuthExpiredError,
} from "@/lib/reporting/active-creatives-fetch";
import {
  groupByAssetSignature,
  type ConceptGroupRow,
} from "@/lib/reporting/group-creatives";

/**
 * lib/reporting/share-active-creatives.ts
 *
 * Server-only helper that builds the "Active creatives" payload
 * for the public share page. Mirrors the internal API route but:
 *
 *   - Uses the OWNER's Facebook token (resolved via the
 *     service-role Supabase client + `getOwnerFacebookToken`),
 *     never the visitor's session — share routes don't have one.
 *   - Applies the second-layer concept grouping
 *     (`groupByAssetSignature`) so re-uploaded creatives — including
 *     headless / numeric-name re-uploads, and Advantage+ asset-feed
 *     variants — collapse into one card on the client-facing report.
 *   - Caps output at 30 groups (defensive — a single event almost
 *     never crosses this, but a mis-tagged account dump shouldn't
 *     blow up the share render).
 *
 * Returns a discriminated union so the share page can render the
 * happy-path section, an empty state, or a muted "unavailable"
 * note without `try/catch`-around-component plumbing.
 */

const SHARE_GROUPS_CAP = 30;

export type ShareActiveCreativesResult =
  | {
      kind: "ok";
      groups: ConceptGroupRow[];
      ad_account_id: string;
      event_code: string;
      fetched_at: string;
      meta: {
        campaigns_total: number;
        campaigns_failed: number;
        ads_fetched: number;
        dropped_no_creative: number;
        truncated: boolean;
      };
    }
  | {
      // Soft-skip: this event genuinely has nothing to show. Caller
      // should hide the section entirely (no muted note needed).
      kind: "skip";
      reason: "no_event_code" | "no_ad_account" | "no_linked_campaigns";
    }
  | {
      // Hard failure (token expired, Meta upstream error, etc).
      // Caller renders the muted "Creative breakdown unavailable"
      // note instead of 500-ing the whole share page.
      kind: "error";
      reason: "auth_expired" | "meta_failed" | "no_owner_token";
      message: string;
    };

interface FetchInput {
  share: ResolvedShare;
  admin: SupabaseClient<Database>;
  /** Pulled from the share page's existing event lookup. */
  eventCode: string | null;
  /** Pulled from the share page's existing client lookup. */
  adAccountId: string | null;
}

/**
 * Fetch + concept-group active creatives for an event-scope share.
 *
 * Caller is responsible for filtering out client-scope shares
 * before calling — those don't carry a single event_id and the
 * share page treats them as 404 anyway.
 */
export async function fetchShareActiveCreatives(
  input: FetchInput,
): Promise<ShareActiveCreativesResult> {
  if (input.share.scope !== "event") {
    // Defensive guard — caller already filters, but the type
    // narrowing here lets the rest of the function treat
    // `share.user_id` as a non-null string without `!`.
    return {
      kind: "skip",
      reason: "no_linked_campaigns",
    };
  }

  if (!input.eventCode) {
    return { kind: "skip", reason: "no_event_code" };
  }
  if (!input.adAccountId) {
    return { kind: "skip", reason: "no_ad_account" };
  }

  const ownerToken = await getOwnerFacebookToken(
    input.share.user_id,
    input.admin,
  );
  if (!ownerToken) {
    return {
      kind: "error",
      reason: "no_owner_token",
      message: "Owner has not connected Facebook (or token expired).",
    };
  }

  let result;
  try {
    result = await fetchActiveCreativesForEvent({
      adAccountId: input.adAccountId,
      eventCode: input.eventCode,
      token: ownerToken,
      // Sequential per-campaign fans-out — slower by ~2-3× on wide
      // events than the internal panel's default of 3, but leaves
      // half the per-account rate budget for the headline insights
      // call running in parallel from the share RSC. Without this
      // last_7d on a wide event tips both calls into 5xx + network-
      // error retries and the whole report errors out.
      concurrency: 1,
    });
  } catch (err) {
    if (err instanceof FacebookAuthExpiredError) {
      return {
        kind: "error",
        reason: "auth_expired",
        message: "Owner's Facebook session expired.",
      };
    }
    return {
      kind: "error",
      reason: "meta_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (result.meta.campaigns_total === 0) {
    return { kind: "skip", reason: "no_linked_campaigns" };
  }

  const allGroups = groupByAssetSignature(result.creatives);
  const groups = allGroups.slice(0, SHARE_GROUPS_CAP);

  return {
    kind: "ok",
    groups,
    ad_account_id: result.ad_account_id,
    event_code: input.eventCode,
    fetched_at: new Date().toISOString(),
    meta: {
      campaigns_total: result.meta.campaigns_total,
      campaigns_failed: result.meta.campaigns_failed,
      ads_fetched: result.meta.ads_fetched,
      dropped_no_creative: result.meta.dropped_no_creative,
      // Either Meta-side trim (>200 creative_ids before grouping)
      // or share-side trim (>30 concept groups after grouping)
      // counts as truncated for the caveat note.
      truncated: result.meta.truncated || allGroups.length > SHARE_GROUPS_CAP,
    },
  };
}
