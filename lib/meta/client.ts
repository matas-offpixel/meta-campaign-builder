/**
 * lib/meta/client.ts
 *
 * Server-only Meta Graph API helper.
 * Import only from Route Handlers or Server Components — never from client
 * components (the access token is a server-side env var).
 */

import type {
  MetaAdAccount,
  MetaApiPage,
  MetaApiPageBatch,
  MetaApiPixel,
  MetaInstagramAccount,
  CampaignObjective,
} from "@/lib/types";
import { mapObjectiveToMeta } from "./campaign";
import type { MetaAdSetPayload, CreateAdSetsResult } from "./adset";
import type {
  MetaCreativePayload,
  MetaAdPayload,
} from "./creative";
import type { UploadAssetResult } from "./upload";

// ─── Config ──────────────────────────────────────────────────────────────────

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ─── Error class ─────────────────────────────────────────────────────────────

export class MetaApiError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly type?: string,
    public readonly fbtraceId?: string,
    public readonly subcode?: number,
    public readonly userMsg?: string,
    /** Full raw error object from Meta — may contain error_data with replacements */
    public readonly rawErrorData?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  /** Serialisable shape for JSON error responses */
  toJSON() {
    return {
      error: this.message,
      code: this.code,
      type: this.type,
      fbtrace_id: this.fbtraceId,
      ...(this.subcode !== undefined && { error_subcode: this.subcode }),
      ...(this.userMsg && { error_user_msg: this.userMsg }),
    };
  }
}

// ─── Core fetch helper ───────────────────────────────────────────────────────

interface GraphPagedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before: string; after: string };
    next?: string;
  };
}

/**
 * Low-level GET request against the Graph API.
 * Throws `MetaApiError` on API-level errors and on missing token.
 * Throws generic `Error` on network failure.
 */
export async function graphGet<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }
  return graphGetWithToken<T>(path, params, token);
}

/**
 * GET request against the Graph API with an explicit token.
 * Use when you want to call as the user (OAuth token) rather than the app token.
 */
export async function graphGetWithToken<T>(
  path: string,
  params: Record<string, string> = {},
  token: string,
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), { cache: "no-store" });
  } catch (err) {
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  return json as T;
}

// ─── POST helper ─────────────────────────────────────────────────────────────

/**
 * POST request against the Graph API with a JSON body.
 * The access token is appended as a URL query param (safe for server-side use).
 */
async function graphPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    // Log both the request payload and the full Meta error for easy debugging.
    // error_user_msg / error_user_title contain human-readable context from Meta.
    console.error(
      "[graphPost] Meta API error on", path,
      "\nRequest body:", JSON.stringify(body, null, 2),
      "\nMeta error response:", JSON.stringify(json, null, 2),
    );
    if (e.error_user_msg || e.error_user_title) {
      console.error(
        "[graphPost] Meta user message:",
        (e.error_user_msg ?? e.error_user_title) as string,
      );
    }
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
      e.error_subcode as number | undefined,
      (e.error_user_msg ?? e.error_user_title) as string | undefined,
      e as Record<string, unknown>,
    );
  }

  return json as T;
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/**
 * Fetch all ad accounts accessible to the token owner.
 * Requires: ads_read or ads_management permission.
 *
 * GET /me/adaccounts
 */
export async function fetchAdAccounts(): Promise<MetaAdAccount[]> {
  const res = await graphGet<GraphPagedResponse<MetaAdAccount>>(
    "/me/adaccounts",
    {
      fields: "id,name,account_id,currency,account_status,timezone_name,business",
      limit: "100",
    },
  );
  return res.data;
}

/**
 * Fetch the Business Manager ID that owns a given ad account.
 * Returns null if the account has no linked Business Manager or the lookup fails.
 * Requires: ads_read or ads_management permission.
 */
export async function fetchBusinessIdForAccount(
  adAccountId: string,
): Promise<string | null> {
  try {
    const res = await graphGet<{ business?: { id: string } }>(`/${adAccountId}`, {
      fields: "business",
    });
    return res.business?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch Facebook Pages for a Business Manager (if `businessId` is supplied)
 * or all pages the token owner personally manages via /me/accounts.
 *
 * Business pages: Requires business_management permission.
 * Personal pages: Requires pages_show_list permission.
 *
 * Returns up to 200 pages.
 */
export async function fetchPages(businessId?: string): Promise<MetaApiPage[]> {
  const fields = "id,name,fan_count,category,picture{url},instagram_business_account";

  if (businessId) {
    const res = await graphGet<GraphPagedResponse<MetaApiPage>>(
      `/${businessId}/owned_pages`,
      { fields, limit: "200" },
    );
    return res.data;
  }

  const res = await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", {
    fields,
    limit: "200",
  });
  return res.data;
}

// ─── Campaign listing (live, account-wide) ─────────────────────────────────

/**
 * Raw row returned by `GET /{ad_account_id}/campaigns`. Internal — the
 * `/api/meta/campaigns` route maps these to {@link MetaCampaignSummary}.
 */
