/**
 * GET /api/admin/meta-enhancement-probe
 *
 * Read-only probe: samples ACTIVE ads on a client's Meta ad account and
 * aggregates `degrees_of_freedom_spec.creative_features_spec` keys +
 * `enroll_status` values, plus ad-level `multi_advertiser_ads_options`
 * shapes. Transient ops tooling — remove once enhancement-detector ships.
 */

import { NextResponse, type NextRequest } from "next/server";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GRAPH_API_VERSION = process.env.META_API_VERSION ?? "v21.0";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GraphPaged<T> {
  data?: T[];
}

interface RawAdRow {
  id: string;
  name?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    name?: string;
    degrees_of_freedom_spec?: unknown;
    object_story_spec?: { instagram_actor_id?: string };
  } | null;
}

interface FeatureAgg {
  count: number;
  enrollStatuses: Set<string>;
}

export interface EnhancementProbeResponse {
  sampled_ads: number;
  ad_account_id: string;
  graph_api_version: string;
  distinct_features: Record<
    string,
    { count: number; enroll_statuses: string[] }
  >;
  ad_level_multi_advertiser_observed: Record<string, number>;
  sample_raw: Array<{
    ad_id: string;
    ad_name: string | null;
    creative_id: string | null;
    degrees_of_freedom_spec: unknown;
  }>;
}

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function parseLimit(raw: string | null): number {
  if (raw === null || raw === "") return 25;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 25;
  return Math.min(n, 50);
}

function extractEnrollStatus(featureVal: unknown): string | undefined {
  if (
    featureVal !== null &&
    typeof featureVal === "object" &&
    !Array.isArray(featureVal)
  ) {
    const es = (featureVal as Record<string, unknown>).enroll_status;
    if (typeof es === "string") return es;
    if (typeof es === "number" || typeof es === "boolean") {
      return String(es);
    }
  }
  return undefined;
}

function accumulateCreativeFeatures(
  dof: unknown,
  featureMap: Map<string, FeatureAgg>,
): void {
  if (dof === null || typeof dof !== "object" || Array.isArray(dof)) return;
  const cfs = (dof as Record<string, unknown>).creative_features_spec;
  if (
    cfs === null ||
    typeof cfs !== "object" ||
    Array.isArray(cfs)
  ) {
    return;
  }
  for (const [featureKey, featureVal] of Object.entries(cfs)) {
    let agg = featureMap.get(featureKey);
    if (!agg) {
      agg = { count: 0, enrollStatuses: new Set<string>() };
      featureMap.set(featureKey, agg);
    }
    agg.count += 1;
    const st = extractEnrollStatus(featureVal);
    if (st !== undefined) agg.enrollStatuses.add(st);
  }
}

function fingerprintMultiAdvertiser(value: unknown): string {
  if (value === undefined) return "__absent__";
  try {
    return JSON.stringify(value);
  } catch {
    return "__unserializable__";
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const clientIdRaw = url.searchParams.get("clientId");
  const limit = parseLimit(url.searchParams.get("limit"));

  if (
    typeof clientIdRaw !== "string" ||
    clientIdRaw.length === 0 ||
    !UUID_RE.test(clientIdRaw)
  ) {
    return NextResponse.json(
      { error: "clientId is required (UUID)" },
      { status: 400 },
    );
  }

  console.log("[meta-enhancement-probe] start", { limit });

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Service-role client unavailable",
      },
      { status: 500 },
    );
  }

  const { data: clientRow, error: clientErr } = await admin
    .from("clients")
    .select("id, user_id, meta_ad_account_id")
    .eq("id", clientIdRaw)
    .maybeSingle();

  if (clientErr) {
    return NextResponse.json({ error: clientErr.message }, { status: 500 });
  }
  if (!clientRow) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const metaAdAccountId = clientRow.meta_ad_account_id;
  if (!metaAdAccountId || metaAdAccountId.trim() === "") {
    return NextResponse.json(
      { error: "Client has no meta_ad_account_id" },
      { status: 400 },
    );
  }

  const cronAuthed = isCronAuthorized(req);
  let token: string;

  if (cronAuthed) {
    const envTok = process.env.META_ACCESS_TOKEN;
    if (!envTok) {
      return NextResponse.json(
        {
          error:
            "META_ACCESS_TOKEN is not configured — required for cron-style probe calls.",
        },
        { status: 500 },
      );
    }
    token = envTok;
  } else {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    if (user.id !== clientRow.user_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    try {
      const resolved = await resolveServerMetaToken(userClient, user.id);
      token = resolved.token;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
  }

  const actPath = `/${withActPrefix(metaAdAccountId)}/ads`;
  const fields = [
    "id",
    "name",
    "effective_status",
    "creative{id,name,degrees_of_freedom_spec,object_story_spec{instagram_actor_id}}",
  ].join(",");

  const graphParams: Record<string, string> = {
    fields,
    limit: String(limit),
    effective_status: JSON.stringify(["ACTIVE"]),
  };

  let adsPage: GraphPaged<RawAdRow>;
  try {
    adsPage = await graphGetWithToken<GraphPaged<RawAdRow>>(
      actPath,
      graphParams,
      token,
    );
  } catch (err) {
    if (err instanceof MetaApiError) {
      return NextResponse.json(err.toJSON(), { status: 502 });
    }
    throw err;
  }

  const ads = adsPage.data ?? [];
  const featureMap = new Map<string, FeatureAgg>();
  const multiAdvertiserCounts: Record<string, number> = {};
  const sample_raw: EnhancementProbeResponse["sample_raw"] = [];

  for (const ad of ads) {
    const dof = ad.creative?.degrees_of_freedom_spec;
    accumulateCreativeFeatures(dof, featureMap);

    sample_raw.push({
      ad_id: ad.id,
      ad_name: ad.name ?? null,
      creative_id: ad.creative?.id ?? null,
      degrees_of_freedom_spec: dof ?? null,
    });

    let multiRaw: unknown;
    try {
      const one = await graphGetWithToken<{ multi_advertiser_ads_options?: unknown }>(
        `/${ad.id}`,
        { fields: "multi_advertiser_ads_options" },
        token,
      );
      multiRaw = one.multi_advertiser_ads_options;
    } catch (err) {
      if (err instanceof MetaApiError) {
        return NextResponse.json(err.toJSON(), { status: 502 });
      }
      throw err;
    }

    const fp = fingerprintMultiAdvertiser(multiRaw);
    multiAdvertiserCounts[fp] = (multiAdvertiserCounts[fp] ?? 0) + 1;
  }

  const distinct_features: EnhancementProbeResponse["distinct_features"] = {};
  for (const [name, agg] of featureMap.entries()) {
    distinct_features[name] = {
      count: agg.count,
      enroll_statuses: [...agg.enrollStatuses].sort(),
    };
  }

  const payload: EnhancementProbeResponse = {
    sampled_ads: ads.length,
    ad_account_id: withActPrefix(metaAdAccountId),
    graph_api_version: GRAPH_API_VERSION,
    distinct_features,
    ad_level_multi_advertiser_observed: multiAdvertiserCounts,
    sample_raw,
  };

  console.log("[meta-enhancement-probe] done", {
    sampled_ads: payload.sampled_ads,
    distinct_feature_names: Object.keys(distinct_features).sort(),
  });

  return NextResponse.json(payload);
}
