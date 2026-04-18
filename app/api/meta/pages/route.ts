/**
 * GET /api/meta/pages?adAccountId=act_xxx
 *
 * Returns all Facebook Pages accessible to the authenticated user, from
 * three sources (deduplicated by page ID):
 *
 *   1. Business Manager owned pages — via /{businessId}/owned_pages
 *      (resolved from the provided adAccountId)
 *   2. Business Manager client pages — via /{businessId}/client_pages
 *   3. Personal token pages — via /me/accounts
 *
 * Fetching all three covers the most common access patterns.
 * Sources that fail (e.g. missing permissions) are silently skipped
 * so partial results are always returned.
 *
 * The route resolves the freshest available Facebook token for the current
 * user (DB first, then META_ACCESS_TOKEN env-var fallback) so the list
 * stays correct after a reconnect without requiring a full redeploy.
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchPages,
  fetchBusinessIdForAccount,
  MetaApiError,
  graphGetWithToken,
  graphGet,
} from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import type { MetaApiPage } from "@/lib/types";

type GraphPagedResponse<T> = { data: T[] };

/** Fetch client pages for a BM — requires business_management or pages_read_engagement */
async function fetchClientPages(businessId: string, token?: string): Promise<MetaApiPage[]> {
  try {
    const fields = "id,name,fan_count,category,picture{url},instagram_business_account";
    const params = { fields, limit: "200" };
    const res = token
      ? await graphGetWithToken<GraphPagedResponse<MetaApiPage>>(
          `/${businessId}/client_pages`,
          params,
          token,
        )
      : await graphGet<GraphPagedResponse<MetaApiPage>>(
          `/${businessId}/client_pages`,
          params,
        );
    return res.data ?? [];
  } catch {
    return [];
  }
}

/** Fetch personal pages the token owner directly manages via /me/accounts */
async function fetchPersonalPages(token?: string): Promise<MetaApiPage[]> {
  try {
    const fields = "id,name,fan_count,category,picture{url},instagram_business_account";
    const params = { fields, limit: "200" };
    const res = token
      ? await graphGetWithToken<GraphPagedResponse<MetaApiPage>>("/me/accounts", params, token)
      : await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", params);
    return res.data ?? [];
  } catch {
    return [];
  }
}

/** Deduplicates an array of pages, preserving first-seen order */
function deduplicatePages(pages: MetaApiPage[]): MetaApiPage[] {
  const seen = new Set<string>();
  return pages.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const adAccountId = req.nextUrl.searchParams.get("adAccountId") ?? undefined;

  // ── Resolve freshest available token ─────────────────────────────────────
  let token: string | undefined;
  let tokenSource: string = "env";
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch {
    // Fall back to graphGet's internal META_ACCESS_TOKEN below
    token = undefined;
  }

  console.info(`[/api/meta/pages] token source=${tokenSource} adAccount=${adAccountId ?? "none"}`);

  try {
    const [personalPages, businessPages, clientPages] = await Promise.all([
      // Always fetch personal pages
      fetchPersonalPages(token),

      // Try BM owned/client pages if we have an ad account
      adAccountId
        ? fetchBusinessIdForAccount(adAccountId, token).then((businessId) =>
            businessId ? fetchPages(businessId, token) : [],
          )
        : Promise.resolve([]),

      adAccountId
        ? fetchBusinessIdForAccount(adAccountId, token).then((businessId) =>
            businessId ? fetchClientPages(businessId, token) : [],
          )
        : Promise.resolve([]),
    ]);

    // BM-owned pages first (most authoritative), then client pages, then personal
    const pages = deduplicatePages([
      ...businessPages,
      ...clientPages,
      ...personalPages,
    ]);

    return Response.json({
      data: pages,
      count: pages.length,
      tokenSource,
      sources: {
        business: businessPages.length,
        client: clientPages.length,
        personal: personalPages.length,
        total: pages.length,
      },
    });
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/pages] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
