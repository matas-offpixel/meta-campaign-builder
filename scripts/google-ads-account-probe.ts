#!/usr/bin/env node
/**
 * Read-only Google Ads account probe.
 *
 * Uses the stored refresh token and prints what listAccessibleCustomers,
 * an unfiltered customer_client walk, and customer_client_link return.
 * Does not insert or update google_ads_accounts.
 *
 * A script rather than a route: this has to run before the change is
 * deployed, and a URL would be another way to spend the daily operation cap.
 *
 *   set -a && source .env.local && set +a
 *   node --experimental-strip-types scripts/google-ads-account-probe.ts
 */

import { createClient } from "@supabase/supabase-js";

import { probeGoogleAdsAccounts } from "../lib/google-ads/account-probe.ts";
import { GoogleAdsClient } from "../lib/google-ads/client.ts";
import { getGoogleAdsCredentials, requireGoogleAdsTokenKey } from "../lib/google-ads/credentials.ts";

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  requireGoogleAdsTokenKey();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("google_ads_accounts")
    .select("id, account_name, google_customer_id, login_customer_id, created_at, updated_at")
    .order("account_name", { ascending: true });
  if (error) throw new Error(error.message);
  const stored = data ?? [];
  if (stored.length === 0) throw new Error("google_ads_accounts has no rows.");

  const source =
    stored.find((row) => row.google_customer_id === "333-703-8088") ?? stored[0];
  const credentials = await getGoogleAdsCredentials(supabase as never, source.id);
  if (!credentials?.refresh_token) {
    throw new Error(`No refresh token on ${source.google_customer_id}.`);
  }

  const report = await probeGoogleAdsAccounts({
    refreshToken: credentials.refresh_token,
    client: new GoogleAdsClient(),
    storedAccounts: stored.map((row) => ({
      account_name: row.account_name,
      google_customer_id: row.google_customer_id,
      login_customer_id: row.login_customer_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        sourceCustomerId: source.google_customer_id,
        stored: stored.map((row) => ({
          account_name: row.account_name,
          google_customer_id: row.google_customer_id,
          login_customer_id: row.login_customer_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
        ...report,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
