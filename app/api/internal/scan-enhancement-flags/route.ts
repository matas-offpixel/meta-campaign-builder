/**
 * GET/POST /api/internal/scan-enhancement-flags
 *
 * Cron / ops / on-demand: evaluates active ads against agency enhancement
 * policy and persists violation rows.
 *
 * Auth:
 *   1. `Authorization: Bearer <CRON_SECRET>` — Vercel Cron (GET).
 *      Scans ALL clients sequentially, 30 s delay between each.
 *      Skips clients that hit Meta rate-limit (#80004) — retries next cycle.
 *   2. Signed-in Supabase session (GET/POST) + `?clientId=<UUID>`:
 *      Scans ONLY that one client; caller must own it.
 *
 * Meta token per client: `resolveServerMetaToken(admin, client.user_id)`.
 * `last_probed_at` stamped on `clients` row after each successful client scan.
 */

import { NextResponse, type NextRequest } from "next/server";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  evaluateCreativeFeatures,
  isTrackedOnlyFlagSet,
  type FlaggedFeatureMap,
} from "@/lib/meta/enhancement-policy";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 800;
export const dynamic = "force-dynamic";

const CRON_INTER_CLIENT_DELAY_MS = 30_000;
const META_RATE_LIMIT_CODE = 80004;

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

function isRateLimitError(err: unknown): boolean {
  if (err instanceof MetaApiError) {
    const code = (err as unknown as Record<string, unknown>).code;
    if (code === META_RATE_LIMIT_CODE) return true;
    const msg = err.message.toLowerCase();
    if (msg.includes("80004") || msg.includes("rate limit")) return true;
  }
  return false;
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

interface ClientRow {
  id: string;
  name: string | null;
  meta_ad_account_id: string | null;
  user_id: string;
}

interface ClientScanResult {
  client_name: string;
  scanned_ads: number;
  flagged_ads: number;
  resolved_stale: number;
  severity: number;
  error?: string;
  rate_limited?: boolean;
}

async function scanOneClient(
  admin: ReturnType<typeof createServiceRoleClient>,
  client: ClientRow,
): Promise<ClientScanResult> {
  const clientLabel = client.name ?? client.id;
  const metaAdAccountId = client.meta_ad_account_id;

  if (!metaAdAccountId?.trim()) {
    return {
      client_name: clientLabel,
      scanned_ads: 0,
      flagged_ads: 0,
      resolved_stale: 0,
      severity: 0,
      error: "no_meta_ad_account",
    };
  }

  if (typeof client.user_id !== "string" || client.user_id.length === 0) {
    return {
      client_name: clientLabel,
      scanned_ads: 0,
      flagged_ads: 0,
      resolved_stale: 0,
      severity: 0,
      error: "no_meta_token",
    };
  }

  let metaToken: string;
  try {
    const resolved = await resolveServerMetaToken(
      admin as unknown as SupabaseClient,
      client.user_id,
    );
    metaToken = resolved.token;
  } catch {
    return {
      client_name: clientLabel,
      scanned_ads: 0,
      flagged_ads: 0,
      resolved_stale: 0,
      severity: 0,
      error: "no_meta_token",
    };
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

        if (insErr) throw new Error(insErr.message);

        flagged_this_client += 1;
        severity_this_client += evaluation.severityScore;

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

        if (updErr) throw new Error(updErr.message);
      }
    }

    const { data: openAdRows, error: openAdErr } = await admin
      .from("creative_enhancement_flags")
      .select("ad_id")
      .eq("client_id", client.id)
      .is("resolved_at", null);

    if (openAdErr) throw new Error(openAdErr.message);

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

      if (staleErr) throw new Error(staleErr.message);
    }

    await admin
      .from("clients")
      .update({ last_probed_at: resolvedNow })
      .eq("id", client.id);

    const top_features = Object.entries(featureHistogram)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, c]) => `${k}:${c}`)
      .join(", ");

    console.info("[scan-enhancement-flags]", {
      client_name: clientLabel,
      scanned_ads: ads.length,
      flagged_ads: flagged_this_client,
      resolved_stale: staleAdIds.length,
      total_severity: severity_this_client,
      top_features: top_features || "(none)",
    });

    return {
      client_name: clientLabel,
      scanned_ads: ads.length,
      flagged_ads: flagged_this_client,
      resolved_stale: staleAdIds.length,
      severity: severity_this_client,
    };
  } catch (err) {
    const rate_limited = isRateLimitError(err);
    const msg = err instanceof Error ? err.message : String(err);
    if (rate_limited) {
      console.warn(
        "[scan-enhancement-flags] rate-limited, skipping to next cycle",
        clientLabel,
      );
    } else {
      console.error("[scan-enhancement-flags] client failed", clientLabel, msg);
    }
    return {
      client_name: clientLabel,
      scanned_ads: 0,
      flagged_ads: 0,
      resolved_stale: 0,
      severity: 0,
      error: rate_limited ? "rate_limited" : msg,
      rate_limited,
    };
  }
}

async function handleScan(req: NextRequest) {
  const cronAuthed = isCronAuthorized(req);
  const clientIdParam = req.nextUrl.searchParams.get("clientId");

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

  if (!cronAuthed) {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!clientIdParam) {
      return NextResponse.json(
        { error: "clientId is required for session-auth scans" },
        { status: 400 },
      );
    }

    const { data: clientRow, error: lookupErr } = await admin
      .from("clients")
      .select("id, name, meta_ad_account_id, user_id")
      .eq("id", clientIdParam)
      .maybeSingle();

    if (lookupErr) {
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (!clientRow) {
      return NextResponse.json(
        { error: "Client not found" },
        { status: 404 },
      );
    }
    if (clientRow.user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    console.info("[scan-enhancement-flags] on-demand scan", {
      clientId: clientIdParam,
    });

    const result = await scanOneClient(admin, clientRow as ClientRow);
    return NextResponse.json({
      clients_scanned: result.error ? 0 : 1,
      total_active_ads: result.scanned_ads,
      total_flagged_ads: result.flagged_ads,
      total_severity: result.severity,
      results: [result],
    });
  }

  const { data: clients, error: clientsErr } = await admin
    .from("clients")
    .select("id, name, meta_ad_account_id, user_id")
    .not("meta_ad_account_id", "is", null);

  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  console.info("[scan-enhancement-flags] cron: scanning all clients", {
    count: clients?.length ?? 0,
  });

  let clients_scanned = 0;
  let total_active_ads = 0;
  let total_flagged_ads = 0;
  let total_severity = 0;
  const results: ClientScanResult[] = [];

  for (let i = 0; i < (clients ?? []).length; i++) {
    const client = clients![i];
    if (!client.meta_ad_account_id?.trim()) continue;

    if (i > 0) {
      await new Promise<void>((r) =>
        setTimeout(r, CRON_INTER_CLIENT_DELAY_MS),
      );
    }

    const result = await scanOneClient(admin, client as ClientRow);
    results.push(result);

    if (!result.error) {
      clients_scanned += 1;
      total_active_ads += result.scanned_ads;
      total_flagged_ads += result.flagged_ads;
      total_severity += result.severity;
    }
  }

  return NextResponse.json({
    clients_scanned,
    total_active_ads,
    total_flagged_ads,
    total_severity,
    results,
  });
}

export async function GET(req: NextRequest) {
  return handleScan(req);
}

export async function POST(req: NextRequest) {
  return handleScan(req);
}