export interface RawMetaCampaign {
  id: string;
  name: string;
  objective?: string;
  status?: string;
  effective_status?: string;
  buying_type?: string;
  created_time?: string;
  updated_time?: string;
}

export interface FetchCampaignsResult {
  data: RawMetaCampaign[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Cursor-paginated list of campaigns under an ad account. Used by the
 * "Add to existing campaign" picker.
 *
 * Filters via Meta's `effective_status` URL param (server-side filter, not
 * post-fetch) so the relevant view is cheap. When `nameContains` is set we
 * additionally apply `filtering=[{field:"name",operator:"CONTAIN",value}]`.
 *
 * Default sort: most recently updated first (`?date_preset` is unrelated;
 * we sort client-side after fetch since Meta doesn't expose a stable
 * orderBy for `/{ad_account}/campaigns`).
 *
 * Requires: ads_read or ads_management permission.
 */
export async function fetchCampaignsForAccount(params: {
  adAccountId: string;
  /** When `"relevant"`, request only ACTIVE + PAUSED campaigns. */
  filter?: "relevant" | "all";
  /** Optional case-insensitive substring match on campaign name. */
  nameContains?: string;
  /** Page size — capped at 50. */
  limit?: number;
  /** Pagination cursor returned by a previous call. */
  after?: string;
}): Promise<FetchCampaignsResult> {
  const {
    adAccountId,
    filter = "relevant",
    nameContains,
    limit = 25,
    after,
  } = params;

  const fields = [
    "id",
    "name",
    "objective",
    "status",
    "effective_status",
    "buying_type",
    "created_time",
    "updated_time",
  ].join(",");

  const queryParams: Record<string, string> = {
    fields,
    limit: String(Math.min(Math.max(1, limit), 50)),
  };

  // Server-side status filter for the "relevant" view. Meta accepts a JSON
  // array of effective_status values via the dedicated query param.
  if (filter === "relevant") {
    queryParams.effective_status = JSON.stringify(["ACTIVE", "PAUSED"]);
  }

  if (nameContains?.trim()) {
    queryParams.filtering = JSON.stringify([
      { field: "name", operator: "CONTAIN", value: nameContains.trim() },
    ]);
  }

  if (after) queryParams.after = after;

  const res = await graphGet<GraphPagedResponse<RawMetaCampaign>>(
    `/${adAccountId}/campaigns`,
    queryParams,
  );

  // Sort newest first by updated_time then created_time so the picker's
  // "recency" promise holds even when Meta returns a non-deterministic order.
  const sorted = [...(res.data ?? [])].sort((a, b) => {
    const aT = Date.parse(a.updated_time ?? a.created_time ?? "") || 0;
    const bT = Date.parse(b.updated_time ?? b.created_time ?? "") || 0;
    return bT - aT;
  });

  return {
    data: sorted,
    nextCursor: res.paging?.cursors?.after,
    hasMore: !!res.paging?.next,
  };
}

/**
 * Re-fetch a single live Meta campaign. Used by the launch route to
 * re-validate "Add to existing campaign" mode just before creating ad sets.
 * Returns `null` when the campaign no longer exists or the token can't see it.
 *
 * Requires: ads_read permission.
 */
export async function fetchCampaignById(
  campaignId: string,
): Promise<RawMetaCampaign | null> {
  try {
    const res = await graphGet<RawMetaCampaign>(`/${campaignId}`, {
      fields:
        "id,name,objective,status,effective_status,buying_type,created_time,updated_time",
    });
    return res ?? null;
  } catch {
    return null;
  }
}

// ─── Ad-set listing (live, scoped to a single campaign) ────────────────────

/**
 * Raw row returned by `GET /{campaign_id}/adsets`. Internal — the
 * `/api/meta/adsets` route maps these to {@link MetaAdSetSummary}.
 */
export interface RawMetaAdSet {
  id: string;
  name: string;
  campaign_id?: string;
  optimization_goal?: string;
  billing_event?: string;
  status?: string;
  effective_status?: string;
  created_time?: string;
  updated_time?: string;
}

export interface FetchAdSetsResult {
  data: RawMetaAdSet[];
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Cursor-paginated list of ad sets under a single campaign. Used by the
 * "Add to existing ad set" picker.
 *
 * Mirrors {@link fetchCampaignsForAccount}: server-side `effective_status`
 * filter for the relevant view, optional name CONTAIN filter, recency sort.
 *
 * Requires: ads_read or ads_management permission.
 */
export async function fetchAdSetsForCampaign(params: {
  campaignId: string;
  /** When `"relevant"`, request only ACTIVE + PAUSED ad sets. */
  filter?: "relevant" | "all";
  /** Optional case-insensitive substring match on ad set name. */
  nameContains?: string;
  /** Page size — capped at 50. */
  limit?: number;
  /** Pagination cursor returned by a previous call. */
  after?: string;
}): Promise<FetchAdSetsResult> {
  const {
    campaignId,
    filter = "relevant",
    nameContains,
    limit = 25,
    after,
  } = params;

  const fields = [
    "id",
    "name",
    "campaign_id",
    "optimization_goal",
    "billing_event",
    "status",
    "effective_status",
    "created_time",
    "updated_time",
  ].join(",");

  const queryParams: Record<string, string> = {
    fields,
    limit: String(Math.min(Math.max(1, limit), 50)),
  };

  if (filter === "relevant") {
    queryParams.effective_status = JSON.stringify(["ACTIVE", "PAUSED"]);
  }

  if (nameContains?.trim()) {
    queryParams.filtering = JSON.stringify([
      { field: "name", operator: "CONTAIN", value: nameContains.trim() },
    ]);
  }

  if (after) queryParams.after = after;

  const res = await graphGet<GraphPagedResponse<RawMetaAdSet>>(
    `/${campaignId}/adsets`,
    queryParams,
  );

  const sorted = [...(res.data ?? [])].sort((a, b) => {
    const aT = Date.parse(a.updated_time ?? a.created_time ?? "") || 0;
    const bT = Date.parse(b.updated_time ?? b.created_time ?? "") || 0;
    return bT - aT;
  });

  return {
    data: sorted,
    nextCursor: res.paging?.cursors?.after,
    hasMore: !!res.paging?.next,
  };
}

/**
 * Re-fetch a single live Meta ad set. Used by the launch route to verify
 * "Add to existing ad set" mode just before creating ads. Returns `null`
 * when the ad set no longer exists or the token can't see it.
 *
 * Requires: ads_read permission.
 */
export async function fetchAdSetById(
  adSetId: string,
): Promise<RawMetaAdSet | null> {
  try {
    const res = await graphGet<RawMetaAdSet>(`/${adSetId}`, {
      fields:
        "id,name,campaign_id,optimization_goal,billing_event,status,effective_status,created_time,updated_time",
    });
    return res ?? null;
  } catch {
    return null;
  }
}

/**
 * Cursor-paginated personal pages from /me/accounts.
 * Designed for the "Load more" flow — call repeatedly with the cursor returned
 * by each batch until `hasMore` is false.
 *
 * Requires: pages_show_list permission.
 *
 * @param after  Cursor string from the previous response (omit for the first batch).
 * @param limit  Page size — capped at 100.
 */
export async function fetchAdditionalPages(
  after?: string,
  limit = 50,
): Promise<MetaApiPageBatch> {
  const params: Record<string, string> = {
    fields: "id,name,fan_count,category,picture{url},instagram_business_account",
    limit: String(Math.min(limit, 100)),
  };
  if (after) params.after = after;

  const res = await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", params);

  return {
    data: res.data,
    nextCursor: res.paging?.cursors?.after ?? null,
    hasMore: !!res.paging?.next,
  };
}

/**
 * Fetch all Meta Pixels attached to a given ad account.
 * Requires: ads_read permission.
 *
 * GET /{adAccountId}/adspixels
 *
 * @param adAccountId - e.g. "act_1234567890"
 */
export async function fetchPixels(adAccountId: string): Promise<MetaApiPixel[]> {
  const res = await graphGet<GraphPagedResponse<MetaApiPixel>>(
    `/${adAccountId}/adspixels`,
    {
      fields: "id,name",
      limit: "100",
    },
  );
  return res.data;
}

/**
 * Fetch Instagram Business Accounts linked to all pages the token owner
 * manages — including BM-owned pages. Returns one entry per page that
 * has a linked IG account, deduplicated by IG ID.
 * Requires: pages_show_list + instagram_basic permissions.
 *
 * @param userToken Optional user OAuth `provider_token`. When supplied it's
 *                  used for the `/me/accounts` source instead of the system
 *                  token, which is critical for Pages the system user doesn't
 *                  manage (otherwise the IG link would be invisible and the
 *                  UI would falsely report "no linked Instagram account").
 *                  The BM `/owned_pages` source still uses the system token
 *                  because that endpoint is keyed off `META_BUSINESS_ID`.
 */
export async function fetchInstagramAccounts(
  userToken?: string,
): Promise<Array<MetaInstagramAccount & { linkedPageId: string }>> {
  type IgResult = MetaInstagramAccount & { linkedPageId: string };
  const seen = new Map<string, IgResult>();

  // Checks both instagram_business_account AND connected_instagram_account.
  // connected_instagram_account is populated when the user connected a personal
  // or creator IG account via Page Settings, rather than via BM / "Switch to
  // professional". Either field is valid as an IG engagement audience source.
  const extractIg = (pages: MetaApiPage[]) => {
    for (const page of pages) {
      const igBusiness = page.instagram_business_account as
        | (MetaInstagramAccount & { linkedPageId?: string })
        | undefined;
      const igConnected = page.connected_instagram_account as
        | (MetaInstagramAccount & { linkedPageId?: string })
        | undefined;

      const ig = igBusiness?.id ? igBusiness : igConnected?.id ? igConnected : undefined;
      if (!ig?.id) continue;

      if (!seen.has(ig.id)) {
        seen.set(ig.id, { ...ig, linkedPageId: page.id });
      }

      if (!igBusiness?.id && igConnected?.id) {
        console.info(
          `[fetchInstagramAccounts] page ${page.id} (${page.name}):` +
          ` instagram_business_account is null; using connected_instagram_account (id=${ig.id})`,
        );
      }
    }
  };

  // Fields include both IG connection types.
  const IG_FIELDS =
    "id,name," +
    "instagram_business_account{id,username,name,profile_picture_url}," +
    "connected_instagram_account{id,username,name,profile_picture_url}";

  // Source 1: personal token pages — prefer the user's OAuth token when
  // available so we see the same Pages the user sees in Ads Manager.
  // The system token's `/me/accounts` returns the System User's accounts,
  // which usually omits the Pages the end-user manages personally.
  const meAccountsToken = userToken ?? process.env.META_ACCESS_TOKEN;
  const meAccountsTokenSource = userToken ? "user" : "system";
  if (meAccountsToken) {
    try {
      const personal = await graphGetWithToken<GraphPagedResponse<MetaApiPage>>(
        "/me/accounts",
        { fields: IG_FIELDS, limit: "100" },
        meAccountsToken,
      );
      console.info(
        `[fetchInstagramAccounts] /me/accounts via ${meAccountsTokenSource} token` +
          ` returned ${personal.data?.length ?? 0} pages`,
      );
      extractIg(personal.data);
    } catch (err) {
      console.warn(
        `[fetchInstagramAccounts] /me/accounts via ${meAccountsTokenSource} token failed:`,
        err,
      );
    }
  } else {
    console.warn("[fetchInstagramAccounts] no token available for /me/accounts");
  }

  // Source 2: BM-owned pages (requires business_management permission)
  const businessId = process.env.META_BUSINESS_ID;
  if (businessId) {
    try {
      const bmPages = await graphGet<GraphPagedResponse<MetaApiPage>>(
        `/${businessId}/owned_pages`,
        { fields: IG_FIELDS, limit: "100" },
      );
      extractIg(bmPages.data);
    } catch (err) {
      console.warn("[fetchInstagramAccounts] BM owned_pages failed (may lack permission):", err);
    }
  }

  console.info(`[fetchInstagramAccounts] resolved ${seen.size} page→IG mappings`);
  return Array.from(seen.values());
}

// ─── Ad account diagnostics ──────────────────────────────────────────────────

/**
 * Fetch the tos_accepted field for an ad account to check whether the
 * Custom Audience Terms of Service have been accepted.
 * Returns a structured result — never throws.
 */
export async function fetchAdAccountTosStatus(
  adAccountId: string,
  token?: string,
): Promise<{
  fetched: boolean;
  customAudienceTos: boolean | null;
  rawTosAccepted: Record<string, unknown> | null;
  error?: string;
}> {
  const effectiveToken = token || process.env.META_ACCESS_TOKEN;
  if (!effectiveToken) {
    return { fetched: false, customAudienceTos: null, rawTosAccepted: null, error: "no token available" };
  }
  try {
    const res = await graphGetWithToken<{ tos_accepted?: Record<string, unknown> }>(
      `/${adAccountId}`,
      { fields: "tos_accepted" },
      effectiveToken,
    );
    const tos = res.tos_accepted ?? null;
    const accepted = tos ? (tos["custom_audience_tos"] === 1 || tos["custom_audience_tos"] === true) : null;
    return { fetched: true, customAudienceTos: accepted, rawTosAccepted: tos };
  } catch (err) {
    return {
      fetched: false,
      customAudienceTos: null,
      rawTosAccepted: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Engagement custom audience creation ────────────────────────────────────

export type EngagementAudienceType =
  | "fb_likes"
  | "fb_engagement_365d"
  | "ig_followers"
  | "ig_engagement_365d";

/**
 * Preference order for lookalike seeds. Higher-engagement audiences produce
 * better-quality lookalikes. Use `rankSeedsByPreference` to sort a seed list.
 */
export const LOOKALIKE_SOURCE_PREFERENCE: EngagementAudienceType[] = [
  "ig_engagement_365d",
  "fb_engagement_365d",
  "ig_followers",
  "fb_likes",
];

/**
 * A typed audience seed — carries the engagement type alongside the Meta ID
 * so Phase 1.75 can rank seeds by preference and log meaningful context.
 */
export interface TypedSeed {
  id: string;
  type: EngagementAudienceType;
  /** Whether this seed came from a prior run (persisted) vs. created this run */
  fromCache?: boolean;
}

/**
 * Sort seeds by the preference order defined in LOOKALIKE_SOURCE_PREFERENCE.
 * Higher-quality engagement audiences come first.
 */
export function rankSeedsByPreference(seeds: TypedSeed[]): TypedSeed[] {
  return [...seeds].sort((a, b) => {
    const ai = LOOKALIKE_SOURCE_PREFERENCE.indexOf(a.type);
    const bi = LOOKALIKE_SOURCE_PREFERENCE.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

/**
 * Readiness result returned by `checkAudienceReadiness`.
 *
 * Meta operation_status codes:
 *   200 = Normal / ready → ready = true
 *   400 = Processing     → ready = false, populating = false (short-term, retry OK)
 *   441 = Populating     → ready = false, populating = true  (long-term — defer, no retry)
 *   401 = Error          → ready = false, populating = false
 *   600 = Too small      → ready = false, populating = false
 */
export interface AudienceReadinessResult {
  ready: boolean;
  /**
   * True when Meta returns code 441 — "We're finding people who fit your
   * audience criteria…". The audience is being populated but will not be ready
   * for lookalike seeding for an extended period. Do NOT retry in the same launch.
   */
  populating: boolean;
  code: number;
  description: string;
}

/**
 * Check whether a custom audience is ready to seed a lookalike.
 * Returns null on API error (treat as not-ready, non-fatal).
 */
export async function checkAudienceReadiness(
  audienceId: string,
  token?: string,
): Promise<AudienceReadinessResult | null> {
  const effectiveToken = token || process.env.META_ACCESS_TOKEN;
  if (!effectiveToken) return null;
  try {
    const res = await graphGetWithToken<{
      id: string;
      operation_status?: { code: number; description: string };
      approximate_count_lower_bound?: number;
    }>(
      `/${audienceId}`,
      { fields: "id,operation_status,approximate_count_lower_bound" },
      effectiveToken,
    );
    const code = res.operation_status?.code ?? 200;
    const description = res.operation_status?.description ?? "Unknown";
    return {
      ready: code === 200,
      populating: code === 441,
      code,
      description,
    };
  } catch (err) {
    console.warn(`[checkAudienceReadiness] API error for ${audienceId}:`, err);
    return null;
  }
}

export interface EngagementAudienceSpec {
  type: EngagementAudienceType;
  name: string;
  /** Facebook Page ID (for fb_* types) or Instagram Account ID (for ig_* types) */
  sourceId: string;
  sourceType: "page" | "ig_business";
  /**
   * User-level Facebook OAuth token (provider_token from Supabase OAuth).
   * When provided, preferred over META_ACCESS_TOKEN so the call runs in the
   * same permission context as the user's Ads Manager session.
   */
  userToken?: string;
  /** For diagnostics only — the FB page ID this audience is associated with */
  pageId?: string;
  /** For diagnostics only — the page name */
  pageName?: string;
}

/**
 * Sanitize an audience name for Meta's Custom Audience API.
 * Must be ≤ 50 chars, alphanumeric + underscores + spaces only.
 */
function sanitizeAudienceName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_ ]/g, "").slice(0, 50).trim();
}

/**
 * Build the rule JSON for engagement custom audiences.
 *
 * Based on the official Meta docs:
 *   https://developers.facebook.com/docs/marketing-api/audiences/guides/engagement-custom-audiences/
 *
 * Key requirements:
 *   1. Every rule MUST have a `filter` block with `field: "event"`.
 *   2. Do NOT include `object_id` in the rule — it's not part of the JSON schema.
 *   3. Do NOT include `subtype` — deprecated since Sep 2018 for engagement audiences.
 *   4. Send via form-encoded POST (`-F` / `application/x-www-form-urlencoded`).
 */

/** Map our internal engagement type → Meta event value + source type */
function getEngagementEventConfig(spec: EngagementAudienceSpec): {
  eventValue: string;
  retentionSeconds: number;
  supported: true;
} | { supported: false; reason: string } {
  switch (spec.type) {
    case "fb_likes":
      return { eventValue: "page_liked", retentionSeconds: 0, supported: true };
    case "fb_engagement_365d":
      return { eventValue: "page_engaged", retentionSeconds: 31536000, supported: true };
    case "ig_followers":
      return { eventValue: "ig_business_profile_all", retentionSeconds: 0, supported: true };
    case "ig_engagement_365d":
      return { eventValue: "ig_business_profile_all", retentionSeconds: 31536000, supported: true };
  }
}

function buildEngagementFormParams(
  spec: EngagementAudienceSpec,
): Record<string, string> | { unsupported: true; reason: string } {
  const config = getEngagementEventConfig(spec);
  if (!config.supported) return { unsupported: true, reason: config.reason };

  const safeName = sanitizeAudienceName(spec.name);

  const ruleObj = {
    inclusions: {
      operator: "or",
      rules: [{
        event_sources: [{ type: spec.sourceType, id: spec.sourceId }],
        retention_seconds: config.retentionSeconds,
        filter: {
          operator: "and",
          filters: [{
            field: "event",
            operator: "eq",
            value: config.eventValue,
          }],
        },
      }],
    },
  };

  return {
    name: safeName,
    rule: JSON.stringify(ruleObj),
    prefill: "1",
  };
}

/**
 * Create an Engagement Custom Audience in the given ad account.
 *
 * Uses form-encoded POST (application/x-www-form-urlencoded) because the
 * Graph API custom audience endpoint requires `rule` as a URL-encoded JSON
 * string. Sending it via JSON body (Content-Type: application/json) causes
 * "Invalid rule JSON format" errors.
 *
 * POST /{adAccountId}/customaudiences
 *
 * Returns the created audience ID, or throws if creation fails.
 * Requires: ads_management permission.
 */
export async function createEngagementAudience(
  adAccountId: string,
  spec: EngagementAudienceSpec,
): Promise<{ id: string }> {
  // ── Token selection ────────────────────────────────────────────────────────
  // Prefer the user's OAuth token (provider_token) over the static server token.
  // The user token runs in the same permission context as Ads Manager, which is
  // required for event-source audience creation on pages the user manages.
  const systemToken = process.env.META_ACCESS_TOKEN;
  const token = spec.userToken || systemToken;
  const tokenSource = spec.userToken
    ? `user-oauth-token (len=${spec.userToken.length}, prefix=${spec.userToken.slice(0, 10)}…)`
    : systemToken
      ? `META_ACCESS_TOKEN/system (len=${systemToken.length}, prefix=${systemToken.slice(0, 10)}…)`
      : "MISSING";

  if (!token) {
    throw new MetaApiError(
      "No access token available — META_ACCESS_TOKEN is not set and no user token was provided.",
    );
  }

  const paramsOrUnsupported = buildEngagementFormParams(spec);
  if ("unsupported" in paramsOrUnsupported) {
    throw new MetaApiError(
      `Audience type "${spec.type}" is not supported: ${paramsOrUnsupported.reason}`,
    );
  }

  const params = paramsOrUnsupported;
  const endpoint = `${BASE}/${adAccountId}/customaudiences`;

  // ── Full pre-attempt context log ──────────────────────────────────────────
  console.log(
    `[createEngagementAudience] ▶ Attempt` +
    `\n  adAccountId:  ${adAccountId}` +
    `\n  pageId:       ${spec.pageId ?? "(not set)"}` +
    `\n  pageName:     ${spec.pageName ?? "(not set)"}` +
    `\n  audienceType: ${spec.type}` +
    `\n  tokenSource:  ${tokenSource}` +
    `\n  sourceType:   ${spec.sourceType}` +
    `\n  sourceId:     ${spec.sourceId}` +
    `\n  sourceIdIsPageId: ${spec.sourceId === spec.pageId}` +
    `\n  endpoint:     POST ${endpoint}` +
    `\n  formParams:   name=${params.name} | prefill=${params.prefill}` +
    `\n  rule:         ${params.rule}`,
  );

  const url = new URL(endpoint);
  url.searchParams.set("access_token", token);

  const formBody = new URLSearchParams(params);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    console.error(
      `[createEngagementAudience] ✗ Meta API error` +
      `\n  adAccountId:    ${adAccountId}` +
      `\n  pageId:         ${spec.pageId ?? "(not set)"}` +
      `\n  audienceType:   ${spec.type}` +
      `\n  tokenSource:    ${tokenSource}` +
      `\n  sourceType:     ${spec.sourceType}` +
      `\n  sourceId:       ${spec.sourceId}` +
      `\n  formParams:     ${JSON.stringify(params)}` +
      `\n  rawMetaError:   ${JSON.stringify(json)}`,
    );
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
      e.error_subcode as number | undefined,
      (e.error_user_msg ?? e.error_user_title) as string | undefined,
      e as Record<string, unknown>,
    );
  }

  const result = json as { id: string };
  console.log(
    `[createEngagementAudience] ✓ Created "${params.name}" → ${result.id}` +
    ` | tokenSource: ${tokenSource}`,
  );

  return result;
}

// ─── Lookalike Audience Creation ────────────────────────────────────────────

export interface LookalikeAudienceSpec {
  name: string;
  originAudienceId: string;
  /** e.g. "0-1%" → startingRatio=0, endingRatio=0.01 */
  startingRatio: number;
  endingRatio: number;
  /** ISO-2 country code for lookalike seed expansion, e.g. "GB" */
  country: string;
}

export async function createLookalikeAudience(
  adAccountId: string,
  spec: LookalikeAudienceSpec,
): Promise<{ id: string }> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    throw new MetaApiError("META_ACCESS_TOKEN is not configured. Add it to .env.local.");
  }

