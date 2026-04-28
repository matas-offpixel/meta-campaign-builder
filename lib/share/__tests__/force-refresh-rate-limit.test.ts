import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildRateLimitKey,
  checkForceRefreshRateLimit,
  _resetForceRefreshRateLimitForTests,
} from "../force-refresh-rate-limit.ts";

describe("checkForceRefreshRateLimit", () => {
  beforeEach(() => {
    _resetForceRefreshRateLimitForTests();
  });

  it("allows the first call for a key", () => {
    const decision = checkForceRefreshRateLimit("tok:ip1", 1_000);
    assert.equal(decision.allowed, true);
    assert.equal(decision.retryAfterMs, 0);
  });

  it("blocks a second call inside the 60s window", () => {
    checkForceRefreshRateLimit("tok:ip1", 1_000);
    const second = checkForceRefreshRateLimit("tok:ip1", 30_000);
    assert.equal(second.allowed, false);
    assert.equal(second.retryAfterMs, 60_000 - 29_000);
  });

  it("allows a second call once the window has elapsed", () => {
    checkForceRefreshRateLimit("tok:ip1", 1_000);
    const later = checkForceRefreshRateLimit("tok:ip1", 61_001);
    assert.equal(later.allowed, true);
  });

  it("scopes keys so different IPs don't share a budget", () => {
    const a = checkForceRefreshRateLimit("tok:ip1", 1_000);
    const b = checkForceRefreshRateLimit("tok:ip2", 1_000);
    assert.equal(a.allowed, true);
    assert.equal(b.allowed, true);
  });
});

describe("buildRateLimitKey", () => {
  it("uses the first IP from x-forwarded-for", () => {
    assert.equal(
      buildRateLimitKey("abc123", "1.2.3.4, 10.0.0.1"),
      "abc123:1.2.3.4",
    );
  });

  it("falls back to 'anon' when no IP is present", () => {
    assert.equal(buildRateLimitKey("abc123", null), "abc123:anon");
    assert.equal(buildRateLimitKey("abc123", ""), "abc123:anon");
  });

  it("trims whitespace from the first IP", () => {
    assert.equal(
      buildRateLimitKey("abc123", "  5.6.7.8 , 9.9.9.9"),
      "abc123:5.6.7.8",
    );
  });
});
