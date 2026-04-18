/**
 * GET /api/meta/instagram-posts?igUserId=<id>&limit=<n>
 *
 * Returns recent IG media for the given Instagram business account so the
 * wizard can present them in the "Use Existing Post" creative picker.
 *
 * The IG account id is `instagram_business_account.id` (NOT the linked Page
 * id) — typically resolved via `/api/meta/page-identity` for the active
 * Facebook Page.
 *
 * Token resolution mirrors `/api/meta/page-posts`:
 *   1. The IG business account is owned by a Facebook Page; the matching
 *      Page access token usually has the right scopes for `/{ig-user-id}/media`.
 *      We fetch a Page token via `resolvePageIdentity(pageId, userToken)` when
 *      a `pageId` query param is supplied.
 *   2. The user's OAuth `provider_token` (with `instagram_basic` /
 *      `instagram_manage_*` scopes via Meta Login).
 *   3. The system token (`META_ACCESS_TOKEN`) — last resort.
 *
 * Upstream:
 *   GET /{ig-user-id}/media
 *     ?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp
 *     &limit=25
 *
 * Permission errors:
 *   When all token attempts fail with `(#10) Application does not have
 *   permission` (or #200 / OAuthException), the route returns 403 with a
 *   `code: "PERMISSION_DENIED"` body and a `missingScopes` hint listing
 *   the IG-related scopes the session likely lacks. The UI uses this to
 *   render a "reconnect Facebook/Instagram" CTA instead of a generic
 *   error.
 *
 * Response shape:
 *   { data: InstagramPost[], count, tokenSource, igAccountType?, grantedScopes? }
 */

import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import {
  getUserFacebookToken,
  resolvePageIdentity,
  type PageTokenSource,
} from "@/lib/meta/page-token";
import type { InstagramPost } from "@/lib/types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

const IG_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_url",
  "thumbnail_url",
  "permalink",
  "timestamp",
].join(",");

interface RawIgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp: string;
}
interface RawIgResponse {
  data: RawIgMedia[];
}

/** Subset of `/{ig-user-id}` we use to verify it's a Business/Creator account. */
interface RawIgAccountInfo {
  id: string;
  username?: string;
  account_type?: "BUSINESS" | "CREATOR" | "PERSONAL";
  media_count?: number;
}

/** Subset of `/me/permissions` we use to surface granted Instagram scopes. */
interface RawPermissionsResponse {
  data?: { permission: string; status: "granted" | "declined" | "expired" }[];
}

/** Scopes the IG media endpoint relies on, in priority order. */
const REQUIRED_IG_SCOPES = [
  "instagram_basic",
  "pages_read_engagement",
  "pages_show_list",
] as const;

/**
 * Best-effort fetch of the granted scopes on the user's OAuth token. Returns
 * `null` when the call fails (token expired, network error, etc.) — the
 * caller treats that as "unknown" and skips the missing-scope hint.
 *
 * Logged for debugging; cheap (one Graph call, ~50ms).
 */
async function fetchGrantedScopes(token: string): Promise<string[] | null> {
  try {
    const res = await graphGetWithToken<RawPermissionsResponse>(
      "/me/permissions",
      {},
      token,
    );
    const granted = (res.data ?? [])
      .filter((p) => p.status === "granted")
      .map((p) => p.permission);
    return granted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[/api/meta/instagram-posts] /me/permissions failed: ${msg}`);
    return null;
  }
}

/**
 * Look up the IG account's type/username so we can:
 *   1. Distinguish "no media" from "personal IG account" (only Business /
 *      Creator accounts are queryable via the IG Graph API).
 *   2. Surface a clearer error when the account is wrong type.
 */
async function fetchIgAccountInfo(
  igUserId: string,
  token: string,
): Promise<RawIgAccountInfo | null> {
  try {
    return await graphGetWithToken<RawIgAccountInfo>(
      `/${igUserId}`,
      { fields: "id,username,account_type,media_count" },
      token,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[/api/meta/instagram-posts] /${igUserId} account info failed: ${msg}`,
    );
    return null;
  }
}

/** Meta error codes that indicate the token lacks the required permissions. */
function isPermissionDeniedError(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return false;
  // #10  → "Application does not have permission for this action"
  // #200 → permissions error / not authorised
  // #190 → invalid OAuth token (counts as "session can't read this")
  // #294 → managing advertisements requires permission (rare here)
  return err.code === 10 || err.code === 200 || err.code === 190 || err.code === 294;
}

