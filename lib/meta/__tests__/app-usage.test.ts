import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_RATE_LIMIT_RETRY_MINUTES,
  appUsageBadgePercent,
  estimateRetryAfterMinutes,
  maxAppUsagePercent,
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

  it("takes the max across all three dimensions — never sums them", () => {
    const snapshot = parseAppUsageHeader('{"call_count":10,"total_time":95,"total_cputime":40}');
    assert.equal(snapshot?.maxPercent, 95);
    assert.notEqual(snapshot?.maxPercent, 10 + 95 + 40);
  });

  it("regression: 100+100+72 must badge as 100%, not 272%", () => {
    const snapshot = parseAppUsageHeader('{"call_count":100,"total_time":100,"total_cputime":72}');
    assert.ok(snapshot);
    assert.equal(maxAppUsagePercent(100, 100, 72), 100);
    assert.equal(appUsageBadgePercent(snapshot), 100);
    assert.equal(snapshot.maxPercent, 100);
    assert.notEqual(snapshot.maxPercent, 272);
  });

  it("coerces numeric strings from Meta", () => {
    const snapshot = parseAppUsageHeader(
      '{"call_count":"100","total_time":"72","total_cputime":"45"}',
    );
    assert.deepEqual(snapshot, {
      callCountPercent: 100,
      totalTimePercent: 72,
      totalCpuTimePercent: 45,
      maxPercent: 100,
    });
  });

  it("clamps each field to 0–100", () => {
    const snapshot = parseAppUsageHeader('{"call_count":150,"total_time":-5,"total_cputime":50}');
    assert.deepEqual(snapshot, {
      callCountPercent: 100,
      totalTimePercent: 0,
      totalCpuTimePercent: 50,
      maxPercent: 100,
    });
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

  it("uses MAX of components even when maxPercent field was wrong", () => {
    // Defensive: retry estimate must not trust a summed maxPercent (272).
    assert.equal(
      estimateRetryAfterMinutes({
        callCountPercent: 100,
        totalTimePercent: 100,
        totalCpuTimePercent: 72,
        maxPercent: 272,
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
