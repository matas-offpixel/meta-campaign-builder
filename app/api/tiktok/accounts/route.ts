import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import type { TikTokAccount } from "@/lib/types/tiktok";

/**
 * GET /api/tiktok/accounts
 *
 * Returns the linked TikTok accounts for the current user. The
 * advertiser id may be null for accounts created from the dashboard
 * picker before the OAuth flow has run — the UI surfaces those as
 * "Not configured".
 *
 * Once the OAuth flow lands, this becomes the read side for the linked-
 * accounts dropdown across the dashboard.
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
    TikTokAccount,
    | "id"
    | "user_id"
    | "account_name"
    | "tiktok_advertiser_id"
    | "created_at"
    | "updated_at"
  >;

  const { data, error } = await supabase
    .from("tiktok_accounts")
    .select(
      "id, user_id, account_name, tiktok_advertiser_id, created_at, updated_at",
    )
    .eq("user_id", user.id)
    .order("account_name", { ascending: true });

  if (error) {
    console.warn("[tiktok/accounts] read failed:", error.message);
    return NextResponse.json(
      { ok: true, accounts: [] as AccountRow[] },
      { status: 200 },
    );
  }

  const accounts = (data ?? []) as AccountRow[];
  return NextResponse.json({ ok: true, accounts }, { status: 200 });
}