function pickMediaType(raw: RawIgMedia): InstagramPost["mediaType"] {
  switch ((raw.media_type ?? "").toUpperCase()) {
    case "VIDEO":
    case "REELS":
      return "video";
    case "CAROUSEL_ALBUM":
      return "carousel";
    case "IMAGE":
    default:
      return "image";
  }
}

function toInstagramPost(raw: RawIgMedia, igUserId: string): InstagramPost {
  return {
    id: raw.id,
    igUserId,
    caption: raw.caption?.trim() || "(no caption)",
    mediaType: pickMediaType(raw),
    mediaUrl: raw.media_url,
    thumbnailUrl: raw.thumbnail_url,
    permalink: raw.permalink,
    timestamp: raw.timestamp,
  };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const igUserId = req.nextUrl.searchParams.get("igUserId")?.trim();
  if (!igUserId) {
    return Response.json(
      { error: "Query parameter 'igUserId' is required" },
      { status: 400 },
    );
  }
  // Optional — when provided we can resolve a Page token, which is the most
  // reliable way to read IG media.
  const pageId = req.nextUrl.searchParams.get("pageId")?.trim() || null;

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.trunc(rawLimit)), MAX_LIMIT)
    : DEFAULT_LIMIT;

  console.log(
    `[/api/meta/instagram-posts] fetch start igUserId=${igUserId}` +
      ` pageId=${pageId ?? "(none)"} limit=${limit}`,
  );

  // ── Token resolution ──────────────────────────────────────────────────────
  const userToken = await getUserFacebookToken(supabase, user.id);
  const systemToken = process.env.META_ACCESS_TOKEN ?? null;

  type TokenAttempt = { token: string; source: string };
  const attempts: TokenAttempt[] = [];

  if (pageId) {
    const identity = await resolvePageIdentity(pageId, userToken);
    if (identity.pageAccessToken) {
      attempts.push({
        token: identity.pageAccessToken,
        source: `page (${identity.pageTokenSource satisfies PageTokenSource})`,
      });
    }
  }
  if (userToken && !attempts.some((a) => a.token === userToken)) {
    attempts.push({ token: userToken, source: "user" });
  }
  // System token is intentionally a *last* resort for IG. Most BM-owned IG
  // accounts can be read with the system token, but accounts linked through
  // a personal Facebook account cannot — in that case we want the user
  // token to be tried first so we surface a useful permission error.
  if (systemToken && !attempts.some((a) => a.token === systemToken)) {
    attempts.push({ token: systemToken, source: "system" });
  }

  console.log(
    `[/api/meta/instagram-posts] tokens igUserId=${igUserId}` +
      ` attempts=${attempts.length}` +
      ` (${attempts.map((a) => a.source).join(",") || "none"})`,
  );

  if (attempts.length === 0) {
    console.error(
      `[/api/meta/instagram-posts] fetch abort igUserId=${igUserId} reason=no token available`,
    );
    return Response.json(
      {
        error:
          "No access token available — connect Facebook (or set META_ACCESS_TOKEN) and try again.",
        code: "NO_TOKEN",
      },
      { status: 401 },
    );
  }

  // ── Debug: granted scopes on the user OAuth token ──────────────────────
  // Cheap one-shot probe; useful for diagnosing "(#10) Application does not
  // have permission" failures. Only the user token is meaningful here —
  // page/system tokens don't expose scopes the same way.
  let grantedScopes: string[] | null = null;
  if (userToken) {
    grantedScopes = await fetchGrantedScopes(userToken);
    console.log(
      `[/api/meta/instagram-posts] user-token granted scopes:` +
        ` ${grantedScopes ? `[${grantedScopes.join(", ")}]` : "(unknown)"}`,
    );
  }
  const missingScopes = grantedScopes
    ? REQUIRED_IG_SCOPES.filter((s) => !grantedScopes!.includes(s))
    : [];
  if (missingScopes.length > 0) {
    console.warn(
      `[/api/meta/instagram-posts] user token is missing IG-related scopes:` +
        ` [${missingScopes.join(", ")}] — IG media reads will likely fail.`,
    );
  }

  // ── Debug: account-type check (Business/Creator vs Personal) ───────────
  const accountInfoToken = userToken ?? attempts[0]?.token;
  const accountInfo = accountInfoToken
    ? await fetchIgAccountInfo(igUserId, accountInfoToken)
    : null;
  if (accountInfo) {
    console.log(
      `[/api/meta/instagram-posts] igAccount info igUserId=${igUserId}` +
        ` username=${accountInfo.username ?? "(unknown)"}` +
        ` type=${accountInfo.account_type ?? "(unknown)"}` +
        ` media_count=${accountInfo.media_count ?? "?"}`,
    );
    if (accountInfo.account_type === "PERSONAL") {
      // The IG Graph API only returns media for Business/Creator accounts.
      console.warn(
        `[/api/meta/instagram-posts] account ${igUserId} is PERSONAL —` +
          ` /media will return empty / permission-denied.`,
      );
      return Response.json(
        {
          error:
            "Linked Instagram account is a Personal account. Convert it to a Business or Creator account in the Instagram app, then reconnect Facebook to load posts.",
          code: "IG_ACCOUNT_PERSONAL",
          igAccountType: accountInfo.account_type,
        },
        { status: 422 },
      );
    }
  }

  let lastError: MetaApiError | Error | null = null;
  let lastSource: string | null = null;
  let sawPermissionDenied = false;

  for (const { token, source } of attempts) {
    const endpoint = `/${igUserId}/media`;
    console.log(
      `[/api/meta/instagram-posts] GET ${endpoint}` +
        ` tokenSource=${source} fields=${IG_FIELDS} limit=${limit}`,
    );
    try {
      const res = await graphGetWithToken<RawIgResponse>(
        endpoint,
        { fields: IG_FIELDS, limit: String(limit) },
        token,
      );
      const raw = Array.isArray(res?.data) ? res.data : [];
      const usable = raw.map((p) => toInstagramPost(p, igUserId));

      console.log(
        `[/api/meta/instagram-posts] fetch success igUserId=${igUserId}` +
          ` tokenSource=${source} fetched=${raw.length}`,
      );

      return Response.json({
        data: usable,
        count: usable.length,
        tokenSource: source,
        igAccountType: accountInfo?.account_type ?? null,
        grantedScopes: grantedScopes ?? undefined,
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      lastSource = source;
      const code = err instanceof MetaApiError ? err.code : undefined;
      const subcode = err instanceof MetaApiError ? err.subcode : undefined;
      const type = err instanceof MetaApiError ? err.type : undefined;
      const userMsg = err instanceof MetaApiError ? err.userMsg : undefined;
      const permDenied = isPermissionDeniedError(err);
      if (permDenied) sawPermissionDenied = true;
      // Codes worth retrying with the next token — distinct from a flat
      // permission-denied (which we surface specially below).
      const isRetryable =
        err instanceof MetaApiError &&
        (code === 210 || code === 190 || code === 200 || code === 100 || code === 10);
      console.warn(
        `[/api/meta/instagram-posts] attempt failed igUserId=${igUserId}` +
          ` tokenSource=${source} endpoint=${endpoint}` +
          ` code=${code ?? "?"} subcode=${subcode ?? "?"} type=${type ?? "?"}` +
          ` userMsg=${userMsg ? `"${userMsg}"` : "(none)"}` +
          ` msg="${lastError.message}"` +
          (isRetryable && attempts.length > 1 ? " — trying next token" : ""),
      );
      if (!isRetryable) break;
    }
  }

  // ── Permission-denied: surface a distinct, user-actionable error ───────
  if (sawPermissionDenied) {
    const hint =
      missingScopes.length > 0
        ? ` Missing scopes: ${missingScopes.join(", ")}.`
        : "";
    console.error(
      `[/api/meta/instagram-posts] PERMISSION_DENIED igUserId=${igUserId}` +
        ` lastTokenSource=${lastSource ?? "?"} missingScopes=[${missingScopes.join(",")}]`,
    );
    return Response.json(
      {
        error:
          "Instagram account linked, but this app session does not currently " +
          "have permission to read Instagram posts. Reconnect Facebook/Instagram " +
          "and grant the required access." +
          hint,
        code: "PERMISSION_DENIED",
        missingScopes,
        grantedScopes: grantedScopes ?? undefined,
        igAccountType: accountInfo?.account_type ?? null,
        metaCode: lastError instanceof MetaApiError ? lastError.code : undefined,
      },
      { status: 403 },
    );
  }

  if (lastError instanceof MetaApiError) {
    console.error(
      `[/api/meta/instagram-posts] fetch failure igUserId=${igUserId}` +
        ` lastTokenSource=${lastSource ?? "?"}` +
        ` code=${lastError.code ?? "?"} type=${lastError.type ?? "?"} msg=${lastError.message}`,
    );
    return Response.json(lastError.toJSON(), { status: 502 });
  }
  const msg = lastError ? lastError.message : "Unknown error";
  console.error(
    `[/api/meta/instagram-posts] fetch failure igUserId=${igUserId}` +
      ` lastTokenSource=${lastSource ?? "?"} unexpected: ${msg}`,
  );
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
