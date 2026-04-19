import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { GoogleAdsAccount } from "@/lib/types/google-ads";

/**
 * GET /api/google-ads/accounts
 *
 * Returns the linked Google Ads accounts for the current user.
 * google_customer_id may be null until the verification step has been
 * run — the dashboard surfaces those as "Not configured".
 */
export async function GET() {
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

  type AccountRow = Pick<
    GoogleAdsAccount,
    | "id"
    | "user_id"
    | "account_name"
    | "google_customer_id"
    | "created_at"
    | "updated_at"
  >;

  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select(
      "id, user_id, account_name, google_customer_id, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .order("account_name", { ascending: true });

  if (error) {
    console.warn("[google-ads/accounts] read failed:", error.message);
    return NextResponse.json(
      { ok: true, accounts: [] as AccountRow[] },
      { status: 200 },
    );
  }

  const accounts = (data ?? []) as AccountRow[];
  return NextResponse.json({ ok: true, accounts }, { status: 200 });
}
