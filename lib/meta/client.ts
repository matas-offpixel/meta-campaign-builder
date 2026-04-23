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
 *
 * Includes a small internal retry loop for transient failures — see
 * {@link TRANSIENT_META_CODES} / {@link RATE_LIMIT_META_CODES} and
 * {@link executeGetWithRetry} below.
 * Read paths only: POST helpers do NOT retry (single-shot to avoid
 * double-creating campaigns / ad sets / audiences).
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
  return executeGetWithRetry<T>(url, path);
}

// ─── GET retry internals ─────────────────────────────────────────────────────
//
// Why the heatmap was crashing: `fetchCreativeInsights` pages up to 20×
// through this helper (100 ads/page). A single transient 5xx or
// rate-limit blip from Meta would propagate `MetaApiError("Service
// temporarily unavailable")` straight up to the route, killing the
// whole load even though the next call would have succeeded.
//
// Retry policy (split, per `getRetryBudget`):
//   - Genuine transient errors (network, HTTP 5xx, meta_code in
//     TRANSIENT_META_CODES — currently just 1): up to 4 retries.
//     Backoff schedule (ms, ±25% jitter): 500 → 1500 → 4000 → 8000 →
//     12000. Cumulative ceiling ~26s.
//   - Rate-limit / back-pressure (HTTP 429, meta_code in
//     RATE_LIMIT_META_CODES — 2/4/17/32/341/613): one retry only,
//     after a fixed 10s delay. More than that risks turning a soft
//     code=2 into a hard code=80004 hourly lockout when parallel
//     callers all retry against the same account budget.
//   - Everything else (auth, validation, permissions): single-shot,
//     surfaced as MetaApiError.
//   - `Retry-After` header (when present) overrides the computed
//     backoff for that attempt, capped at 10s so a misbehaving server
//     can't pin a request open for a minute.
//   - GET-only on purpose. POST mutations stay single-shot.

const MAX_GET_ATTEMPTS = 5;
const BASE_BACKOFFS_MS = [500, 1500, 4000, 8000, 12000];
const RETRY_AFTER_CAP_MS = 10_000;

/**
 * Meta error codes that are safe to retry, split by retry policy.
 *
 *   1   — Unknown / transient API error
 *   2   — "Service temporarily unavailable"
 *   4   — Application request limit reached
 *   17  — User request limit reached
 *   32  — Page request limit reached
 *   341 — Application request limit reached (alt code surfaced on some edges)
 *   613 — Custom audiences / ads rate limit
 *
 * Outside both sets (auth, permissions, validation, etc.) retrying is
 * pointless and will just waste time + budget.
 */
// Genuine transient errors — worth retrying with the full backoff
// schedule. Server blips, unknown failures, network-level issues.
const TRANSIENT_META_CODES = new Set<number>([1]);
// Rate-limit / back-pressure codes — Meta is explicitly telling us
// to slow down. Retrying more than once burns more of the account's
// hourly request budget and can escalate a soft meta_code=2/4/17
// to a hard code=80004 lockout (~60 min recovery). Allow a single
// retry with a long delay so we still recover from brief spikes,
// but fail fast if the back-pressure persists. Code 2 ("service
// temporarily unavailable") is included here rather than in the
// transient set because in practice we see it in rate-limit
// cascades, not one-off server blips.
const RATE_LIMIT_META_CODES = new Set<number>([2, 4, 17, 32, 341, 613]);

interface ParsedMetaError {
  message: string;
  code?: number;
  type?: string;
  fbtraceId?: string;
  /**
   * Meta's `error_subcode` — supplements `code` for a few error
   * families (e.g. duplicate-lookalike 1713007). Surfaced through
   * `MetaApiError.subcode` so callers branching on subcode get the
   * full picture from the GET retry path too (POST helpers already
   * propagated this).
   */
  subcode?: number;
  /**
   * Concatenation of Meta's `error_user_title` + `error_user_msg`
   * (whichever are populated). For some errors — most importantly
   * the "reduce the amount of data" compute-budget rejection —
   * Meta's `message` field is a generic "An unknown error
   * occurred" and the actionable phrase ONLY appears here. Without
   * propagating this field the day-chunked fallback in
   * `lib/insights/meta.ts` could never trigger because
   * `isReduceDataError` had nothing to regex against.
   */
  userMsg?: string;
  /**
   * Full raw `error` object as Meta returned it. JSON-stringified
   * by the classifier as a last-resort substring check, and useful
   * in production logs when triaging a misclassified error.
   */
  rawErrorData?: Record<string, unknown>;
}

