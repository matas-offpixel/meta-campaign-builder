import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_RATE_LIMIT_RETRY_MINUTES,
  estimateRetryAfterMinutes,
  parseAppUsageHeader,
} from "../app-usage.ts";

describe("parseAppUsageHeader", () => {
  it("parses a well-formed X-App-Usage header", () => {
    const snapshot = parseAppUsageHeader('{"call_count":28,"total_time":25,"total_cputime":22}');
    assert.deepEqual(snapshot, {
      callCountPercent: 28,
      totalTimePercent: 25,
      totalCpuTimePercent: 22,
      maxPercent: 28,
    });
  });

  it("takes the max across all three dimensions", () => {
    const snapshot = parseAppUsageHeader('{"call_count":10,"total_time":95,"total_cputime":40}');
    assert.equal(snapshot?.maxPercent, 95);
  });

  it("returns null for a missing header", () => {
    assert.equal(parseAppUsageHeader(null), null);
    assert.equal(parseAppUsageHeader(undefined), null);
  });

  it("returns null for malformed JSON", () => {
    assert.equal(parseAppUsageHeader("not json"), null);
  });

  it("defaults missing/non-numeric fields to 0", () => {
    const snapshot = parseAppUsageHeader('{"call_count":"oops"}');
    assert.deepEqual(snapshot, {
      callCountPercent: 0,
      totalTimePercent: 0,
      totalCpuTimePercent: 0,
      maxPercent: 0,
    });
  });
});

describe("estimateRetryAfterMinutes", () => {
  it("falls back to the generic default when no snapshot is available", () => {
    assert.equal(estimateRetryAfterMinutes(null), DEFAULT_RATE_LIMIT_RETRY_MINUTES);
  });

  it("estimates ~60 minutes when the budget is fully consumed", () => {
    assert.equal(
      estimateRetryAfterMinutes({
        callCountPercent: 100,
        totalTimePercent: 40,
        totalCpuTimePercent: 40,
        maxPercent: 100,
      }),
      60,
    );
  });

  it("scales down proportionally below 100%", () => {
    assert.equal(
      estimateRetryAfterMinutes({
        callCountPercent: 50,
        totalTimePercent: 10,
        totalCpuTimePercent: 10,
        maxPercent: 50,
      }),
      30,
    );
  });

  it("floors at 5 minutes even for a low usage snapshot", () => {
    assert.equal(
      estimateRetryAfterMinutes({
        callCountPercent: 1,
        totalTimePercent: 1,
        totalCpuTimePercent: 1,
        maxPercent: 1,
      }),
      5,
    );
  });
});
