import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { classifyGoogleAdsRetry } from "../retry.ts";

describe("Google Ads retry classifier", () => {
  it("uses the full transient budget for server/unavailable errors", () => {
    assert.deepEqual(
      classifyGoogleAdsRetry({
        error: { status: "UNAVAILABLE", message: "try later" },
        attempt: 0,
      }),
      { kind: "transient", retry: true, delayMs: 500 },
    );
    assert.equal(
      classifyGoogleAdsRetry({
        error: { response: { status: 503, data: { error: { message: "down" } } } },
        attempt: 3,
      }).retry,
      true,
    );
  });

  it("retries RESOURCE_EXHAUSTED once with a 10s delay", () => {
    assert.deepEqual(
      classifyGoogleAdsRetry({
        error: { status: "RESOURCE_EXHAUSTED", message: "quota" },
        attempt: 0,
      }),
      { kind: "rate_limit", retry: true, delayMs: 10_000 },
    );
    assert.deepEqual(
      classifyGoogleAdsRetry({
        error: { code: 8, message: "quota" },
        attempt: 1,
      }),
      { kind: "rate_limit", retry: false, delayMs: 10_000 },
    );
  });

  it("does not retry auth failures", () => {
    assert.deepEqual(
      classifyGoogleAdsRetry({
        error: { status: "UNAUTHENTICATED", message: "expired" },
        attempt: 0,
      }),
      { kind: "auth", retry: false, delayMs: 0 },
    );
    assert.equal(
      classifyGoogleAdsRetry({
        error: { response: { status: 403 } },
        attempt: 0,
      }).retry,
      false,
    );
  });
});
