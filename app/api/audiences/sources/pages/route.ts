import { type NextRequest } from "next/server";

import {
  audienceSourceRateLimitBody,
  isMetaAdAccountRateLimitError,
} from "@/lib/audiences/meta-rate-limit";
import {
  unionAudiencePageSources,
  type BMSharedPageInput,
  type DefaultListPageInput,
} from "@/lib/audiences/page-source-union";
import { getCachedAudienceSource } from "@/lib/audiences/source-cache";
import {
  fetchAudiencePageSources,
  fetchPagesByIds,
  resolveAudienceSourceContext,
  type AudienceSourceContext,
} from "@/lib/audiences/sources";
import { getBMPagesWithUserAccess } from "@/lib/db/business-managers";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Backfill sources beyond Meta's live `/me/accounts` + `owned_pages` +
 * `client_pages` query — see lib/audiences/page-source-union.ts for why
 * these are needed (client-shared / Partial-access pages Meta's live query
 * frequently omits). Both are best-effort: a failure here must never take
 * down the whole page picker, since the live Meta result is still useful on
 * its own.
 */
async function fetchBackfillPageSources(
  context: AudienceSourceContext,
  token: string,
): Promise<{ bmSharedPages: BMSharedPageInput[]; defaultListPages: DefaultListPageInput[] }> {
  const bmSharedPagesPromise: Promise<BMSharedPageInput[]> = context.metaBusinessId
    ? getBMPagesWithUserAccess(createServiceRoleClient(), context.metaBusinessId).catch(
        (err) => {
          console.warn("[audiences/sources/pages] bm_pages lookup failed", {
            clientId: context.clientId,
            message: err instanceof Error ? err.message : String(err),
          });
          return [];
        },
      )
    : Promise.resolve([]);

  const defaultListPagesPromise: Promise<DefaultListPageInput[]> =
    context.defaultPageIds.length > 0
      ? fetchPagesByIds(context.defaultPageIds, token).catch((err) => {
          console.warn("[audiences/sources/pages] default_page_ids lookup failed", {
            clientId: context.clientId,
            message: err instanceof Error ? err.message : String(err),
          });
          return context.defaultPageIds.map((id) => ({ id, name: id }));
        })
      : Promise.resolve([]);

  const [bmSharedPages, defaultListPages] = await Promise.all([
    bmSharedPagesPromise,
    defaultListPagesPromise,
  ]);
  return { bmSharedPages, defaultListPages };
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get("clientId")?.trim();
  if (!clientId) {
    return Response.json({ error: "clientId is required" }, { status: 400 });
  }

  try {
    const context = await resolveAudienceSourceContext(supabase, user.id, clientId);
    if (!context) return Response.json({ error: "Forbidden" }, { status: 403 });
    const { token, source } = await resolveServerMetaToken(supabase, user.id);
    const pages = await getCachedAudienceSource(
      [user.id, clientId, "pages"],
      async () => {
        const [metaPages, { bmSharedPages, defaultListPages }] = await Promise.all([
          fetchAudiencePageSources(context.metaAdAccountId, token),
          fetchBackfillPageSources(context, token),
        ]);
        return unionAudiencePageSources(metaPages, bmSharedPages, defaultListPages);
      },
    );
    return Response.json({ ok: true, pages, tokenSource: source });
  } catch (err) {
    if (isMetaAdAccountRateLimitError(err)) {
      return Response.json(audienceSourceRateLimitBody(err), { status: 429 });
    }
    const message = err instanceof Error ? err.message : "Failed to load pages";
    return Response.json({ error: message }, { status: 502 });
  }
}
