import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../db/database.types.ts";
import {
  getTikTokCredentials,
  setTikTokCredentials,
  type TikTokCredentials,
} from "../credentials.ts";
import { exchangeTikTokOAuthCode } from "../oauth.ts";

describe("TikTok OAuth", () => {
  it("exchanges an auth code and parses advertiser_ids", async () => {
    const calls: Array<{ input: string; init: RequestInit }> = [];
    const token = await exchangeTikTokOAuthCode(
      "auth-code",
      {
        appId: "app-id",
        appSecret: "secret",
        redirectUri: "https://example.com/api/tiktok/oauth/callback",
      },
      async (input, init) => {
        calls.push({ input, init });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              code: 0,
              data: {
                access_token: "access-token",
                advertiser_ids: ["123", "456"],
                scope: "advertiser.read",
              },
            };
          },
        };
      },
    );

    assert.equal(
      calls[0]?.input,
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
    );
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    assert.equal(body.auth_code, "auth-code");
    assert.equal(token.access_token, "access-token");
    assert.deepEqual(token.advertiser_ids, ["123", "456"]);
  });

  it("round-trips credentials through the pgcrypto RPC helper shape", async () => {
    let encrypted: string | null = null;
    const supabase = {
      async rpc(name: string, args: Record<string, string>) {
        if (name === "set_tiktok_credentials") {
          encrypted = `encrypted:${args.p_plaintext}:${args.p_key}`;
          return { data: null, error: null };
        }
        if (name === "get_tiktok_credentials") {
          const prefix = `encrypted:`;
          const suffix = `:${args.p_key}`;
          if (!encrypted?.startsWith(prefix) || !encrypted.endsWith(suffix)) {
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

    const credentials: TikTokCredentials = {
      access_token: "access-token",
      advertiser_ids: ["123"],
      scope: "advertiser.read",
    };
    await setTikTokCredentials(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      credentials,
      "test-key",
    );
    const roundTripped = await getTikTokCredentials(
      supabase,
      "00000000-0000-0000-0000-000000000001",
      "test-key",
    );

    assert.deepEqual(roundTripped, {
      access_token: "access-token",
      advertiser_ids: ["123"],
      scope: "advertiser.read",
      token_type: null,
      expires_in: null,
      refresh_token: null,
      refresh_token_expires_in: null,
      open_id: null,
    });
  });
});
