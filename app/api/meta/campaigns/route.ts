/**
 * GET /api/meta/campaigns?adAccountId=&filter=&search=&limit=&after=
 *
 * Lists live Meta campaigns under the given ad account so the wizard's
 * "Add to existing campaign" picker can show them. Source of truth is the
 * Marketing API, NOT local drafts — the picker must surface campaigns
 * created outside this tool too.
 *
 * Query params:
 *   adAccountId  required, e.g. "act_1234567890"
 *   filter       "relevant" (default) | "all"
 *                  - "relevant" → only ACTIVE + PAUSED campaigns,
 *                    server-side filtered, recency-sorted, limited
 *                  - "all"      → no status filter (still capped & paged)
 *   search       optional case-insensitive name substring (server-side via
 *                Meta `filtering=[{field:"name",operator:"CONTAIN",…}]`)
 *   limit        page size, default 25, max 50
 *   after        cursor returned by a previous call's `paging.after`
 *
 * Response:
 *   { data: MetaCampaignSummary[], count: number,
 *     paging: { after?: string, hasMore: boolean } }
 *
 * Each row includes a derived `compatible` flag — true when the campaign's
 * raw Meta objective maps to one of our internal `CampaignObjective`
 * values AND it's an AUCTION campaign. Incompatible campaigns are still
 * returned (so the user sees they exist) but the UI should disable
 * selection on them.
 */

import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  fetchCampaignsForAccount,
  MetaApiError,
  type RawMetaCampaign,
} from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { mapMetaObjectiveToInternal } from "@/lib/meta/campaign";
import type {
  MetaCampaignSummary,
  MetaCampaignsResponse,
} from "@/lib/types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function deriveCompatibility(raw: RawMetaCampaign): {
  compatible: boolean;
  internalObjective?: ReturnType<typeof mapMetaObjectiveToInternal>;
  reason?: string;
} {
  const internal = mapMetaObjectiveToInternal(raw.objective);
  if (!internal) {
    return {
      compatible: false,
      reason: `Objective "${raw.objective ?? "unknown"}" not supported by this wizard.`,
    };
  }
  if (raw.buying_type && raw.buying_type !== "AUCTION") {
    return {
      compatible: false,
      internalObjective: internal,
      reason: `Buying type "${raw.buying_type}" not supported (this wizard only creates auction ad sets).`,
    };
  }
  // ARCHIVED / DELETED campaigns can't accept new ad sets.
  const blockedStatuses = new Set(["ARCHIVED", "DELETED"]);
  if (raw.effective_status && blockedStatuses.has(raw.effective_status)) {
    return {
      compatible: false,
      internalObjective: internal,
      reason: `Campaign is ${raw.effective_status.toLowerCase()}; can't add ad sets.`,
    };
  }
  return { compatible: true, internalObjective: internal };
}

function toSummary(raw: RawMetaCampaign): MetaCampaignSummary {
  const c = deriveCompatibility(raw);
  return {
    id: raw.id,
    name: raw.name,
    objective: raw.objective ?? "",
    internalObjective: c.internalObjective,
    status: raw.status ?? "",
    effectiveStatus: raw.effective_status,
    buyingType: raw.buying_type,
    createdTime: raw.created_time,
    updatedTime: raw.updated_time,
    compatible: c.compatible,
    incompatibleReason: c.reason,
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

  const adAccountId = req.nextUrl.searchParams.get("adAccountId")?.trim();
  if (!adAccountId) {
    return Response.json(
      { error: "Query parameter 'adAccountId' is required" },
      { status: 400 },
    );
  }
  if (!adAccountId.startsWith("act_")) {
    return Response.json(
      { error: 'Ad account id must start with "act_"' },
      { status: 400 },
    );
  }

  const filterParam = req.nextUrl.searchParams.get("filter") ?? "relevant";
  const filter: "relevant" | "all" =
    filterParam === "all" ? "all" : "relevant";
  const search = req.nextUrl.searchParams.get("search")?.trim() || undefined;
  const after = req.nextUrl.searchParams.get("after") ?? undefined;
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(1, Math.trunc(rawLimit)), MAX_LIMIT)
    : DEFAULT_LIMIT;

  // ── Resolve freshest available token ─────────────────────────────────────
  let token: string;
  let tokenSource: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    console.error("[/api/meta/campaigns] token resolution failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }

  console.log(
    `[/api/meta/campaigns] fetch start adAccountId=${adAccountId} filter=${filter}` +
      ` search=${search ?? "-"} limit=${limit} after=${after ? "yes" : "no"} tokenSource=${tokenSource}`,
  );

  try {
    const res = await fetchCampaignsForAccount({
      adAccountId,
      filter,
      nameContains: search,
      limit,
      after,
      token,
    });

    const data = res.data.map(toSummary);
    const compatibleCount = data.filter((c) => c.compatible).length;

    console.log(
      `[/api/meta/campaigns] fetch success adAccountId=${adAccountId}` +
        ` returned=${data.length} compatible=${compatibleCount} hasMore=${res.hasMore}`,
    );

    const body: MetaCampaignsResponse & { tokenSource: string } = {
      data,
      count: data.length,
      paging: { after: res.nextCursor, hasMore: res.hasMore },
      tokenSource,
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error(
        `[/api/meta/campaigns] fetch failure adAccountId=${adAccountId}` +
          ` code=${err.code ?? "?"} type=${err.type ?? "?"} msg=${err.message}`,
      );
      // Map common permission errors to a friendlier message.
      const isPermission =
        err.code === 200 ||
        err.code === 100 ||
        /permission|access/i.test(err.message);
      return Response.json(
        {
          ...err.toJSON(),
          ...(isPermission && {
            hint: "Token may be missing ads_read / ads_management permission for this account.",
          }),
        },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/meta/campaigns] fetch failure adAccountId=${adAccountId} unexpected: ${msg}`,
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