async function executeGetWithRetry<T>(url: URL, path: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_GET_ATTEMPTS; attempt += 1) {
    let response: Response | null = null;
    let networkError: unknown = null;
    try {
      response = await fetch(url.toString(), { cache: "no-store" });
    } catch (err) {
      networkError = err;
    }

    // Network failure — retryable up to MAX_GET_ATTEMPTS.
    if (!response) {
      lastError = new Error(`Network error calling Meta API: ${String(networkError)}`);
      const remaining = MAX_GET_ATTEMPTS - attempt - 1;
      if (remaining <= 0) throw lastError;
      const delay = jitter(BASE_BACKOFFS_MS[attempt] ?? 4000);
      console.warn(
        `[graphGetWithToken] retry ${attempt + 1}/${MAX_GET_ATTEMPTS - 1} after ${delay}ms: ${path} (reason: network_error)`,
      );
      await sleep(delay);
      continue;
    }

    // Always parse the body — even on success Meta sometimes returns a
    // top-level `error` object alongside data.
    const json = (await response.json()) as Record<string, unknown>;

    if (response.ok && !json.error) {
      return json as T;
    }

    const parsed = parseMetaError(json, response.status);
    const budget = getRetryBudget(response.status, parsed.code);
    const remaining = MAX_GET_ATTEMPTS - attempt - 1;
    const isRateLimit =
      parsed.code != null && RATE_LIMIT_META_CODES.has(parsed.code);
    // Respect whichever budget runs out first. Rate-limit errors cap
    // at `budget` (1) regardless of remaining; transient errors use
    // the full `remaining` (up to MAX_GET_ATTEMPTS-1).
    const willRetry = budget > 0 && remaining > 0 && attempt < budget;

    if (!willRetry) {
      // Either non-retryable, budget exhausted, or out of attempts.
      // Surface as MetaApiError with the same shape the single-shot
      // version returned, so route-level `instanceof MetaApiError`
      // checks keep working. Propagate subcode + userMsg +
      // rawErrorData so downstream classifiers (notably
      // `isReduceDataError`) can match the actionable text — Meta
      // sometimes hides the real reason in error_user_msg while
      // leaving `message` as a generic "An unknown error occurred".
      throw new MetaApiError(
        parsed.message,
        parsed.code,
        parsed.type,
        parsed.fbtraceId,
        parsed.subcode,
        parsed.userMsg,
        parsed.rawErrorData,
      );
    }

    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    // Rate-limit retries use a fixed long delay (10s) to give Meta's
    // counter time to decay; transient errors follow the standard
    // backoff schedule. Retry-After header always wins when present.
    const baseDelay = isRateLimit
      ? 10_000
      : (BASE_BACKOFFS_MS[attempt] ?? 4000);
    const delay = retryAfter ?? jitter(baseDelay);
    console.warn(
      `[graphGetWithToken] retry ${attempt + 1}/${budget} after ${delay}ms: ${path} (reason: ${reasonLabel(response.status, parsed.code)})`,
    );
    await sleep(delay);
    lastError = parsed;
  }

  // Defensive — the loop should always either return or throw.
  // Surface whatever last error we observed if execution ever falls
  // through (e.g. all attempts hit the network-error branch and we
  // exited via `continue` without a throw — shouldn't happen but the
  // type system can't prove it).
  if (lastError instanceof Error) throw lastError;
  throw new Error("graphGetWithToken: exhausted retries without a thrown error");
}

