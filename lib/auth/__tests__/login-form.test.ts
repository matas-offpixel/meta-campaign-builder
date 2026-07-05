import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INVALID_CREDENTIALS_MESSAGE,
  mapMagicLinkError,
  mapPasswordSignInError,
  signInWithPasswordBoundary,
  toggleLoginFormMode,
} from "../login-form.ts";

describe("toggleLoginFormMode", () => {
  it("swaps password → magic-link (Forgot password link)", () => {
    assert.equal(toggleLoginFormMode("password"), "magic-link");
  });

  it("swaps magic-link → password (back link)", () => {
    assert.equal(toggleLoginFormMode("magic-link"), "password");
  });
});

describe("mapPasswordSignInError", () => {
  it("maps Supabase invalid credentials to typed error", () => {
    const result = mapPasswordSignInError("Invalid login credentials");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "invalid_credentials");
    assert.equal(result.message, INVALID_CREDENTIALS_MESSAGE);
  });

  it("passes through other errors verbatim", () => {
    const result = mapPasswordSignInError("Rate limit exceeded");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "other");
    assert.equal(result.message, "Rate limit exceeded");
  });
});

describe("signInWithPasswordBoundary", () => {
  it("happy path returns ok:true", async () => {
    const result = await signInWithPasswordBoundary(
      async () => ({ error: null }),
      "matt@example.com",
      "secret-pass",
    );
    assert.deepEqual(result, { ok: true });
  });

  it("wrong password returns invalid_credentials", async () => {
    const result = await signInWithPasswordBoundary(
      async () => ({ error: { message: "Invalid login credentials" } }),
      "matt@example.com",
      "wrong",
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "invalid_credentials");
    assert.equal(result.message, INVALID_CREDENTIALS_MESSAGE);
  });

  it("trims email before calling signIn", async () => {
    let capturedEmail = "";
    await signInWithPasswordBoundary(
      async (email) => {
        capturedEmail = email;
        return { error: null };
      },
      "  matt@example.com  ",
      "pass",
    );
    assert.equal(capturedEmail, "matt@example.com");
  });

  it("rejects empty password without calling signIn", async () => {
    let called = false;
    const result = await signInWithPasswordBoundary(
      async () => {
        called = true;
        return { error: null };
      },
      "matt@example.com",
      "",
    );
    assert.equal(called, false);
    assert.equal(result.ok, false);
  });
});

describe("mapMagicLinkError", () => {
  it("admin invite-only copy for unknown email", () => {
    assert.equal(
      mapMagicLinkError("Signups not allowed for otp", "admin"),
      "This email isn't registered. Contact Off/Pixel to get access.",
    );
  });

  it("operator passes through unknown-email errors", () => {
    assert.equal(
      mapMagicLinkError("Signups not allowed for otp", "operator"),
      "Signups not allowed for otp",
    );
  });
});
