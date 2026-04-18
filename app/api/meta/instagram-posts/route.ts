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
 * Response shape:
 *   { data: InstagramPost[], count, tokenSource }
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

  let lastError: MetaApiError | Error | null = null;
  let lastSource: string | null = null;

  for (const { token, source } of attempts) {
    try {
      const res = await graphGetWithToken<RawIgResponse>(
        `/${igUserId}/media`,
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
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      lastSource = source;
      const code = err instanceof MetaApiError ? err.code : undefined;
      const isTokenScopeError =
        err instanceof MetaApiError &&
        (code === 210 || code === 190 || code === 200 || code === 100);
      console.warn(
        `[/api/meta/instagram-posts] attempt failed igUserId=${igUserId}` +
          ` tokenSource=${source} code=${code ?? "?"} msg=${lastError.message}` +
          (isTokenScopeError && attempts.length > 1 ? " — trying next token" : ""),
      );
      if (!isTokenScopeError) break;
    }
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
