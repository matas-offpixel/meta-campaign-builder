/**
 * POST /api/meta/verify-client
 *
 * Slice F.1 — verify a client's Meta connection without leaving the dashboard.
 *
 * Loads the client's three Meta IDs (meta_business_id / meta_ad_account_id /
 * meta_pixel_id), resolves the current user's Facebook OAuth token, and fires
 * three parallel Graph API calls:
 *
 *   1. GET /{businessId}                       fields=id,name
 *   2. GET /act_{adAccountId}                  fields=id,name,business
 *   3. GET /{pixelId}                          fields=id,name,owner_business
 *
 * Returns a structured per-resource result so the UI can show one tick / cross
 * per check without trying to interpret raw Meta error codes.
 *
 * Status semantics
 *   ok        — found, accessible, owned by the right Business (where applicable)
 *   not_found — Meta returned 404 / "Object does not exist"
 *   no_access — token lacks permission, or the resource is hidden from this user
 *   wrong_bm  — ad account or pixel returned, but its `business.id` /
 *               `owner_business.id` does NOT match `meta_business_id`
 *
 * Auth model
 *   Reuses `resolveServerMetaToken` so we get the user's personal OAuth token
 *   first (matches their Ads Manager session) and only fall back to the
 *   server-wide META_ACCESS_TOKEN if the user hasn't connected Facebook yet.
 */

