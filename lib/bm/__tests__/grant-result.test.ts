import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeGrantResult, isFullGrantSuccess, type GrantResult } from "../types.ts";

function baseResult(overrides: Partial<GrantResult> = {}): GrantResult {
  return {
    businessId: "biz_1",
    attempted: 0,
    granted: 0,
    failed: 0,
    batches: 0,
    failures: [],
    ...overrides,
  };
}

describe("isFullGrantSuccess", () => {
  it("is true when every attempted grant succeeded", () => {
    assert.ok(isFullGrantSuccess(baseResult({ attempted: 5, granted: 5, failed: 0 })));
  });

  it("is false when the token expired", () => {
    assert.equal(
      isFullGrantSuccess(baseResult({ attempted: 5, granted: 0, failed: 0, tokenExpired: true })),
      false,
    );
  });

  it("is false when any grant failed", () => {
    assert.equal(
      isFullGrantSuccess(baseResult({ attempted: 5, granted: 4, failed: 1 })),
      false,
    );
  });

  it("is false when the run was halted by a Meta rate limit, even with zero ordinary failures", () => {
    assert.equal(
      isFullGrantSuccess(
        baseResult({ attempted: 8, granted: 8, failed: 0, rateLimited: true, retryAfterMinutes: 45 }),
      ),
      false,
    );
  });
});

describe("describeGrantResult", () => {
  it("reports the rate-limit halt message with granted/total + retry estimate", () => {
    const msg = describeGrantResult(
      baseResult({
        attempted: 9,
        granted: 8,
        failed: 0,
        totalTargeted: 1060,
        rateLimited: true,
        retryAfterMinutes: 42,
      }),
    );
    assert.equal(msg, "Granted 8 of 1060 — Meta rate limit hit, retry in ~42 minutes.");
  });

  it("falls back to attempted as the denominator when totalTargeted is missing", () => {
    const msg = describeGrantResult(
      baseResult({ attempted: 9, granted: 8, rateLimited: true, retryAfterMinutes: 20 }),
    );
    assert.equal(msg, "Granted 8 of 9 — Meta rate limit hit, retry in ~20 minutes.");
  });

  it("defaults the retry estimate to 45 minutes when omitted", () => {
    const msg = describeGrantResult(baseResult({ attempted: 1, rateLimited: true }));
    assert.match(msg, /retry in ~45 minutes/);
  });

  it("token-expired takes precedence over rate-limited", () => {
    const msg = describeGrantResult(
      baseResult({ attempted: 1, tokenExpired: true, rateLimited: true }),
    );
    assert.equal(msg, "Facebook token expired — reconnect required.");
  });

  it("still reports plain success when nothing is rate-limited", () => {
    const msg = describeGrantResult(baseResult({ attempted: 3, granted: 3, failed: 0 }));
    assert.equal(msg, "Granted access on 3/3 page(s).");
  });
});
