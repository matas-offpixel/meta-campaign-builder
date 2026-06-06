/**
 * Tests for dropbox-auth.ts — refresh-token-based OAuth flow.
 *
 * Covers:
 *   - Missing env vars (any of the three) → config_missing
 *   - 200 success → returns access_token, caches it
 *   - Cache hit within TTL → token endpoint called only once across two calls
 *   - Cache expired → token endpoint called twice
 *   - 400/401 from token endpoint → forbidden with regenerate message
 *   - 500 from token endpoint → network error
 *
 * Run: node --test
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import { getDropboxAccessToken, _clearTokenCache } from "../dropbox-auth.ts";
import { DropboxFetchError } from "../dropbox.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TOKEN_ENDPOINT = "https://api.dropbox.com/oauth2/token";

function makeTokenResponse(opts: {
  status: number;
  ok: boolean;
  body?: unknown;
  text?: string;
}): Response {
  return {
    status: opts.status,
    ok: opts.ok,
    json: async () => opts.body,
    text: async () => opts.text ?? JSON.stringify(opts.body ?? ""),
  } as unknown as Response;
}

function successResponse(accessToken = "sl.test_access_token", expiresIn = 14400) {
  return makeTokenResponse({
    status: 200,
    ok: true,
    body: { access_token: accessToken, expires_in: expiresIn, token_type: "bearer" },
  });
}

// ─── Env + cache harness ─────────────────────────────────────────────────────

const SAVED_ENV = {
  DROPBOX_REFRESH_TOKEN: process.env.DROPBOX_REFRESH_TOKEN,
  DROPBOX_APP_KEY: process.env.DROPBOX_APP_KEY,
  DROPBOX_APP_SECRET: process.env.DROPBOX_APP_SECRET,
};

function setValidEnv() {
  process.env.DROPBOX_REFRESH_TOKEN = "rt_valid";
  process.env.DROPBOX_APP_KEY = "app_key_valid";
  process.env.DROPBOX_APP_SECRET = "app_secret_valid";
}

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  _clearTokenCache();
  mock.restoreAll();
});

// ─── Missing env vars ─────────────────────────────────────────────────────────

describe("getDropboxAccessToken — missing env vars", () => {
  it("throws config_missing when DROPBOX_REFRESH_TOKEN is absent", async () => {
    setValidEnv();
    delete process.env.DROPBOX_REFRESH_TOKEN;
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "config_missing");
        return true;
      },
    );
  });

  it("throws config_missing when DROPBOX_APP_KEY is absent", async () => {
    setValidEnv();
    delete process.env.DROPBOX_APP_KEY;
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "config_missing");
        return true;
      },
    );
  });

  it("throws config_missing when DROPBOX_APP_SECRET is absent", async () => {
    setValidEnv();
    delete process.env.DROPBOX_APP_SECRET;
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "config_missing");
        return true;
      },
    );
  });
});

// ─── Success + caching ────────────────────────────────────────────────────────

describe("getDropboxAccessToken — success + caching", () => {
  it("returns access_token on 200", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async (url: string) => {
      assert.equal(url, TOKEN_ENDPOINT);
      return successResponse("sl.fresh_token");
    });
    const token = await getDropboxAccessToken();
    assert.equal(token, "sl.fresh_token");
  });

  it("returns cached token on second call within TTL (token endpoint called once)", async () => {
    setValidEnv();
    let callCount = 0;
    mock.method(globalThis, "fetch", async () => {
      callCount++;
      return successResponse("sl.cached_token", 14400);
    });

    const first = await getDropboxAccessToken();
    const second = await getDropboxAccessToken();

    assert.equal(first, "sl.cached_token");
    assert.equal(second, "sl.cached_token");
    assert.equal(callCount, 1, "token endpoint called only once — cache hit");
  });

  it("re-fetches when cache TTL is elapsed", async () => {
    setValidEnv();
    let callCount = 0;
    mock.method(globalThis, "fetch", async () => {
      callCount++;
      // expires_in=0 means expiresAt = Date.now() - 5min < Date.now() → always expired
      return successResponse(`sl.token_${callCount}`, 0);
    });

    const first = await getDropboxAccessToken();
    const second = await getDropboxAccessToken();

    assert.equal(first, "sl.token_1");
    assert.equal(second, "sl.token_2");
    assert.equal(callCount, 2, "token endpoint called twice — expired cache");
  });
});

// ─── Error responses ─────────────────────────────────────────────────────────

describe("getDropboxAccessToken — error responses", () => {
  it("throws forbidden on 400 (invalid_grant)", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () =>
      makeTokenResponse({
        status: 400,
        ok: false,
        body: { error: "invalid_grant", error_description: "refresh token invalid" },
      }),
    );
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "forbidden");
        assert.ok(
          err.message.includes("DROPBOX_REFRESH_TOKEN"),
          "message mentions which var to regenerate",
        );
        return true;
      },
    );
  });

  it("throws forbidden on 401", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () =>
      makeTokenResponse({ status: 401, ok: false, text: "unauthorized" }),
    );
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "forbidden");
        return true;
      },
    );
  });

  it("throws network on 500", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () =>
      makeTokenResponse({ status: 500, ok: false, text: "internal server error" }),
    );
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "network");
        return true;
      },
    );
  });

  it("throws network on fetch exception", async () => {
    setValidEnv();
    mock.method(globalThis, "fetch", async () => {
      throw new Error("ECONNREFUSED");
    });
    await assert.rejects(
      () => getDropboxAccessToken(),
      (err: unknown) => {
        assert.ok(err instanceof DropboxFetchError);
        assert.equal(err.code, "network");
        return true;
      },
    );
  });
});
