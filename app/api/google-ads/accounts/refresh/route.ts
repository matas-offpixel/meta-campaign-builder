import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { GoogleAdsClient } from "@/lib/google-ads/client";
import { enumerateGoogleAdsAccountsDetailed } from "@/lib/google-ads/customer-hierarchy";
import {
  getGoogleAdsCredentials,
  setGoogleAdsCredentials,
  type GoogleAdsCredentials,
} from "@/lib/google-ads/credentials";
import { GOOGLE_ADS_LOGIN_CUSTOMER_ID } from "@/lib/google-ads/oauth";
import {
  countNewGoogleAdsAccounts,
  formatGoogleAdsRefreshReport,
  googleAdsRefreshCooldownRemaining,
  skipsAbsentFromUpsert,
} from "@/lib/google-ads/refresh-report";
import { GOOGLE_ADS_RECONNECT_ERROR_COOKIE } from "@/lib/google-ads/reconnect-error";
import { upsertGoogleAdsAccount } from "@/lib/google-ads/upsert-account";

/**
 * Re-runs account enumeration with the stored refresh token.
 * One request, one walk. A 30s cooldown stops a tight click loop from
 * spending the Google Ads daily operation cap.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("id, account_name, google_customer_id, login_customer_id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("account_name", { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  const stored = data ?? [];
  if (stored.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No Google Ads connection to refresh. Reconnect first." },
      { status: 400 },
    );
  }

  const retryAfterMs = googleAdsRefreshCooldownRemaining(stored.map((row) => row.updated_at));
  if (retryAfterMs > 0) {
    const seconds = Math.ceil(retryAfterMs / 1000);
    return NextResponse.json(
      {
        ok: false,
        error: `Refresh accounts was just run. Try again in ${seconds} seconds.`,
        retryAfterMs,
      },
      { status: 429 },
    );
  }

  const source =
    stored.find((row) => row.google_customer_id === GOOGLE_ADS_LOGIN_CUSTOMER_ID) ?? stored[0];
  let credentials: GoogleAdsCredentials | null;
  try {
    credentials = await getGoogleAdsCredentials(supabase, source.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the stored Google Ads token.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
  if (!credentials?.refresh_token) {
    return NextResponse.json(
      { ok: false, error: "Stored Google Ads token has no refresh token. Reconnect." },
      { status: 400 },
    );
  }

  try {
    const client = new GoogleAdsClient();
    const accessibleIds = await client.listAccessibleCustomers(credentials.refresh_token);
    const report = await enumerateGoogleAdsAccountsDetailed({
      refreshToken: credentials.refresh_token,
      accessibleIds,
      client,
    });
    const skipped = skipsAbsentFromUpsert(report.skipped, report.accounts);
    if (report.accounts.length === 0) {
      const reason = skipped[0]?.reason ?? "No enabled Google Ads accounts found.";
      return jsonWithReconnectError(reason, 502);
    }

    const newlyAdded = countNewGoogleAdsAccounts(
      stored.map((row) => row.google_customer_id),
      report.accounts,
    );
    for (const account of report.accounts) {
      const upserted = await upsertGoogleAdsAccount({
        userId: user.id,
        customerId: account.customerId,
        loginCustomerId: account.loginCustomerId,
        accountName: account.accountName,
        supabase,
      });
      if (upserted.created) {
        await setGoogleAdsCredentials(supabase, upserted.id, {
          ...credentials,
          customer_id: account.customerId,
          login_customer_id: account.loginCustomerId ?? credentials.login_customer_id,
        });
      }
    }

    const { data: refreshed, error: rereadError } = await supabase
      .from("google_ads_accounts")
      .select("id, account_name, google_customer_id, updated_at")
      .eq("user_id", user.id)
      .order("account_name", { ascending: true });
    if (rereadError) {
      return NextResponse.json({ ok: false, error: rereadError.message }, { status: 500 });
    }

    const enumeratedAt = (refreshed ?? []).reduce<string | null>((latest, row) => {
      if (!latest || row.updated_at > latest) return row.updated_at;
      return latest;
    }, null);

    const body = {
      ok: true as const,
      found: report.accounts.length,
      newCount: newlyAdded,
      skipped: skipped.map((skip) => ({
        customerId: skip.customerId,
        reason: skip.reason,
      })),
      report: formatGoogleAdsRefreshReport({
        found: report.accounts.length,
        newlyAdded,
        skipped,
      }),
      enumeratedAt,
      accounts: (refreshed ?? []).map((row) => ({
        id: row.id,
        name: row.account_name,
        meta: row.google_customer_id ? `Customer ${row.google_customer_id}` : "Customer id pending",
      })),
    };
    const res = NextResponse.json(body);
    res.cookies.delete(GOOGLE_ADS_RECONNECT_ERROR_COOKIE);
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refresh accounts failed.";
    return jsonWithReconnectError(message, 502);
  }
}

function jsonWithReconnectError(message: string, status: number): NextResponse {
  const res = NextResponse.json({ ok: false, error: message }, { status });
  res.cookies.set(GOOGLE_ADS_RECONNECT_ERROR_COOKIE, message.slice(0, 500), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
