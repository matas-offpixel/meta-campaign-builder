/**
 * GET /api/meta/adsets?campaignId=&filter=&search=&limit=&after=
 *
 * Lists live Meta ad sets under the given campaign so the wizard's
 * "Add to existing ad set" picker can show them. Source of truth is the
 * Marketing API, NOT local drafts — we must surface ad sets created
 * outside this tool too.
 *
 * Query params:
 *   campaignId  required, raw Meta campaign id (e.g. "23849562890000")
 *   filter      "relevant" (default) | "all"
 *                 - "relevant" → only ACTIVE + PAUSED ad sets,
 *                   server-side filtered, recency-sorted, limited
 *                 - "all"      → no status filter (still capped & paged)
 *   search      optional case-insensitive name substring (server-side via
 *               Meta `filtering=[{field:"name",operator:"CONTAIN",…}]`)
 *   limit       page size, default 25, max 50
 *   after       cursor returned by a previous call's `paging.after`
 *
 * Response:
 *   { data: MetaAdSetSummary[], count: number,
 *     paging: { after?: string, hasMore: boolean } }
 *
 * Each row includes a derived `compatible` flag — currently `false` only
 * when the ad set's effective_status is ARCHIVED or DELETED. Incompatible
 * rows are still returned (so the user sees they exist) but the UI should
 * disable selection on them.
 */

import { type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  fetchAdSetsForCampaign,
  MetaApiError,
  type RawMetaAdSet,
} from "@/lib/meta/client";
import type { MetaAdSetSummary, MetaAdSetsResponse } from "@/lib/types";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

function deriveCompatibility(raw: RawMetaAdSet): {
  compatible: boolean;
  reason?: string;
} {
  const blockedStatuses = new Set(["ARCHIVED", "DELETED"]);
  if (raw.effective_status && blockedStatuses.has(raw.effective_status)) {
    return {
      compatible: false,
      reason: `Ad set is ${raw.effective_status.toLowerCase()}; can't add ads.`,
    };
  }
  return { compatible: true };
}

function toSummary(raw: RawMetaAdSet): MetaAdSetSummary {
  const c = deriveCompatibility(raw);
  return {
    id: raw.id,
    name: raw.name,
    campaignId: raw.campaign_id ?? "",
    optimizationGoal: raw.optimization_goal,
    billingEvent: raw.billing_event,
    status: raw.status ?? "",
    effectiveStatus: raw.effective_status,
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

  const campaignId = req.nextUrl.searchParams.get("campaignId")?.trim();
  if (!campaignId) {
    return Response.json(
      { error: "Query parameter 'campaignId' is required" },
      { status: 400 },
    );
  }
  if (!/^\d+$/.test(campaignId)) {
    return Response.json(
      { error: "campaignId must be a numeric Meta campaign id" },
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

  console.log(
    `[/api/meta/adsets] fetch start campaignId=${campaignId} filter=${filter}` +
      ` search=${search ?? "-"} limit=${limit} after=${after ? "yes" : "no"}`,
  );

  try {
    const res = await fetchAdSetsForCampaign({
      campaignId,
      filter,
      nameContains: search,
      limit,
      after,
    });

    const data = res.data.map(toSummary);
    const compatibleCount = data.filter((a) => a.compatible).length;

    console.log(
      `[/api/meta/adsets] fetch success campaignId=${campaignId}` +
        ` returned=${data.length} compatible=${compatibleCount} hasMore=${res.hasMore}`,
    );

    const body: MetaAdSetsResponse = {
      data,
      count: data.length,
      paging: { after: res.nextCursor, hasMore: res.hasMore },
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof MetaApiError) {
      console.error(
        `[/api/meta/adsets] fetch failure campaignId=${campaignId}` +
          ` code=${err.code ?? "?"} type=${err.type ?? "?"} msg=${err.message}`,
      );
      const isPermission =
        err.code === 200 ||
        err.code === 100 ||
        /permission|access/i.test(err.message);
      return Response.json(
        {
          ...err.toJSON(),
          ...(isPermission && {
            hint: "Token may be missing ads_read / ads_management permission for this campaign.",
          }),
        },
        { status: 502 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[/api/meta/adsets] fetch failure campaignId=${campaignId} unexpected: ${msg}`,
    );
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
