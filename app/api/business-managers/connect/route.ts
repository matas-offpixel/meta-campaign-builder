import { NextResponse } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireOperator } from "@/lib/bm/route-auth";
import {
  MissingUserFacebookTokenError,
  resolveUserFacebookToken,
} from "@/lib/bm/user-token";
import { validateMetaToken } from "@/lib/meta/server-token";
import { listBusinessManagers } from "@/lib/meta/business-manager";
import { upsertBusinessManagerWithToken } from "@/lib/db/business-managers";
import { MissingBMTokenKeyError } from "@/lib/bm/secrets";

/**
 * POST /api/business-managers/connect
 *
 * Connects the operator's Business Managers using their EXISTING personal
 * Facebook OAuth token (reused when its scopes already cover
 * `business_management` — which the app's OAuth already requests, so no new
 * consent screen in the common case). Enumerates /me/businesses and upserts one
 * encrypted-token row per BM.
 *
 * Never touches META_ACCESS_TOKEN — acts exclusively as the operator.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  // 1. Personal OAuth token (no env fallback).
  let userToken: string;
  try {
    ({ token: userToken } = await resolveUserFacebookToken(supabase, user.id));
  } catch (err) {
    if (err instanceof MissingUserFacebookTokenError) {
      return NextResponse.json(
        { ok: false, needsReconnect: true, error: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  // 2. Validate + scope check.
  const validation = await validateMetaToken(userToken);
  if (!validation.valid) {
    return NextResponse.json(
      {
        ok: false,
        needsReconnect: true,
        error: validation.error ?? "Facebook token is invalid — reconnect your account.",
      },
      { status: 400 },
    );
  }
  const scopes = validation.scopes ?? [];
  if (!scopes.includes("business_management")) {
    return NextResponse.json(
      {
        ok: false,
        needsReconnect: true,
        missingScope: "business_management",
        error:
          "Your Facebook connection is missing the business_management permission. Reconnect Facebook to grant it.",
      },
      { status: 400 },
    );
  }

  // 3. Enumerate Business Managers.
  let businesses;
  try {
    businesses = await listBusinessManagers(userToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[bm connect] listBusinessManagers failed:", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }

  // 4. Persist (service-role — bypasses RLS after the operator gate above).
  let service: ReturnType<typeof createServiceRoleClient>;
  try {
    service = createServiceRoleClient();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Service client unavailable" },
      { status: 500 },
    );
  }

  const connected: { id: string; business_id: string; business_name: string | null }[] = [];
  try {
    for (const biz of businesses) {
      const id = await upsertBusinessManagerWithToken(service, {
        businessId: biz.id,
        businessName: biz.name ?? null,
        addedByUserId: user.id,
        scopes,
        token: userToken,
      });
      if (id) {
        connected.push({ id, business_id: biz.id, business_name: biz.name ?? null });
      }
    }
  } catch (err) {
    if (err instanceof MissingBMTokenKeyError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
    throw err;
  }

  return NextResponse.json({
    ok: true,
    discovered: businesses.length,
    connected: connected.length,
    businesses: connected,
  });
}
