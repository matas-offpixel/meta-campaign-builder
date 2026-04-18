/**
 * GET /api/meta/page-posts?pageId=<id>&limit=<n>
 *
 * Returns recent published posts for the given Facebook Page so the wizard
 * can present them in the "Use Existing Post" creative picker.
 *
 * Token resolution (in order):
 *   1. **Page access token**, resolved server-side via `resolvePageIdentity`
 *      using the user's OAuth `provider_token`. `/{page_id}/published_posts`
 *      requires a Page-scoped token — calling it with a user/system token
 *      raises Meta error #210 ("A page access token is required to request
 *      this resource").
 *   2. The user's OAuth token, as a soft fallback for cases where the Page
 *      endpoint refused to mint a Page token but the user can still read
 *      the feed.
 *   3. `META_ACCESS_TOKEN` (system) — last resort, mostly only useful for
 *      BM-owned pages assigned to the system user.
 *
 * Upstream:
 *   GET /{page_id}/published_posts
 *     ?fields=id,message,created_time,permalink_url,full_picture,
 *             is_eligible_for_promotion,ineligible_for_promotion_reason,
 *             status_type,is_published,attachments{media_type,media,subattachments}
 *     &limit=25
 *
 * Response shape (matches `lib/types.ts` `PagePost`):
 *   { data: PagePost[], count: number, sources: { fetched, eligible, withMessage } }
 *
 * Posts are returned in Graph order (most recent first). Posts with neither
 * a message nor an attachment are dropped — they aren't useful to render.
 */

import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import {
  getUserFacebookToken,
  resolvePageIdentity,
  type PageTokenSource,
} from "@/lib/meta/page-token";
import type { PagePost } from "@/lib/types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

const POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "status_type",
  "is_published",
  "is_eligible_for_promotion",
  "ineligible_for_promotion_reason",
  "attachments{media_type,media,subattachments}",
].join(",");

interface RawAttachmentMedia {
  image?: { src?: string };
}
interface RawAttachment {
  media_type?: string;
  media?: RawAttachmentMedia;
  subattachments?: { data?: RawAttachment[] };
}
interface RawPost {
  id: string;
  message?: string;
  story?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
  is_published?: boolean;
  is_eligible_for_promotion?: boolean;
  ineligible_for_promotion_reason?: string;
  attachments?: { data?: RawAttachment[] };
}
interface RawPostsResponse {
  data: RawPost[];
}

function pickPostType(raw: RawPost): PagePost["type"] {
  const att = raw.attachments?.data?.[0]?.media_type?.toLowerCase();
  if (att === "video" || att === "video_inline") return "video";
  if (att === "photo" || att === "album") return "photo";
  if (att === "link" || att === "share") return "link";
  // Fall back to status_type when no attachment metadata is present.
  switch (raw.status_type) {
    case "added_video": return "video";
    case "added_photos": return "photo";
    case "shared_story": return "link";
    default: return "status";
  }
}

function pickPreviewImage(raw: RawPost): string | undefined {
  if (raw.full_picture) return raw.full_picture;
  const att = raw.attachments?.data?.[0];
  return att?.media?.image?.src ?? att?.subattachments?.data?.[0]?.media?.image?.src;
}

function pickMessage(raw: RawPost): string {
  if (raw.message && raw.message.trim().length > 0) return raw.message;
  if (raw.story && raw.story.trim().length > 0) return raw.story;
  return "(no caption)";
}

