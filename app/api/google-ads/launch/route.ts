import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/google-ads/launch
 *
 * Launches a saved plan into the user's Google Ads account. STUB.
 * Returns `{ ok: false, reason: 'not_configured' }` until OAuth is
 * wired and we have a Google Ads API client to push the campaign tree
 * into the customer.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const planId =
    body && typeof body === "object"
      ? (body as Record<string, unknown>).planId
      : null;
  if (typeof planId !== "string" || !planId) {
    return NextResponse.json(
      { ok: false, error: "Missing planId in body" },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      reason: "not_configured",
      error: "API credentials required",
    },
    { status: 200 },
  );
}
