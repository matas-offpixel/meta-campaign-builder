import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
import {
  getGoogleAdsCredentials,
  setGoogleAdsCredentials,
  type GoogleAdsCredentials,
} from "../credentials.ts";
import {
  createGoogleAdsOAuthState,
  exchangeGoogleAdsOAuthCode,
  verifyGoogleAdsOAuthState,
} from "../oauth.ts";

describe("Google Ads OAuth", () => {
  it("builds a signed state token and verifies the nonce", () => {
    const { state, nonce } = createGoogleAdsOAuthState({
      secret: "client-secret",
      customerId: "3337038088",
    });
    const parsed = verifyGoogleAdsOAuthState({
      state,
      expectedNonce: nonce,
      secret: "client-secret",
    });

    assert.equal(parsed.nonce, nonce);
    assert.equal(parsed.customerId, "333-703-8088");
  });

  it("exchanges an auth code for Google OAuth tokens", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const token = await exchangeGoogleAdsOAuthCode(
      "auth-code",
      {
        clientId: "client-id",
        clientSecret: "secret",
        redirectUri: "https://example.com/api/google-ads/oauth/callback",
        stateSecret: "state-secret",
      },
      async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              access_token: "access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
              token_type: "Bearer",
            };
          },
          async text() {
            return "";
          },
        };
      },
    );

    assert.equal(calls[0]?.input, "https://oauth2.googleapis.com/token");
    assert.equal(token.access_token, "access-token");
    assert.equal(token.refresh_token, "refresh-token");
    assert.equal(String(calls[0]?.init.body).includes("grant_type=authorization_code"), true);
  });

  it("round-trips credentials through the pgcrypto RPC helper shape", async () => {
    let encrypted: string | null = null;
    const supabase = {
      async rpc(name: string, args: Record<string, string | null>) {
        if (name === "set_google_ads_credentials") {
          encrypted = `encrypted:${args.p_plaintext}:${args.p_key}`;
          return { data: null, error: null };
        }
        if (name === "get_google_ads_credentials") {
          assert.ok(encrypted, "expected encrypted bytea stand-in to be non-empty");
          const prefix = "encrypted:";
          const suffix = `:${args.p_key}`;
          if (!encrypted.startsWith(prefix) || !encrypted.endsWith(suffix)) {
            return { data: null, error: null };
          }
          return {
            data: encrypted.slice(prefix.length, -suffix.length),
            error: null,
          };
        }
        return {
          data: null,
          error: { message: `Unexpected RPC ${name}` },
        };
      },
    } as unknown as SupabaseClient<Database>;

    const credentials: GoogleAdsCredentials = {
      access_token: "access-token",
      refresh_token: "refresh-token",
      customer_id: "333-703-8088",
      login_customer_id: "333-703-8088",
      scope: "https://www.googleapis.com/auth/adwords",
      token_type: "Bearer",
      expires_in: 3600,
      expiry_date: 1_800_000_000_000,
    };
    await setGoogleAdsCredentials(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      credentials,
      "test-key",
    );
    assert.notEqual(encrypted, null);

    const roundTripped = await getGoogleAdsCredentials(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      "test-key",
    );

    assert.deepEqual(roundTripped, credentials);
  });
});
