/**
 * GET /api/meta/usage?adAccountId=
 *
 * Cheap pre-launch read: GET /{act_id}?fields=name so Meta stamps
 * X-App-Usage + X-Business-Use-Case-Usage on the response. No extra
 * Graph product endpoints — name is the only field so the call stays
 * tiny. Used by Review to warn when ads_management is already >80%.
 */

import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import {
  getLastKnownMetaAppUsage,
  getLastKnownMetaBucUsage,
  graphGetWithToken,
  MetaApiError,
} from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import {
  isBucPrelaunchWarning,
  pickAdsManagementBucket,
  type BusinessUseCaseSnapshot,
} from "@/lib/meta/app-usage";
import { isMetaRateLimitCode } from "@/lib/meta/rate-limit-ui";

function bucFromError(err: unknown): BusinessUseCaseSnapshot | null {
  if (err instanceof MetaApiError && err.rawErrorData && typeof err.rawErrorData === "object") {
    const raw = err.rawErrorData.__bucUsage;
    if (raw && typeof raw === "object" && "buckets" in raw) {
      return raw as BusinessUseCaseSnapshot;
    }
  }
  return getLastKnownMetaBucUsage()?.snapshot ?? null;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  const rawId = request.nextUrl.searchParams.get("adAccountId");
  if (!rawId?.trim()) {
    return Response.json(
      { error: "adAccountId query param is required" },
      { status: 400 },
    );
  }
  const accountId = withActPrefix(rawId.trim());

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    return Response.json({ error: msg }, { status: 502 });
  }

  let accountName: string | null = null;
  let buc = getLastKnownMetaBucUsage()?.snapshot ?? null;

  try {
    const acc = await graphGetWithToken<{ name?: string }>(
      `/${accountId}`,
      { fields: "name" },
      token,
    );
    accountName = typeof acc.name === "string" && acc.name.trim() ? acc.name.trim() : null;
    buc = getLastKnownMetaBucUsage()?.snapshot ?? buc;
  } catch (err) {
    buc = bucFromError(err) ?? buc;
    const code = err instanceof MetaApiError ? err.code : undefined;
    const subcode = err instanceof MetaApiError ? err.subcode : undefined;
    if (!isMetaRateLimitCode(code, subcode) && !buc) {
      const msg = err instanceof Error ? err.message : "Failed to read Meta usage";
      return Response.json({ error: msg }, { status: 502 });
    }
  }

  const adsManagement = pickAdsManagementBucket(buc, accountId);
  const warn = adsManagement ? isBucPrelaunchWarning(adsManagement.maxPercent) : false;

  return Response.json({
    accountId,
    accountName,
    appUsage: getLastKnownMetaAppUsage()?.snapshot ?? null,
    buc,
    adsManagement,
    warn,
  });
}