function parseMetaError(
  json: Record<string, unknown>,
  status: number,
): ParsedMetaError {
  const e = (json.error ?? {}) as Record<string, unknown>;
  const userTitle = e.error_user_title as string | undefined;
  const userMsg = e.error_user_msg as string | undefined;
  return {
    message: (e.message as string) ?? `HTTP ${status}`,
    code: e.code as number | undefined,
    type: e.type as string | undefined,
    fbtraceId: e.fbtrace_id as string | undefined,
    subcode: e.error_subcode as number | undefined,
    // Concatenate title + msg so either half can match the
    // classifier regex without us having to check both fields.
    // Meta surfaces the actionable text in either slot depending
    // on the error family — "reduce the amount of data" lives in
    // error_user_msg, the duplicate-name family lives in
    // error_user_title.
    userMsg: [userTitle, userMsg].filter(Boolean).join(" — ") || undefined,
    rawErrorData: e,
  };
}

// Returns the remaining retry budget for this error. 0 = don't
// retry. > 0 = retry up to that many more times. Separating
// rate-limit back-pressure from genuine transient errors prevents
// the retry cascade that turns a soft code=2 into a hard
// code=80004 lockout.
function getRetryBudget(
  httpStatus: number,
  metaCode: number | undefined,
): number {
  // HTTP 429 is a rate-limit signal from the edge — treat like
  // the Meta rate-limit codes.
  if (httpStatus === 429) return 1;
  // Genuine server errors — full budget.
  if (httpStatus >= 500 && httpStatus <= 599) return MAX_GET_ATTEMPTS - 1;
  if (metaCode != null && TRANSIENT_META_CODES.has(metaCode)) {
    return MAX_GET_ATTEMPTS - 1;
  }
  if (metaCode != null && RATE_LIMIT_META_CODES.has(metaCode)) {
    return 1;
  }
  return 0;
}

// `isReduceDataError` lives in a separate, dependency-free module so
// the unit tests (Node strip-only mode, which can't parse the
// MetaApiError class's parameter properties) can import the helper
// without dragging in this whole client. Re-export keeps the
// canonical `lib/meta/client` import surface intact for callers.
export { isReduceDataError } from "./error-classify";

function reasonLabel(httpStatus: number, metaCode: number | undefined): string {
  if (
    metaCode != null &&
    (TRANSIENT_META_CODES.has(metaCode) || RATE_LIMIT_META_CODES.has(metaCode))
  ) {
    return `meta_code_${metaCode}`;
  }
  if (httpStatus === 429) return "http_429";
  if (httpStatus >= 500) return `http_${httpStatus}`;
  return "unknown";
}

/**
 * Parse a Retry-After header. Spec allows seconds (integer) or an
 * HTTP-date; we honour seconds and ignore the date variant (rare in
 * practice for Meta). Returns null when missing / malformed.
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
}

function jitter(baseMs: number): number {
  const spread = baseMs * 0.25;
  // ±25% uniform jitter — avoids thundering-herd if a whole account
  // rate-limits and many concurrent reads bounce at once.
  return Math.round(baseMs + (Math.random() * 2 - 1) * spread);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── POST helpers ────────────────────────────────────────────────────────────

/**
 * POST request against the Graph API with an explicit token.
 * Mirrors graphGetWithToken — use when you want to call as the user (OAuth
 * token) rather than the static app token.
 *
 * All mutation helpers (createMetaCampaign, createMetaAdSet, …) accept an
 * optional `token?` param; when provided they delegate here instead of going
 * through graphPost's env-var path.
 */