function toPagePost(raw: RawPost, pageId: string): PagePost {
  return {
    id: raw.id,
    pageId,
    message: pickMessage(raw),
    imageUrl: pickPreviewImage(raw),
    createdAt: raw.created_time,
    type: pickPostType(raw),
    // Engagement counts aren't requested in this iteration — keep the shape
    // satisfied with zeroes so the UI can render without conditional checks.
    likes: 0,
    comments: 0,
    shares: 0,
    permalinkUrl: raw.permalink_url,
    eligibleForPromotion: raw.is_eligible_for_promotion,
    ineligibleReason: raw.ineligible_for_promotion_reason,
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

  const pageId = req.nextUrl.searchParams.get("pageId")?.trim();
  if (!pageId) {
    return Response.json(
      { error: "Query parameter 'pageId' is required" },
      { status: 400 },
    );
  }
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.trunc(rawLimit)), MAX_LIMIT)
    : DEFAULT_LIMIT;

  console.log(`[/api/meta/page-posts] fetch start pageId=${pageId} limit=${limit}`);

  // ── Token resolution ──────────────────────────────────────────────────────
  const userToken = await getUserFacebookToken(supabase, user.id);
  const identity = await resolvePageIdentity(pageId, userToken);
  const systemToken = process.env.META_ACCESS_TOKEN ?? null;

  type TokenAttempt = { token: string; source: string };
  const attempts: TokenAttempt[] = [];
  if (identity.pageAccessToken) {
    attempts.push({
      token: identity.pageAccessToken,
      source: `page (${identity.pageTokenSource satisfies PageTokenSource})`,
    });
  }
  if (userToken && userToken !== identity.pageAccessToken) {
    attempts.push({ token: userToken, source: "user" });
  }
  if (systemToken && systemToken !== userToken) {
    attempts.push({ token: systemToken, source: "system" });
  }

  console.log(
    `[/api/meta/page-posts] tokens pageId=${pageId}` +
      ` page=${identity.pageAccessToken ? "yes" : "no"}` +
      ` user=${userToken ? "yes" : "no"}` +
      ` system=${systemToken ? "yes" : "no"}` +
      ` attempts=${attempts.length}` +
      ` (${attempts.map((a) => a.source).join(",") || "none"})`,
  );

  if (attempts.length === 0) {
    console.error(
      `[/api/meta/page-posts] fetch abort pageId=${pageId} reason=no token available`,
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
      const res = await graphGetWithToken<RawPostsResponse>(
        `/${pageId}/published_posts`,
        { fields: POST_FIELDS, limit: String(limit) },
        token,
      );
      const raw = Array.isArray(res?.data) ? res.data : [];

      const usable = raw
        .filter((p) => p.is_published !== false)
        .filter((p) =>
          Boolean(
            p.message ?? p.story ?? p.full_picture ?? p.attachments?.data?.length,
          ),
        )
        .map((p) => toPagePost(p, pageId));

      const eligibleCount = usable.filter(
        (p) => p.eligibleForPromotion !== false,
      ).length;

      console.log(
        `[/api/meta/page-posts] fetch success pageId=${pageId}` +
          ` tokenSource=${source}` +
          ` fetched=${raw.length} usable=${usable.length} eligible=${eligibleCount}`,
      );

      return Response.json({
        data: usable,
        count: usable.length,
        tokenSource: source,
        sources: {
          fetched: raw.length,
          usable: usable.length,
          eligible: eligibleCount,
        },
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      lastSource = source;
      const code = err instanceof MetaApiError ? err.code : undefined;
      const isTokenScopeError =
        err instanceof MetaApiError &&
        (code === 210 || // page access token required
          code === 190 || // invalid OAuth token
          code === 200); // permissions error
      console.warn(
        `[/api/meta/page-posts] attempt failed pageId=${pageId}` +
          ` tokenSource=${source} code=${code ?? "?"} msg=${lastError.message}` +
          (isTokenScopeError && attempts.length > 1 ? " — trying next token" : ""),
      );
      if (!isTokenScopeError) break;
    }
  }

  // ── All attempts failed ───────────────────────────────────────────────────
  if (lastError instanceof MetaApiError) {
    console.error(
      `[/api/meta/page-posts] fetch failure pageId=${pageId}` +
        ` lastTokenSource=${lastSource ?? "?"}` +
        ` code=${lastError.code ?? "?"} type=${lastError.type ?? "?"} msg=${lastError.message}`,
    );
    return Response.json(lastError.toJSON(), { status: 502 });
  }
  const msg = lastError ? lastError.message : "Unknown error";
  console.error(
    `[/api/meta/page-posts] fetch failure pageId=${pageId}` +
      ` lastTokenSource=${lastSource ?? "?"} unexpected: ${msg}`,
  );
  return Response.json({ error: "Internal server error" }, { status: 500 });
}
