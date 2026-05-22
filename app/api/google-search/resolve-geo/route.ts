import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GoogleAdsClient } from "@/lib/google-ads/client";
import { getGoogleAdsCredentials } from "@/lib/google-ads/credentials";
import { resolveGeoLocation } from "@/lib/google-ads/geo-resolve";

/**
 * POST /api/google-search/resolve-geo
 *
 * Live geo-target resolution preview — called by the Targeting & Budget
 * wizard step as the operator types a location string.
 *
 * Body: `{ location: string, google_ads_account_id: string }`
 *
 * Uses the SAME `resolveGeoLocation` function that the push adapter
 * (`campaign-writer.ts`) uses — zero divergence risk.
 *
 * Returns:
 *   200 { ok: true, matches: [{ resourceName, canonicalName, countryCode, targetType, source }] }
 *   200 { ok: false, reason: "no_match" }
 *   400 { ok: false, reason: "bad_request" }
 *   401 { ok: false, reason: "unauthenticated" }
 *   422 { ok: false, reason: "no_credentials_for_account" | "no_account_id" }
 *   502 { ok: false, reason: "credentials_load_failed" }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, reason: "unauthenticated" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    location?: unknown;
    google_ads_account_id?: unknown;
  } | null;

  const location = typeof body?.location === "string" ? body.location.trim() : null;
  const accountId =
    typeof body?.google_ads_account_id === "string" ? body.google_ads_account_id : null;

  if (!location) {
    return NextResponse.json(
      { ok: false, reason: "bad_request", details: "location must be a non-empty string." },
      { status: 400 },
    );
  }
  if (!accountId) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no_account_id",
        details: "google_ads_account_id is required.",
      },
      { status: 422 },
    );
  }

  let credentials;
  try {
    credentials = await getGoogleAdsCredentials(supabase as never, accountId);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reason: "credentials_load_failed",
        details: err instanceof Error ? err.message : "Failed to decrypt Google Ads credentials.",
      },
      { status: 502 },
    );
  }
  if (!credentials) {
    return NextResponse.json(
      {
        ok: false,
        reason: "no_credentials_for_account",
        details:
          "The linked Google Ads account has no decrypted credentials. Reconnect via Settings → Connections.",
      },
      { status: 422 },
    );
  }

  const client = new GoogleAdsClient({
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "",
    clientId: process.env.GOOGLE_ADS_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET ?? "",
  });

  const match = await resolveGeoLocation(location, client, {
    customerId: credentials.customer_id,
    refreshToken: credentials.refresh_token,
    loginCustomerId: credentials.login_customer_id,
  });

  if (!match) {
    return NextResponse.json({ ok: false, reason: "no_match" });
  }

  return NextResponse.json({ ok: true, matches: [match] });
}