export async function graphPostWithToken<T>(
  path: string,
  body: Record<string, unknown>,
  token: string,
): Promise<T> {
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
    console.error(
      "[graphPostWithToken] Meta API error on", path,
      "\nRequest body:", JSON.stringify(body, null, 2),
      "\nMeta error response:", JSON.stringify(json, null, 2),
    );
    if (e.error_user_msg || e.error_user_title) {
      console.error(
        "[graphPostWithToken] Meta user message:",
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

/**
 * POST request against the Graph API.
 * When `token` is provided it is used directly; otherwise falls back to the
 * META_ACCESS_TOKEN env-var.  Prefer passing an explicit token so the call
 * runs in the user's permission context rather than the static app context.
 */
async function graphPost<T>(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<T> {
  const effectiveToken = token ?? process.env.META_ACCESS_TOKEN;
  if (!effectiveToken) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }
  return graphPostWithToken<T>(path, body, effectiveToken);
}

// ─── Public helpers ──────────────────────────────────────────────────────────

/**
 * Fetch all ad accounts accessible to the token owner.
 * Requires: ads_read or ads_management permission.
 *
 * GET /me/adaccounts
 */
export async function fetchAdAccounts(token?: string): Promise<MetaAdAccount[]> {
  const params = {
    fields: "id,name,account_id,currency,account_status,timezone_name,business",
    limit: "100",
  };
  const res = token
    ? await graphGetWithToken<GraphPagedResponse<MetaAdAccount>>("/me/adaccounts", params, token)
    : await graphGet<GraphPagedResponse<MetaAdAccount>>("/me/adaccounts", params);
  return res.data;
}

/**
 * Fetch the Business Manager ID that owns a given ad account.
 * Returns null if the account has no linked Business Manager or the lookup fails.
 * Requires: ads_read or ads_management permission.
 */
export async function fetchBusinessIdForAccount(
  adAccountId: string,
  token?: string,
): Promise<string | null> {
  try {
    const res = token
      ? await graphGetWithToken<{ business?: { id: string } }>(`/${adAccountId}`, { fields: "business" }, token)
      : await graphGet<{ business?: { id: string } }>(`/${adAccountId}`, { fields: "business" });
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
export async function fetchPages(businessId?: string, token?: string): Promise<MetaApiPage[]> {
  const fields = "id,name,fan_count,category,picture{url},instagram_business_account";

  if (businessId) {
    const res = token
      ? await graphGetWithToken<GraphPagedResponse<MetaApiPage>>(`/${businessId}/owned_pages`, { fields, limit: "200" }, token)
      : await graphGet<GraphPagedResponse<MetaApiPage>>(`/${businessId}/owned_pages`, { fields, limit: "200" });
    return res.data;
  }

  const res = token
    ? await graphGetWithToken<GraphPagedResponse<MetaApiPage>>("/me/accounts", { fields, limit: "200" }, token)
    : await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", { fields, limit: "200" });
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
  /** OAuth or system token. When supplied uses graphGetWithToken instead of the env-var graphGet. */
  token?: string;
}): Promise<FetchCampaignsResult> {
  const {
    adAccountId,
    filter = "relevant",
    nameContains,
    limit = 25,
    after,
    token,
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

  const res = token
    ? await graphGetWithToken<GraphPagedResponse<RawMetaCampaign>>(`/${adAccountId}/campaigns`, queryParams, token)
    : await graphGet<GraphPagedResponse<RawMetaCampaign>>(`/${adAccountId}/campaigns`, queryParams);

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
  token?: string,
): Promise<RawMetaCampaign | null> {
  try {
    const fields = "id,name,objective,status,effective_status,buying_type,created_time,updated_time";
    const res = token
      ? await graphGetWithToken<RawMetaCampaign>(`/${campaignId}`, { fields }, token)
      : await graphGet<RawMetaCampaign>(`/${campaignId}`, { fields });
    return res ?? null;
  } catch (err) {
    // Log before swallowing so a token error doesn't silently masquerade as
    // "campaign not found".  The caller turns null into a user-facing 404.
    console.warn(
      `[fetchCampaignById] id=${campaignId} returned null — error:`,
      err instanceof Error ? err.message : String(err),
      token ? `tokenSource=explicit len=${token.length}` : "tokenSource=META_ACCESS_TOKEN",
    );
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
  /** Subset of `targeting` fields used for the picker's audience-summary line. */
  targeting?: {
    age_min?: number;
    age_max?: number;
    geo_locations?: {
      countries?: string[];
      cities?: { name?: string }[];
      regions?: { name?: string }[];
      custom_locations?: unknown[];
    };
    custom_audiences?: { id: string; name?: string }[];
    excluded_custom_audiences?: { id: string; name?: string }[];
    flexible_spec?: unknown[];
  };
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
  /**
   * Status filter:
   *   - "relevant" → ACTIVE + PAUSED (default)
   *   - "active"   → ACTIVE only
   *   - "paused"   → PAUSED only
   *   - "all"      → no status filter (still capped & paged)
   */
  filter?: "relevant" | "active" | "paused" | "all";
  /** Optional case-insensitive substring match on ad set name. */
  nameContains?: string;
  /** Page size — capped at 50. */
  limit?: number;
  /** Pagination cursor returned by a previous call. */
  after?: string;
  /** OAuth or system token. When supplied uses graphGetWithToken instead of the env-var graphGet. */
  token?: string;
}): Promise<FetchAdSetsResult> {
  const {
    campaignId,
    filter = "relevant",
    nameContains,
    limit = 25,
    after,
    token,
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
    // Limited targeting fields used for the picker's audience summary line.
    // Keep this minimal — full `targeting` objects can be huge.
    "targeting{age_min,age_max,geo_locations,custom_audiences,flexible_spec}",
  ].join(",");

  const queryParams: Record<string, string> = {
    fields,
    limit: String(Math.min(Math.max(1, limit), 50)),
  };

  if (filter === "relevant") {
    queryParams.effective_status = JSON.stringify(["ACTIVE", "PAUSED"]);
  } else if (filter === "active") {
    queryParams.effective_status = JSON.stringify(["ACTIVE"]);
  } else if (filter === "paused") {
    queryParams.effective_status = JSON.stringify(["PAUSED"]);
  }

  if (nameContains?.trim()) {
    queryParams.filtering = JSON.stringify([
      { field: "name", operator: "CONTAIN", value: nameContains.trim() },
    ]);
  }

  if (after) queryParams.after = after;

  const res = token
    ? await graphGetWithToken<GraphPagedResponse<RawMetaAdSet>>(`/${campaignId}/adsets`, queryParams, token)
    : await graphGet<GraphPagedResponse<RawMetaAdSet>>(`/${campaignId}/adsets`, queryParams);

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
  token?: string,
): Promise<RawMetaAdSet | null> {
  try {
    const fields = "id,name,campaign_id,optimization_goal,billing_event,status,effective_status,created_time,updated_time";
    const res = token
      ? await graphGetWithToken<RawMetaAdSet>(`/${adSetId}`, { fields }, token)
      : await graphGet<RawMetaAdSet>(`/${adSetId}`, { fields });
    return res ?? null;
  } catch (err) {
    console.warn(
      `[fetchAdSetById] id=${adSetId} returned null — error:`,
      err instanceof Error ? err.message : String(err),
      token ? `tokenSource=explicit len=${token.length}` : "tokenSource=META_ACCESS_TOKEN",
    );
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
export async function fetchPixels(adAccountId: string, token?: string): Promise<MetaApiPixel[]> {
  const params = { fields: "id,name", limit: "100" };
  const res = token
    ? await graphGetWithToken<GraphPagedResponse<MetaApiPixel>>(`/${adAccountId}/adspixels`, params, token)
    : await graphGet<GraphPagedResponse<MetaApiPixel>>(`/${adAccountId}/adspixels`, params);
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

// ─── Ad account Instagram actors ─────────────────────────────────────────────

/**
 * Fetch the Instagram accounts that are valid `instagram_actor_id` values for
 * a given ad account.
 *
 * `GET /{adAccountId}/instagram_accounts` is the **authoritative** source for
 * this information — not `instagram_business_account` on a Page, and not
 * `/{pageId}/instagram_accounts`.  Meta Ads validates `instagram_actor_id`
 * against this list server-side and rejects with #100 when the account is not
 * present.
 *
 * Returns an empty array (never throws) when the endpoint is unavailable,
 * when the token lacks the required permission, or when no accounts are linked.
 *
 * @param adAccountId  The ad account id (e.g. "act_1234567890").
 * @param token        OAuth or system token. Falls back to META_ACCESS_TOKEN.
 */
export async function fetchAdAccountIgActors(
  adAccountId: string,
  token?: string,
): Promise<Array<{ id: string; username?: string; name?: string }>> {
  const t = token ?? process.env.META_ACCESS_TOKEN ?? "";
  if (!t) {
    console.warn("[fetchAdAccountIgActors] no token available");
    return [];
  }
  try {
    const res = await graphGetWithToken<GraphPagedResponse<{ id: string; username?: string; name?: string }>>(
      `/${adAccountId}/instagram_accounts`,
      { fields: "id,username,name", limit: "50" },
      t,
    );
    const accounts = res.data ?? [];
    console.info(
      `[fetchAdAccountIgActors] ${adAccountId}/instagram_accounts →` +
        ` ${accounts.length} actor(s):` +
        ` ${accounts.map((a) => `${a.id}${a.username ? ` (@${a.username})` : ""}`).join(", ") || "(none)"}`,
    );
    return accounts;
  } catch (err) {
    const msg = err instanceof MetaApiError
      ? `${err.message}${err.code ? ` (code=${err.code})` : ""}`
      : err instanceof Error ? err.message : String(err);
    console.warn(
      `[fetchAdAccountIgActors] /${adAccountId}/instagram_accounts failed: ${msg}`,
    );
    return [];
  }
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
  token?: string,
): Promise<{ id: string }> {
  const effectiveToken = token ?? process.env.META_ACCESS_TOKEN;
  if (!effectiveToken) {
    throw new MetaApiError("META_ACCESS_TOKEN is not configured. Add it to .env.local.");
  }
  // Use a local alias so the rest of the function body continues to work
  // identically — the `url.searchParams.set("access_token", token)` call below
  // was using the old `const token` declaration.
  const resolvedToken = effectiveToken;

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
  url.searchParams.set("access_token", resolvedToken);

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
  token?: string,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/adsets`,
    payload as unknown as Record<string, unknown>,
    token,
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
  token?: string,
): Promise<CreateAdSetsResult> {
  const created: CreateAdSetsResult["created"] = [];
  const failed: CreateAdSetsResult["failed"] = [];

  for (const payload of payloads) {
    try {
      const { id } = await graphPost<{ id: string }>(
        `/${adAccountId}/adsets`,
        payload as unknown as Record<string, unknown>,
        token,
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
  token?: string,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/adcreatives`,
    payload as unknown as Record<string, unknown>,
    token,
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
  token?: string,
): Promise<{ id: string }> {
  return graphPost<{ id: string }>(
    `/${adAccountId}/ads`,
    payload as unknown as Record<string, unknown>,
    token,
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
  token?: string,
): Promise<Pick<UploadAssetResult, "url" | "hash">> {
  const effectiveToken = token ?? process.env.META_ACCESS_TOKEN;

  // ── Debug logging ───────────────────────────────────────────────────────
  const fileTyped = file as { type?: string; name?: string };
  console.log("[uploadImageAsset] pre-upload:", {
    filename,
    mimeType: fileTyped.type ?? "(unknown)",
    sizeBytes: file.size,
    adAccountId,
    tokenSource: token ? "explicit" : "META_ACCESS_TOKEN (env)",
    token_present: !!effectiveToken,
    token_prefix: effectiveToken ? effectiveToken.slice(0, 12) : "(missing)",
  });

  if (!effectiveToken) {
    throw new MetaApiError(
      "META_ACCESS_TOKEN is not configured. Add it to .env.local.",
    );
  }

  // Sanitise filename — keep only URL-safe characters so it survives as a
  // multipart Content-Disposition attribute without encoding issues.
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.jpg";

  const formData = new FormData();
  // access_token in the form body — matches curl -F "access_token=TOKEN"
  formData.append("access_token", effectiveToken);
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
  token?: string,
): Promise<Pick<UploadAssetResult, "videoId" | "previewUrl">> {
  const effectiveToken = token ?? process.env.META_ACCESS_TOKEN;

  // ── Debug logging ───────────────────────────────────────────────────────
  const fileTyped = file as { type?: string; name?: string };
  console.log("[uploadVideoAsset] pre-upload:", {
    filename,
    mimeType: fileTyped.type ?? "(unknown)",
    sizeBytes: file.size,
    sizeMB: (file.size / 1024 / 1024).toFixed(2),
    adAccountId,
    tokenSource: token ? "explicit" : "META_ACCESS_TOKEN (env)",
    token_present: !!effectiveToken,
    token_prefix: effectiveToken ? effectiveToken.slice(0, 12) : "(missing)",
  });

  if (!effectiveToken) {
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
  formData.append("access_token", effectiveToken);
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
  /** OAuth or system token. When supplied uses graphPostWithToken instead of the env-var graphPost. */
  token?: string;
}): Promise<{ id: string }> {
  const { adAccountId, name, objective, status = "PAUSED", token } = params;

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

  return graphPost<{ id: string }>(`/${adAccountId}/campaigns`, payload, token);
}