  const params: Record<string, string> = {
    name: spec.name,
    subtype: "LOOKALIKE",
    origin_audience_id: spec.originAudienceId,
    lookalike_spec: JSON.stringify({
      type: "custom_ratio",
      starting_ratio: spec.startingRatio,
      ending_ratio: spec.endingRatio,
      country: spec.country,
    }),
  };

  console.log(
    `[createLookalikeAudience] Creating "${spec.name}" from origin ${spec.originAudienceId}` +
    ` (${spec.startingRatio}-${spec.endingRatio}, ${spec.country}) in ${adAccountId}` +
    `\n  Full params: ${JSON.stringify(params, null, 2)}`,
  );

  const url = new URL(`${BASE}/${adAccountId}/customaudiences`);
  url.searchParams.set("access_token", token);

  const formBody = new URLSearchParams(params);

  // Hard 8-second timeout per request — fail fast instead of blocking launch
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody.toString(),
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new MetaApiError("Lookalike creation timed out (8s limit — source audience likely not ready)");
    }
    throw new Error(`Network error calling Meta API: ${String(err)}`);
  } finally {
    clearTimeout(timeout);
  }

  const json = (await response.json()) as Record<string, unknown>;

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    const code = e.code as number | undefined;
    const subcode = e.error_subcode as number | undefined;
    const msg = (e.message as string) ?? `HTTP ${response.status}`;

    console.error(
      "[createLookalikeAudience] Meta API error:",
      "\n  adAccountId:", adAccountId,
      "\n  code:", code, "subcode:", subcode,
      "\n  Meta error response:", JSON.stringify(json, null, 2),
    );

    // Subcode 1713007 = duplicate lookalike (same source + country + size)
    if (subcode === 1713007) {
      throw new MetaApiError(
        `Duplicate lookalike already exists for this source/country/size: ${msg}`,
        code, e.type as string | undefined, e.fbtrace_id as string | undefined,
        subcode, (e.error_user_msg ?? e.error_user_title) as string | undefined,
      );
    }

    // Code 2654 = source audience not ready — fail fast, no retries
    if (code === 2654) {
      throw new MetaApiError(
        `Source audience not ready for lookalike creation: ${msg}`,
        code, e.type as string | undefined, e.fbtrace_id as string | undefined,
        subcode, (e.error_user_msg ?? e.error_user_title) as string | undefined,
      );
    }

    throw new MetaApiError(
      msg, code, e.type as string | undefined, e.fbtrace_id as string | undefined,
      subcode, (e.error_user_msg ?? e.error_user_title) as string | undefined,
    );
  }

  const result = json as { id: string };
  console.log(
    `[createLookalikeAudience] ✓ Created "${spec.name}" → ${result.id} in ${adAccountId}`,
  );
  return result;
}

