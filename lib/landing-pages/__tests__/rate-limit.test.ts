import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  _resetLandingPageRateLimitForTests,
  buildLandingRateLimitKey,
  checkLandingPageRateLimit,
} from "../rate-limit.ts";

describe("landing page rate limit", () => {
  beforeEach(() => {
    _resetLandingPageRateLimitForTests();
  });

  it("allows 60 requests inside one window, blocks the 61st", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) {
      const d = checkLandingPageRateLimit("l:1.2.3.4", t0 + i * 10);
      assert.equal(d.allowed, true, `request ${i + 1} should be allowed`);
    }
    const blocked = checkLandingPageRateLimit("l:1.2.3.4", t0 + 1_000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterMs > 0 && blocked.retryAfterMs <= 60_000);
  });

  it("resets after the 60s window elapses", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) checkLandingPageRateLimit("l:1.2.3.4", t0);
    assert.equal(checkLandingPageRateLimit("l:1.2.3.4", t0 + 100).allowed, false);
    assert.equal(
      checkLandingPageRateLimit("l:1.2.3.4", t0 + 60_000).allowed,
      true,
    );
  });

  it("buckets are per-key — one IP exhausting its budget doesn't affect another", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) checkLandingPageRateLimit("l:1.2.3.4", t0);
    assert.equal(checkLandingPageRateLimit("l:1.2.3.4", t0 + 1).allowed, false);
    assert.equal(checkLandingPageRateLimit("l:5.6.7.8", t0 + 1).allowed, true);
  });

  it("buildLandingRateLimitKey takes the first forwarded-for hop, anon fallback", () => {
    assert.equal(
      buildLandingRateLimitKey("203.0.113.9, 10.0.0.1"),
      "l:203.0.113.9",
    );
    assert.equal(buildLandingRateLimitKey(null), "l:anon");
    assert.equal(buildLandingRateLimitKey("  "), "l:anon");
  });
});
