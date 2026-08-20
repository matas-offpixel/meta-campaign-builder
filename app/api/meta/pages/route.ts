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
 * Client/personal sources that fail (e.g. 429) still leave HTTP 200 with
 * whatever pages we have; `degraded` flags that failure so the picker
 * cache will not pin a short list for the session.
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
import { buildPagesListPayload, settlePagesSource } from "@/lib/meta/pages-list-response";
import type { MetaApiPage } from "@/lib/types";

type GraphPagedResponse<T> = { data: T[] };

async function loadClientPages(businessId: string, token?: string): Promise<MetaApiPage[]> {
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
}

async function loadPersonalPages(token?: string): Promise<MetaApiPage[]> {
  const fields = "id,name,fan_count,category,picture{url},instagram_business_account";
  const params = { fields, limit: "200" };
  const res = token
    ? await graphGetWithToken<GraphPagedResponse<MetaApiPage>>("/me/accounts", params, token)
    : await graphGet<GraphPagedResponse<MetaApiPage>>("/me/accounts", params);
  return res.data ?? [];
}

/** Fetch client pages for a BM — requires business_management or pages_read_engagement */
async function fetchClientPages(businessId: string, token?: string) {
  return settlePagesSource("client", () => loadClientPages(businessId, token), console.error);
}

/** Fetch personal pages the token owner directly manages via /me/accounts */
async function fetchPersonalPages(token?: string) {
  return settlePagesSource("personal", () => loadPersonalPages(token), console.error);
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
    const [personal, businessPages, client] = await Promise.all([
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
            businessId ? fetchClientPages(businessId, token) : Promise.resolve({ pages: [] as MetaApiPage[], failed: false }),
          )
        : Promise.resolve({ pages: [] as MetaApiPage[], failed: false }),
    ]);

    return Response.json(
      buildPagesListPayload({
        businessPages,
        client,
        personal,
        tokenSource,
      }),
    );
  } catch (err) {
    if (err instanceof MetaApiError) {
      return Response.json(err.toJSON(), { status: 502 });
    }
    console.error("[/api/meta/pages] Unexpected error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
