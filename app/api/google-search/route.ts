import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { createGoogleSearchPlan } from "@/lib/db/google-search-plans";

/**
 * POST /api/google-search
 *
 * Creates a blank Google Search plan owned by the authenticated user
 * and returns its id so the client can redirect into the wizard at
 * `/google-search/[id]`.
 *
 * Optional JSON body:
 *   {
 *     name?: string,
 *     event_id?: string | null,
 *     google_ads_account_id?: string | null
 *   }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    event_id?: string | null;
    google_ads_account_id?: string | null;
  };

  try {
    const plan = await createGoogleSearchPlan(supabase, {
      user_id: user.id,
      name: body.name?.trim() || "New Google Search plan",
      event_id: body.event_id ?? null,
      google_ads_account_id: body.google_ads_account_id ?? null,
    });
    return NextResponse.json({ ok: true, plan_id: plan.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to create plan" },
      { status: 500 },
    );
  }
}
