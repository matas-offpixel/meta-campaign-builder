/**
 * GET /api/meta/pages?adAccountId=act_xxx
 *
 * Returns all Facebook Pages accessible to the authenticated token, from
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
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchPages,
  fetchBusinessIdForAccount,
  MetaApiError,
  graphGet,
} from "@/lib/meta/client";
import type { MetaApiPage } from "@/lib/types";

type GraphPagedResponse<T> = { data: T[] };

/** Fetch client pages for a BM — requires business_management or pages_read_engagement */
async function fetchClientPages(businessId: string): Promise<MetaApiPage[]> {
  try {
    const res = await graphGet<GraphPagedResponse<MetaApiPage>>(
      `/${businessId}/client_pages`,
      {
        fields: "id,name,fan_count,category,picture{url},instagram_business_account",
        limit: "200",
      },
    );
    return res.data ?? [];
  } catch {
    return [];
  }
}

/** Fetch personal pages the token owner directly manages via /me/accounts */
async function fetchPersonalPages(): Promise<MetaApiPage[]> {
  try {
    const res = await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", {
      fields: "id,name,fan_count,category,picture{url},instagram_business_account",
      limit: "200",
    });
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

  try {
    const [personalPages, businessPages, clientPages] = await Promise.all([
      // Always fetch personal pages
      fetchPersonalPages(),

      // Try BM owned/client pages if we have an ad account
      adAccountId
        ? fetchBusinessIdForAccount(adAccountId).then((businessId) =>
            businessId ? fetchPages(businessId) : [],
          )
        : Promise.resolve([]),

      adAccountId
        ? fetchBusinessIdForAccount(adAccountId).then((businessId) =>
            businessId ? fetchClientPages(businessId) : [],
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
