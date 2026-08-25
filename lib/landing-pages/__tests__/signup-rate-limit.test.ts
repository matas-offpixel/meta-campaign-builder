import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  _resetLandingPageRateLimitForTests,
  _resetPageViewRateLimitForTests,
  _resetSignupRateLimitForTests,
  buildPageViewRateLimitKey,
  buildSignupRateLimitKey,
  checkLandingPageRateLimit,
  checkPageViewRateLimit,
  checkSignupRateLimit,
} from "../rate-limit.ts";

const T0 = 1_800_000_000_000;

describe("checkSignupRateLimit", () => {
  beforeEach(() => {
    _resetSignupRateLimitForTests();
    delete process.env.LANDING_PAGES_SIGNUP_RATE_MAX;
    delete process.env.LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES;
  });
  afterEach(() => {
    delete process.env.LANDING_PAGES_SIGNUP_RATE_MAX;
    delete process.env.LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES;
  });

  it("allows 5 signups then blocks the 6th within the 10-minute window", () => {
    const key = "s:1.2.3.4:gmc/jackies";
    for (let i = 0; i < 5; i++) {
      assert.equal(checkSignupRateLimit(key, T0 + i * 1000).allowed, true, `signup ${i + 1}`);
    }
    const sixth = checkSignupRateLimit(key, T0 + 6000);
    assert.equal(sixth.allowed, false);
    assert.ok(sixth.retryAfterMs > 0 && sixth.retryAfterMs <= 10 * 60_000);
  });

  it("resets after the window elapses", () => {
    const key = "s:1.2.3.4:gmc/jackies";
    for (let i = 0; i < 6; i++) checkSignupRateLimit(key, T0);
    assert.equal(checkSignupRateLimit(key, T0 + 10 * 60_000).allowed, true);
  });

  it("is tunable via env (LANDING_PAGES_SIGNUP_RATE_MAX / _WINDOW_MINUTES)", () => {
    process.env.LANDING_PAGES_SIGNUP_RATE_MAX = "2";
    process.env.LANDING_PAGES_SIGNUP_RATE_WINDOW_MINUTES = "1";
    const key = "s:1.2.3.4:gmc/jackies";
    assert.equal(checkSignupRateLimit(key, T0).allowed, true);
    assert.equal(checkSignupRateLimit(key, T0 + 1).allowed, true);
    assert.equal(checkSignupRateLimit(key, T0 + 2).allowed, false);
    assert.equal(checkSignupRateLimit(key, T0 + 60_001).allowed, true);
  });

  it("ignores garbage env values and falls back to defaults", () => {
    process.env.LANDING_PAGES_SIGNUP_RATE_MAX = "-3";
    const key = "s:1.2.3.4:gmc/jackies";
    for (let i = 0; i < 5; i++) {
      assert.equal(checkSignupRateLimit(key, T0 + i).allowed, true);
    }
    assert.equal(checkSignupRateLimit(key, T0 + 5).allowed, false);
  });

  it("buckets are per (IP, page) pair — another page or IP is unaffected", () => {
    const blocked = "s:1.2.3.4:gmc/jackies";
    for (let i = 0; i < 6; i++) checkSignupRateLimit(blocked, T0);
    assert.equal(checkSignupRateLimit(blocked, T0).allowed, false);
    assert.equal(checkSignupRateLimit("s:1.2.3.4:gmc/other-event", T0).allowed, true);
    assert.equal(checkSignupRateLimit("s:5.6.7.8:gmc/jackies", T0).allowed, true);
  });

  it("does not share state with the page-view limiter", () => {
    _resetLandingPageRateLimitForTests();
    for (let i = 0; i < 6; i++) checkSignupRateLimit("s:1.2.3.4:a/b", T0);
    // Page-view limiter still fresh for the same IP.
    assert.equal(checkLandingPageRateLimit("l:1.2.3.4", T0).allowed, true);
  });
});

describe("checkPageViewRateLimit", () => {
  beforeEach(() => {
    _resetPageViewRateLimitForTests();
    delete process.env.LANDING_PAGES_VIEW_RATE_MAX;
    delete process.env.LANDING_PAGES_VIEW_RATE_WINDOW_MINUTES;
  });
  afterEach(() => {
    delete process.env.LANDING_PAGES_VIEW_RATE_MAX;
    delete process.env.LANDING_PAGES_VIEW_RATE_WINDOW_MINUTES;
  });

  it("allows 60 views then blocks the 61st within one minute", () => {
    const key = "v:1.2.3.4:gmc/jackies";
    for (let i = 0; i < 60; i++) {
      assert.equal(checkPageViewRateLimit(key, T0 + i).allowed, true, `view ${i + 1}`);
    }
    assert.equal(checkPageViewRateLimit(key, T0 + 60).allowed, false);
  });

  it("does not share state with the signup limiter", () => {
    _resetSignupRateLimitForTests();
    for (let i = 0; i < 61; i++) checkPageViewRateLimit("v:1.2.3.4:a/b", T0);
    assert.equal(checkSignupRateLimit("s:1.2.3.4:a/b", T0).allowed, true);
  });
});

describe("buildPageViewRateLimitKey", () => {
  it("uses the first x-forwarded-for hop plus the slug pair", () => {
    assert.equal(
      buildPageViewRateLimitKey("203.0.113.7, 10.0.0.1", "gmc", "jackies"),
      "v:203.0.113.7:gmc/jackies",
    );
  });
});

describe("buildSignupRateLimitKey", () => {
  it("uses the first x-forwarded-for hop plus the slug pair", () => {
    assert.equal(
      buildSignupRateLimitKey("203.0.113.7, 10.0.0.1", "gmc", "jackies"),
      "s:203.0.113.7:gmc/jackies",
    );
  });
  it("falls back to the shared anon bucket without an IP", () => {
    assert.equal(buildSignupRateLimitKey(null, "gmc", "jackies"), "s:anon:gmc/jackies");
  });
});