/** Parse a LookalikeRange like "0-1%" into { startingRatio, endingRatio } */
export function parseLookalikeRange(range: string): { startingRatio: number; endingRatio: number } {
  const m = range.match(/^(\d+)-(\d+)%$/);
  if (!m) return { startingRatio: 0, endingRatio: 0.01 };
  return {
    startingRatio: parseInt(m[1], 10) / 100,
    endingRatio: parseInt(m[2], 10) / 100,
  };
}

/**
 * Create a single ad set under the given ad account.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adsets
 */
export async function createMetaAdSet(
  adAccountId: string,
  payload: MetaAdSetPayload,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/adsets`,
    payload as unknown as Record<string, unknown>,
  );
}

/**
 * Create multiple ad sets under a given ad account, one request per ad set.
 * Failures are isolated — a bad ad set does not abort the rest of the batch.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adsets  (once per ad set, campaign_id in payload)
 */
export async function createMetaAdSets(
  adAccountId: string,
  payloads: MetaAdSetPayload[],
): Promise<CreateAdSetsResult> {
  const created: CreateAdSetsResult["created"] = [];
  const failed: CreateAdSetsResult["failed"] = [];

  for (const payload of payloads) {
    try {
      const { id } = await graphPost<{ id: string }>(
        `/${adAccountId}/adsets`,
        payload as unknown as Record<string, unknown>,
      );
      created.push({ name: payload.name, metaAdSetId: id });
    } catch (err) {
      const message =
        err instanceof MetaApiError
          ? err.message
          : `Unexpected error: ${String(err)}`;
      failed.push({ name: payload.name, error: message });
    }
  }

  return { created, failed };
}

/**
 * Create a single ad creative under the given ad account.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adcreatives
 */
export async function createMetaCreative(
  adAccountId: string,
  payload: MetaCreativePayload,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/adcreatives`,
    payload as unknown as Record<string, unknown>,
  );
}

