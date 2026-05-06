/**
 * GET/POST /api/internal/scan-enhancement-flags
 *
 * Cron / ops: scans ACTIVE ads per client Meta account, evaluates
 * degrees_of_freedom_spec.creative_features_spec against agency policy,
 * persists violation rows and auto-resolves cleared ads.
 *
 * Auth (dual path, mirrors `/api/admin/meta-enhancement-probe`):
 *   1. `Authorization: Bearer <CRON_SECRET>` — Vercel Cron (GET) and scripted runs.
 *   2. Else: signed-in Supabase session (browser GET/POST) — same full scan; session is
 *      only the gate (service-role DB + per-client Meta token resolution unchanged).
 *   Unauthenticated requests → 401.
 *
 * Meta token: for each client, `resolveServerMetaToken(admin, client.user_id)` —
 * DB OAuth row first, then `META_ACCESS_TOKEN` env fallback (same as other server routes).
 */

import { NextResponse, type NextRequest } from "next/server";

import { graphGetWithToken } from "@/lib/meta/client";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  evaluateCreativeFeatures,
  isTrackedOnlyFlagSet,
  type FlaggedFeatureMap,
} from "@/lib/meta/enhancement-policy";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

interface GraphPaged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string } };
}

interface RawMetaAdScan {
  id: string;
  name?: string;
  campaign_id?: string;
  creative?: {
    id?: string;
    degrees_of_freedom_spec?: {
      creative_features_spec?: Record<string, { enroll_status?: string }>;
    };
  } | null;
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

async function fetchAllActiveAdsForAccount(params: {
  accountPath: string;
  token: string;
}): Promise<RawMetaAdScan[]> {
  const { accountPath, token } = params;
  const fields = [
    "id",
    "name",
    "campaign_id",
    "creative{id,degrees_of_freedom_spec}",
  ].join(",");

  const out: RawMetaAdScan[] = [];
  let after: string | undefined;

  for (;;) {
    const queryParams: Record<string, string> = {
      fields,
      limit: "50",
      effective_status: JSON.stringify(["ACTIVE"]),
    };
    if (after) queryParams.after = after;

    const page = await graphGetWithToken<GraphPaged<RawMetaAdScan>>(
      `/${accountPath}/ads`,
      queryParams,
      token,
    );
    const chunk = page.data ?? [];
    out.push(...chunk);
    after = page.paging?.cursors?.after;
    if (!after || chunk.length === 0) break;
  }

  return out;
}

async function handleScan(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.info("[scan-enhancement-flags] session-auth manual trigger");
  }

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

  const { data: clients, error: clientsErr } = await admin
    .from("clients")
    .select("id, name, meta_ad_account_id, user_id")
    .not("meta_ad_account_id", "is", null);

  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  let clients_scanned = 0;
  let total_active_ads = 0;
  let total_flagged_ads = 0;
  let total_severity = 0;
  const errors_per_client: Record<string, string> = {};