import type { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";

// ── Result types ─────────────────────────────────────────────────────────────

type BusinessStatus = "ok" | "not_found" | "no_access";
type ResourceStatus = "ok" | "wrong_bm" | "not_found" | "no_access";

interface BusinessResult {
  status: BusinessStatus;
  name?: string;
  error?: string;
}

interface ResourceResult {
  status: ResourceStatus;
  name?: string;
  /** The Business ID returned by Meta — useful for diagnosing wrong_bm cases. */
  ownerBusinessId?: string;
  error?: string;
}

interface VerifyResponse {
  business: BusinessResult;
  adAccount: ResourceResult;
  pixel: ResourceResult;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map a Meta API error to one of {not_found, no_access}. Meta uses a handful
 * of common error codes:
 *   100 / 803  — "Object does not exist" / unknown id  → not_found
 *   200        — permission denied                      → no_access
 *   190        — invalid OAuth token                    → no_access
 *   10 / 270   — application/business permission        → no_access
 * Anything else also maps to no_access so the UI never silently succeeds.
 */
function classifyMetaError(err: MetaApiError): {
  status: "not_found" | "no_access";
  message: string;
} {
  const code = err.code ?? 0;
  const msg = err.message ?? "Meta API error";
  if (code === 100 || code === 803 || /does not exist|cannot be loaded|nonexisting/i.test(msg)) {
    return { status: "not_found", message: msg };
  }
  return { status: "no_access", message: msg };
}

// ── Per-resource fetchers ────────────────────────────────────────────────────

async function verifyBusiness(
  businessId: string,
  token: string,
): Promise<BusinessResult> {
  try {
    const res = await graphGetWithToken<{ id: string; name?: string }>(
      `/${businessId}`,
      { fields: "id,name" },
      token,
    );
    return { status: "ok", name: res.name ?? res.id };
  } catch (err) {
    if (err instanceof MetaApiError) {
      const { status, message } = classifyMetaError(err);
      return { status, error: message };
    }
    return { status: "no_access", error: String(err) };
  }
}

async function verifyAdAccount(
  adAccountId: string,
  expectedBusinessId: string | null,
  token: string,
): Promise<ResourceResult> {
  try {
    const res = await graphGetWithToken<{
      id: string;
      name?: string;
      business?: { id: string; name?: string };
    }>(`/act_${adAccountId}`, { fields: "id,name,business" }, token);

    const ownerBusinessId = res.business?.id;
    if (
      expectedBusinessId &&
      ownerBusinessId &&
      ownerBusinessId !== expectedBusinessId
    ) {
      return {
        status: "wrong_bm",
        name: res.name ?? res.id,
        ownerBusinessId,
        error: `Ad account belongs to Business ${ownerBusinessId}, not ${expectedBusinessId}.`,
      };
    }
    return {
      status: "ok",
      name: res.name ?? res.id,
      ownerBusinessId,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      const { status, message } = classifyMetaError(err);
      return { status, error: message };
    }
    return { status: "no_access", error: String(err) };
  }
}

async function verifyPixel(
  pixelId: string,
  expectedBusinessId: string | null,
  token: string,
): Promise<ResourceResult> {
  try {
    const res = await graphGetWithToken<{
      id: string;
      name?: string;
      owner_business?: { id: string; name?: string };
    }>(`/${pixelId}`, { fields: "id,name,owner_business" }, token);

    const ownerBusinessId = res.owner_business?.id;
    if (
      expectedBusinessId &&
      ownerBusinessId &&
      ownerBusinessId !== expectedBusinessId
    ) {
      return {
        status: "wrong_bm",
        name: res.name ?? res.id,
        ownerBusinessId,
        error: `Pixel is owned by Business ${ownerBusinessId}, not ${expectedBusinessId}.`,
      };
    }
    return {
      status: "ok",
      name: res.name ?? res.id,
      ownerBusinessId,
    };
  } catch (err) {
    if (err instanceof MetaApiError) {
      const { status, message } = classifyMetaError(err);
      return { status, error: message };
    }
    return { status: "no_access", error: String(err) };
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorised" }, { status: 401 });
  }

  // Body
  let body: { clientId?: string };
  try {
    body = (await request.json()) as { clientId?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clientId = body.clientId?.trim();
  if (!clientId) {
    return Response.json(
      { error: "clientId is required" },
      { status: 400 },
    );
  }

  // Load the 3 fields. RLS scopes to the current user automatically.
  const { data: client, error: dbErr } = await supabase
    .from("clients")
    .select("id, meta_business_id, meta_ad_account_id, meta_pixel_id")
    .eq("id", clientId)
    .maybeSingle();

  if (dbErr) {
    console.error("[/api/meta/verify-client] DB read error:", dbErr.message);
    return Response.json({ error: dbErr.message }, { status: 500 });
  }
  if (!client) {
    return Response.json({ error: "Client not found" }, { status: 404 });
  }

  const businessId = client.meta_business_id?.trim() || null;
  const adAccountId = client.meta_ad_account_id?.trim() || null;
  const pixelId = client.meta_pixel_id?.trim() || null;

  if (!businessId && !adAccountId && !pixelId) {
    return Response.json(
      { error: "Client has no Meta IDs configured." },
      { status: 422 },
    );
  }

  // Resolve a Meta token (user OAuth → env fallback).
  let token: string;
  let tokenSource: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
    tokenSource = resolved.source;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No Meta token available";
    console.error("[/api/meta/verify-client] token resolution failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }

  console.info(
    `[/api/meta/verify-client] client=${clientId} tokenSource=${tokenSource}` +
      ` business=${businessId ?? "—"} adAccount=${adAccountId ?? "—"} pixel=${pixelId ?? "—"}`,
  );

  // Three checks in parallel. Each branch resolves to a structured result and
  // never throws, so Promise.all is safe and we always return a complete shape.
  const [businessRes, adAccountRes, pixelRes] = await Promise.all([
    businessId
      ? verifyBusiness(businessId, token)
      : Promise.resolve<BusinessResult>({
          status: "not_found",
          error: "No Meta Business ID set on this client.",
        }),
    adAccountId
      ? verifyAdAccount(adAccountId, businessId, token)
      : Promise.resolve<ResourceResult>({
          status: "not_found",
          error: "No Meta Ad Account ID set on this client.",
        }),
    pixelId
      ? verifyPixel(pixelId, businessId, token)
      : Promise.resolve<ResourceResult>({
          status: "not_found",
          error: "No Meta Pixel ID set on this client.",
        }),
  ]);

  const payload: VerifyResponse = {
    business: businessRes,
    adAccount: adAccountRes,
    pixel: pixelRes,
  };

  console.info(
    `[/api/meta/verify-client] result client=${clientId}` +
      ` business=${businessRes.status} adAccount=${adAccountRes.status} pixel=${pixelRes.status}`,
  );

  return Response.json(payload);
}