/**
 * Create a single ad under the given ad account.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/ads
 */
export async function createMetaAd(
  adAccountId: string,
  payload: MetaAdPayload,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/ads`,
    payload as unknown as Record<string, unknown>,
  );
}

// ─── Asset upload helpers ─────────────────────────────────────────────────────

/**
 * Upload an image file to a Meta ad account's image library.
 *
 * Matches the working curl pattern exactly:
 *   curl -F "access_token=TOKEN" -F "filename=@photo.jpg" .../adimages
 *
 * Field name is the literal string "filename" — Meta reads the actual image
 * name from the Content-Disposition `filename=` attribute, not from the field
 * name. Using `images[name]` bracket notation can be mishandled by Node.js's
 * FormData serialiser.
 *
 * The access token goes in the form body (not the URL) to match curl and to
 * keep the token out of server access logs.
 *
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/adimages
 */
export async function uploadImageAsset(
  adAccountId: string,
  file: Blob,
  filename: string,
): Promise<Pick<UploadAssetResult, "url" | "hash">> {
  const token = process.env.META_ACCESS_TOKEN;

  // ── Debug logging ───────────────────────────────────────────────────────
  const fileTyped = file as { type?: string; name?: string };
  console.log("[uploadImageAsset] pre-upload:", {
    filename,
    mimeType: fileTyped.type ?? "(unknown)",
    sizeBytes: file.size,
    adAccountId,
    token_present: !!token,
    token_prefix: token ? token.slice(0, 12) : "(missing)",
  });

  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  // Sanitise filename — keep only URL-safe characters so it survives as a
  // multipart Content-Disposition attribute without encoding issues.
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.jpg";

  const formData = new FormData();
  // access_token in the form body — matches curl -F "access_token=TOKEN"
  formData.append("access_token", token);
  // "filename" as the literal field name — matches curl -F "filename=@photo.jpg"
  // The real image name travels in Content-Disposition; field name is irrelevant.
  formData.append("filename", file, safeFilename);

  const endpoint = `${BASE}/${adAccountId}/adimages`;

  let response: Response;
  try {
    // No `cache` option — POST requests are not cached by default and passing
    // cache options on FormData bodies can corrupt the multipart stream in
    // Next.js's extended fetch layer.
    response = await fetch(endpoint, { method: "POST", body: formData });
  } catch (err) {
    throw new Error(`Network error uploading image to Meta: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  console.log("[uploadImageAsset] Meta response:", JSON.stringify(json, null, 2));

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  // Response shape: { images: { "<filename>": { hash, url, width, height } } }
  const images = json.images as Record<string, { hash: string; url: string }>;
  const imageData = Object.values(images)[0];
  if (!imageData) {
    console.error("[uploadImageAsset] Unexpected response — no images key:", json);
    throw new MetaApiError("Meta returned an empty images response");
  }

  console.log("[uploadImageAsset] success — hash:", imageData.hash);
  return { hash: imageData.hash, url: imageData.url };
}