  for (const client of clients ?? []) {
    const metaAdAccountId = client.meta_ad_account_id;
    if (!metaAdAccountId?.trim()) continue;

    const clientLabel = client.name ?? client.id;
    if (typeof client.user_id !== "string" || client.user_id.length === 0) {
      errors_per_client[clientLabel] = "no_meta_token";
      continue;
    }
    const ownerUserId = client.user_id;

    let metaToken: string;
    try {
      const resolved = await resolveServerMetaToken(admin, ownerUserId);
      metaToken = resolved.token;
    } catch {
      errors_per_client[clientLabel] = "no_meta_token";
      continue;
    }

    try {
      const { data: eventRows } = await admin
        .from("events")
        .select("id, meta_campaign_id")
        .eq("client_id", client.id)
        .not("meta_campaign_id", "is", null);

      const campaignToEventId = new Map<string, string>();
      for (const row of eventRows ?? []) {
        const cid = row.meta_campaign_id as string | null;
        if (cid && !campaignToEventId.has(cid)) {
          campaignToEventId.set(cid, row.id as string);
        }
      }

      const accountPath = withActPrefix(metaAdAccountId);
      const ads = await fetchAllActiveAdsForAccount({
        accountPath,
        token: metaToken,
      });
      const scannedAdIds = new Set(ads.map((a) => a.id));
      clients_scanned += 1;
      total_active_ads += ads.length;

      const scanStartedAt = new Date().toISOString();
      const featureHistogram: Record<string, number> = {};
      let flagged_this_client = 0;
      let severity_this_client = 0;

      for (const ad of ads) {
        const cfs =
          ad.creative?.degrees_of_freedom_spec?.creative_features_spec ??
          undefined;
        const evaluation = evaluateCreativeFeatures(
          cfs as Parameters<typeof evaluateCreativeFeatures>[0],
        );
        const keys = Object.keys(evaluation.flagged);

        if (keys.length > 0) {
          const flagged_features = evaluation.flagged as FlaggedFeatureMap;
          const raw_features_spec = (cfs ?? {}) as Record<string, unknown>;

          const campaignId = ad.campaign_id ?? null;
          const event_id = campaignId
            ? (campaignToEventId.get(campaignId) ?? null)
            : null;

          const { error: insErr } = await admin
            .from("creative_enhancement_flags")
            .insert({
              ad_id: ad.id,
              creative_id: ad.creative?.id ?? "",
              ad_account_id: accountPath,
              client_id: client.id,
              event_id,
              campaign_id: campaignId,
              ad_name: ad.name ?? null,
              flagged_features,
              severity_score: evaluation.severityScore,
              raw_features_spec,
              scanned_at: scanStartedAt,
              tracked_only: isTrackedOnlyFlagSet(flagged_features),
            });

          if (insErr) {
            throw new Error(insErr.message);
          }

          flagged_this_client += 1;
          total_flagged_ads += 1;
          severity_this_client += evaluation.severityScore;
          total_severity += evaluation.severityScore;

          for (const k of keys) {
            featureHistogram[k] = (featureHistogram[k] ?? 0) + 1;
          }
        } else {
          const { error: updErr } = await admin
            .from("creative_enhancement_flags")
            .update({
              resolved_at: new Date().toISOString(),
              resolved_by_user_id: null,
            })
            .eq("client_id", client.id)
            .eq("ad_id", ad.id)
            .is("resolved_at", null);

          if (updErr) {
            throw new Error(updErr.message);
          }
        }
      }

      const { data: openAdRows, error: openAdErr } = await admin
        .from("creative_enhancement_flags")
        .select("ad_id")
        .eq("client_id", client.id)
        .is("resolved_at", null);

      if (openAdErr) {
        throw new Error(openAdErr.message);
      }

      const staleAdIds = [
        ...new Set((openAdRows ?? []).map((r) => r.ad_id as string)),
      ].filter((id) => !scannedAdIds.has(id));

      const resolvedNow = new Date().toISOString();
      const chunkSize = 200;
      for (let i = 0; i < staleAdIds.length; i += chunkSize) {
        const chunk = staleAdIds.slice(i, i + chunkSize);
        const { error: staleErr } = await admin
          .from("creative_enhancement_flags")
          .update({
            resolved_at: resolvedNow,
            resolved_by_user_id: null,
          })
          .eq("client_id", client.id)
          .in("ad_id", chunk)
          .is("resolved_at", null);

        if (staleErr) {
          throw new Error(staleErr.message);
        }
      }

      const top_features = Object.entries(featureHistogram)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, c]) => `${k}:${c}`)
        .join(", ");

      console.info("[scan-enhancement-flags]", {
        client_name: clientLabel,
        scanned_ads: ads.length,
        flagged_ads: flagged_this_client,
        total_severity: severity_this_client,
        top_features: top_features || "(none)",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors_per_client[clientLabel] = msg;
      console.error("[scan-enhancement-flags] client failed", clientLabel, msg);
    }
  }

  return NextResponse.json({
    clients_scanned,
    total_active_ads,
    total_flagged_ads,
    total_severity,
    errors_per_client,
  });
}

/** Vercel Cron invokes GET with `Authorization: Bearer CRON_SECRET`. */
export async function GET(req: NextRequest) {
  return handleScan(req);
}

export async function POST(req: NextRequest) {
  return handleScan(req);
}
