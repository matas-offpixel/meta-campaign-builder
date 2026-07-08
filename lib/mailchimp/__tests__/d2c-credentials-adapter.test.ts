/**
 * Unit tests for lib/mailchimp/d2c-credentials-adapter.ts#getMailchimpCredsFromD2CConnection
 *
 * Verifies the fallback bridge from `d2c_connections` (D2C onboarding) into the
 * `MailchimpCredentials` shape the tag-tracking arc expects — the fix for
 * D2C-only clients (e.g. Throwback) whose `clients.mailchimp_account_id` is
 * null (see lib/mailchimp/tag-tracking.ts#handleProfileUpdate).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

interface FakeConnectionRow {
  id: string;
  client_id: string;
  provider: string;
  created_at: string;
}

/** Fake service-role client exercising only what listD2CConnectionsForUser +
 * getD2CConnectionCredentials touch: `.from("d2c_connections")` select/eq/order
 * (thenable, list-returning) and `.rpc("get_d2c_credentials", ...)`. */
function fakeSupabase(opts: {
  connections: FakeConnectionRow[];
  credsByConnectionId: Record<string, Record<string, unknown>>;
}) {
  return {
    from(table: string) {
      assert.equal(table, "d2c_connections");
      const eqs: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          eqs[col] = val;
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          const row = opts.connections.find((c) => c.id === eqs.id);
          return Promise.resolve({ data: row ?? null, error: null });
        },
        then(resolve: (v: { data: unknown; error: null }) => void) {
          let rows = opts.connections;
          if (eqs.client_id) rows = rows.filter((r) => r.client_id === eqs.client_id);
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
    rpc: async (fn: string, args: { p_id: string }) => {
      assert.equal(fn, "get_d2c_credentials");
      return { data: opts.credsByConnectionId[args.p_id] ?? null, error: null };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let origTokenKey: string | undefined;
let origEnvFallbackKey: string | undefined;
beforeEach(() => {
  origTokenKey = process.env.D2C_TOKEN_KEY;
  process.env.D2C_TOKEN_KEY = "test-d2c-token-key-0000";
  // resolveMailchimpCredentials falls back to this env var (local-dev-only
  // convenience) when no d2c_connections row matches — clear it so the
  // "no connection" test actually exercises the null path, not a real key
  // that may be sitting in this dev shell's environment.
  origEnvFallbackKey = process.env.JACKIES_MAILCHIMP_API_KEY;
  delete process.env.JACKIES_MAILCHIMP_API_KEY;
});
afterEach(() => {
  if (origTokenKey === undefined) delete process.env.D2C_TOKEN_KEY;
  else process.env.D2C_TOKEN_KEY = origTokenKey;
  if (origEnvFallbackKey === undefined) delete process.env.JACKIES_MAILCHIMP_API_KEY;
  else process.env.JACKIES_MAILCHIMP_API_KEY = origEnvFallbackKey;
});

describe("getMailchimpCredsFromD2CConnection", () => {
  it("resolves { apiKey, dc } from the client's mailchimp d2c_connections row", async () => {
    const { getMailchimpCredsFromD2CConnection } = await import("../d2c-credentials-adapter.ts");
    const supabase = fakeSupabase({
      connections: [
        { id: "conn-1", client_id: "client-throwback", provider: "mailchimp", created_at: "2026-01-01" },
      ],
      credsByConnectionId: { "conn-1": { api_key: "testkey-us7", server_prefix: "us7" } },
    });

    const result = await getMailchimpCredsFromD2CConnection(supabase, "client-throwback", "c2b4d77acb");

    assert.deepEqual(result, {
      apiKey: "testkey-us7",
      dc: "us7",
      loginId: null,
      accountName: null,
    });
  });

  it("derives dc via parseMailchimpApiKey when server_prefix is missing from the connection", async () => {
    const { getMailchimpCredsFromD2CConnection } = await import("../d2c-credentials-adapter.ts");
    const supabase = fakeSupabase({
      connections: [
        { id: "conn-2", client_id: "client-hop", provider: "mailchimp", created_at: "2026-02-01" },
      ],
      credsByConnectionId: { "conn-2": { api_key: "anotherkey-us21" } },
    });

    const result = await getMailchimpCredsFromD2CConnection(supabase, "client-hop", "aud-1");

    assert.deepEqual(result, {
      apiKey: "anotherkey-us21",
      dc: "us21",
      loginId: null,
      accountName: null,
    });
  });

  it("returns null when the client has no mailchimp d2c_connections row", async () => {
    const { getMailchimpCredsFromD2CConnection } = await import("../d2c-credentials-adapter.ts");
    const supabase = fakeSupabase({
      connections: [
        { id: "conn-3", client_id: "some-other-client", provider: "mailchimp", created_at: "2026-01-01" },
      ],
      credsByConnectionId: {},
    });

    const result = await getMailchimpCredsFromD2CConnection(supabase, "client-throwback", "aud-1");
    assert.equal(result, null);
  });

  it("returns null when clientId is missing (no live network/DB round trip)", async () => {
    const { getMailchimpCredsFromD2CConnection } = await import("../d2c-credentials-adapter.ts");
    const result = await getMailchimpCredsFromD2CConnection(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      null,
      "aud-1",
    );
    assert.equal(result, null);
  });
});