/**
 * Upload a video file to a Meta ad account's video library.
 * Uses multipart/form-data with field name `video_data`.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/advideos
 */
export async function uploadVideoAsset(
  adAccountId: string,
  file: Blob,
  filename: string,
): Promise<Pick<UploadAssetResult, "videoId" | "previewUrl">> {
  const token = process.env.META_ACCESS_TOKEN;

  // ── Debug logging ───────────────────────────────────────────────────────
  const fileTyped = file as { type?: string; name?: string };
  console.log("[uploadVideoAsset] pre-upload:", {
    filename,
    mimeType: fileTyped.type ?? "(unknown)",
    sizeBytes: file.size,
    sizeMB: (file.size / 1024 / 1024).toFixed(2),
    adAccountId,
    token_present: !!token,
    token_prefix: token ? token.slice(0, 12) : "(missing)",
  });

  if (!token) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.mp4";

  // ── Build multipart payload ────────────────────────────────────────────
  // Meta /advideos expects:
  //   - access_token in the form body (same pattern as /adimages)
  //   - source      as the video file field (NOT "video_data")
  //   - title       optional display name
  const formData = new FormData();
  formData.append("access_token", token);
  formData.append("source", file, safeFilename);
  formData.append("title", safeFilename.replace(/\.[^.]+$/, ""));

  const endpoint = `${BASE}/${adAccountId}/advideos`;

  let response: Response;
  try {
    response = await fetch(endpoint, { method: "POST", body: formData });
  } catch (err) {
    throw new Error(`Network error uploading video to Meta: ${String(err)}`);
  }

  const json = (await response.json()) as Record<string, unknown>;
  console.log("[uploadVideoAsset] Meta response:", JSON.stringify(json, null, 2));

  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
    );
  }

  console.log("[uploadVideoAsset] success — videoId:", json.id ?? json.video_id);
  return {
    videoId: (json.id ?? json.video_id) as string,
    previewUrl: (json.picture as string) ?? (json.preview_image_url as string) ?? "",
  };
}

/**
 * Create a new campaign under the given ad account.
 * Always created as PAUSED — never goes live automatically.
 * Requires: ads_management permission.
 *
 * POST /{adAccountId}/campaigns
 */
export async function createMetaCampaign(params: {
  adAccountId: string;
  name: string;
  objective: CampaignObjective;
  status?: "ACTIVE" | "PAUSED";
}): Promise<{ id: string }> {
  const { adAccountId, name, objective, status = "PAUSED" } = params;

  // Minimal valid payload — only fields that belong at campaign level.
  // buying_type is required by Meta; omitting it triggers code 100 "Invalid parameter".
  // is_adset_budget_sharing_enabled: false = ad-set-level budgets (not campaign budget optimisation).
  // special_ad_categories must be present (empty array = no special category restrictions).
  const payload = {
    name,
    objective: mapObjectiveToMeta(objective),
    buying_type: "AUCTION",
    status,
    is_adset_budget_sharing_enabled: false,
    special_ad_categories: [],
  };

  console.log(
    "[createMetaCampaign] Sending payload to",
    `/${adAccountId}/campaigns`,
    JSON.stringify(payload, null, 2),
  );

  return graphPost<{ id: string }>(`/${adAccountId}/campaigns`, payload);
}
