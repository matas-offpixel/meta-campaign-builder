/**
 * Tests for lib/meta/repair-write-token.ts — task #128 continued.
 *
 * Root cause under test: scripts/repair-video-thumbnails.mjs's write pass
 * (POST /adimages + POST /{creativeId}) failed all 42 targets with Meta
 * error code=3 "Application does not have the capability to make this API
 * call" because it used META_ACCESS_TOKEN (a system app token still in App
 * Review) for writes. The wizard's own launch-campaign/route.ts never hits
 * this because it resolves the operator's personal Facebook OAuth token
 * from user_facebook_tokens first. resolveWriteToken mirrors that priority
 * order for this single-operator admin script: --token override >
 * user_facebook_tokens row > META_ACCESS_TOKEN env fallback.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveWriteToken,
  describeWriteTokenSource,
  isMetaMissingCapabilityError,
  MISSING_CAPABILITY_HINT,
  type SupabaseLike,
  type UserFacebookTokensQueryResult,
} from "../repair-write-token.ts";

// ─── Mock Supabase helpers ────────────────────────────────────────────────

/** Builds a minimal fake matching the exact fluent chain resolveWriteToken calls. */
function fakeSupabase(result: UserFacebookTokensQueryResult, capture?: { table?: string; columns?: string }): SupabaseLike {
  return {
    from: (table) => {
      if (capture) capture.table = table;
      return {
        select: (columns) => {
          if (capture) capture.columns = columns;
          return {
            not: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => result,
                }),
              }),
            }),
          };
        },
      };
    },
  };
}

function throwingSupabase(err: Error): SupabaseLike {
  return {
    from: () => ({
      select: () => ({
        not: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: async () => {
                throw err;
              },
            }),
          }),
        }),
      }),
    }),
  };
}

// ─── resolveWriteToken ────────────────────────────────────────────────────

describe("resolveWriteToken", () => {
  it("prefers the --token override even when a valid DB row exists", async () => {
    const supabase = fakeSupabase({
      data: { provider_token: "db_token", expires_at: "2026-09-01T00:00:00Z" },
      error: null,
    });
    const resolved = await resolveWriteToken(supabase, "env_token", "override_token");
    assert.deepEqual(resolved, { token: "override_token", source: "override", expiresAt: null });
  });

  it("uses the user_facebook_tokens row when present, over the env fallback", async () => {
    const capture: { table?: string; columns?: string } = {};
    const supabase = fakeSupabase(
      { data: { provider_token: "user_oauth_token", expires_at: "2026-09-01T00:00:00Z" }, error: null },
      capture,
    );
    const resolved = await resolveWriteToken(supabase, "env_token");
    assert.deepEqual(resolved, { token: "user_oauth_token", source: "user_facebook_token", expiresAt: "2026-09-01T00:00:00Z" });
    assert.equal(capture.table, "user_facebook_tokens");
    assert.ok(capture.columns?.includes("provider_token"), `expected provider_token in select columns — got ${capture.columns}`);
  });

  it("falls back to env when the DB row has no expires_at recorded", async () => {
    const supabase = fakeSupabase({ data: { provider_token: "user_oauth_token", expires_at: null }, error: null });
    const resolved = await resolveWriteToken(supabase, "env_token");
    assert.equal(resolved.token, "user_oauth_token");
    assert.equal(resolved.source, "user_facebook_token");
    assert.equal(resolved.expiresAt, null);
  });

  it("falls back to env (regression: dry-run env-only path) when no user_facebook_tokens row exists", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    const resolved = await resolveWriteToken(supabase, "env_token");
    assert.deepEqual(resolved, { token: "env_token", source: "env", expiresAt: null });
  });

  it("falls back to env when the DB query returns an error", async () => {
    const supabase = fakeSupabase({ data: null, error: { message: "connection refused" } });
    const resolved = await resolveWriteToken(supabase, "env_token");
    assert.deepEqual(resolved, { token: "env_token", source: "env", expiresAt: null });
  });

  it("falls back to env when the DB row has a null provider_token", async () => {
    const supabase = fakeSupabase({ data: { provider_token: null }, error: null });
    const resolved = await resolveWriteToken(supabase, "env_token");
    assert.equal(resolved.source, "env");
  });

  it("falls back to env when the DB call throws", async () => {
    const supabase = throwingSupabase(new Error("network blip"));
    const resolved = await resolveWriteToken(supabase, "env_token");
    assert.deepEqual(resolved, { token: "env_token", source: "env", expiresAt: null });
  });

  it("throws a helpful error when neither DB nor env has a token", async () => {
    const supabase = fakeSupabase({ data: null, error: null });
    await assert.rejects(() => resolveWriteToken(supabase, undefined), /No Meta write token available/);
  });
});

// ─── describeWriteTokenSource ─────────────────────────────────────────────

describe("describeWriteTokenSource", () => {
  it("formats the user_facebook_token source with its expiry", () => {
    assert.equal(
      describeWriteTokenSource({ token: "t", source: "user_facebook_token", expiresAt: "2026-09-01T00:00:00Z" }),
      "source=user_facebook_token (expires 2026-09-01T00:00:00Z)",
    );
  });

  it("formats the user_facebook_token source with an unknown expiry", () => {
    assert.equal(
      describeWriteTokenSource({ token: "t", source: "user_facebook_token", expiresAt: null }),
      "source=user_facebook_token (expires unknown)",
    );
  });

  it("formats the env source with the dev-mode-risk warning", () => {
    assert.equal(
      describeWriteTokenSource({ token: "t", source: "env", expiresAt: null }),
      "source=env META_ACCESS_TOKEN (dev-mode risk)",
    );
  });

  it("formats the override source", () => {
    assert.equal(
      describeWriteTokenSource({ token: "t", source: "override", expiresAt: null }),
      "source=override (--token flag)",
    );
  });
});

// ─── isMetaMissingCapabilityError ─────────────────────────────────────────

describe("isMetaMissingCapabilityError", () => {
  it("flags a duck-typed error object with code=3", () => {
    assert.equal(isMetaMissingCapabilityError({ code: 3, message: "whatever" }), true);
  });

  it("flags a plain Error whose message carries Meta's (#3) marker", () => {
    assert.equal(
      isMetaMissingCapabilityError(new Error("POST /act_123/adimages failed: (#3) Application does not have the capability")),
      true,
    );
  });

  it("flags a plain Error whose message carries the capability wording without the (#3) marker", () => {
    assert.equal(isMetaMissingCapabilityError(new Error("Application does not have the capability to make this API call")), true);
  });

  it("does NOT flag an unrelated error code", () => {
    assert.equal(isMetaMissingCapabilityError({ code: 190, message: "Invalid OAuth access token" }), false);
  });

  it("does NOT flag an unrelated plain Error message", () => {
    assert.equal(isMetaMissingCapabilityError(new Error("Network timeout")), false);
  });

  it("does NOT flag undefined/null", () => {
    assert.equal(isMetaMissingCapabilityError(undefined), false);
    assert.equal(isMetaMissingCapabilityError(null), false);
  });
});

// ─── MISSING_CAPABILITY_HINT ───────────────────────────────────────────────

describe("MISSING_CAPABILITY_HINT", () => {
  it("mentions both remediation paths (token scope + --token override)", () => {
    assert.ok(MISSING_CAPABILITY_HINT.includes("META_ACCESS_TOKEN"));
    assert.ok(MISSING_CAPABILITY_HINT.includes("--token="));
  });
});
