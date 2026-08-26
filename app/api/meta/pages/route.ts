/**
 * GET /api/meta/pages?adAccountId=act_xxx
 *
 * Returns Facebook Pages accessible for this launch, from four sources
 * (deduplicated by page ID, first-seen wins):
 *
 *   1. Business Manager owned pages — /{businessId}/owned_pages
 *   2. Business Manager client pages — /{businessId}/client_pages
 *   3. Personal token pages — /me/accounts
 *   4. Ad-account promote_pages — /{adAccountId}/promote_pages
 *      (the list Meta validates `object_story_spec.page_id` against)
 *
 * Each edge follows cursors. A source failure (e.g. 429) still leaves
 * HTTP 200 with whatever pages we have; `degraded` flags that failure so
 * the picker cache will not pin a short list for the session.
 */

import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  fetchPagedPageEdge,
  fetchPromotePages,
  fetchBusinessIdForAccount,
  MetaApiError,
} from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  buildPagesListPayload,
  settlePagesSource,
} from "@/lib/meta/pages-list-response";
import type { MetaApiPage } from "@/lib/types";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const adAccountId = req.nextUrl.searchParams.get("adAccountId") ?? undefined;

  let token: string | undefined;
  let tokenSource: string = "env";
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch {
    token = undefined;
  }

  console.info(`[/api/meta/pages] token source=${tokenSource} adAccount=${adAccountId ?? "none"}`);

  try {
    const businessId = adAccountId
      ? await fetchBusinessIdForAccount(adAccountId, token)
      : null;

    const [personal, business, client, promote] = await Promise.all([
      settlePagesSource(
        "personal",
        () => fetchPagedPageEdge("/me/accounts", token),
        console.error,
      ),
      businessId
        ? settlePagesSource(
            "business",
            () => fetchPagedPageEdge(`/${businessId}/owned_pages`, token),
            console.error,
          )
        : Promise.resolve({ pages: [] as MetaApiPage[], failed: false, truncated: false }),
      businessId
        ? settlePagesSource(
            "client",
            () => fetchPagedPageEdge(`/${businessId}/client_pages`, token),
            console.error,
          )
        : Promise.resolve({ pages: [] as MetaApiPage[], failed: false, truncated: false }),
      adAccountId
        ? settlePagesSource(
            "promote",
            () => fetchPromotePages(adAccountId, token),
            console.error,
          )
        : Promise.resolve({ pages: [] as MetaApiPage[], failed: false, truncated: false }),
    ]);

    return Response.json(
      buildPagesListPayload({
        businessPages: business.pages,
        client,
        personal,
        promote,
        businessFailed: business.failed,
        businessTruncated: business.truncated,
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
