/**
 * lib/meta/__tests__/call-meter.test.ts
 *
 * The per-run Graph call meter behind bm-page-scan's `meta_calls`,
 * `app_usage_last` and `app_usage_at_limit`. client.ts itself can't load
 * under strip-only mode (MetaApiError's parameter properties), so its hooks
 * are checked by a source guard at the end.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  countMetaCall,
  createMetaCallMeter,
  currentMetaCallMeter,
  noteMetaUsage,
  toAppUsageReading,
  withMetaCallMeter,
} from "../call-meter.ts";
import { parseAppUsageHeader } from "../app-usage.ts";

/** What client.ts does for one HTTP attempt. */
function attempt(header: string | null, rateLimited = false) {
  countMetaCall();
  noteMetaUsage({ appUsage: parseAppUsageHeader(header), rateLimited });
}

describe("meta call meter", () => {
  it("counts every attempt inside the meter, retries included", async () => {
    const meter = createMetaCallMeter();
    await withMetaCallMeter(meter, async () => {
      attempt('{"call_count":10,"total_time":5,"total_cputime":4}');
      await Promise.all([
        (async () => attempt(null))(),
        (async () => {
          await new Promise((r) => setTimeout(r, 1));
          // A rate-limited attempt and its one retry: two calls.
          attempt('{"call_count":100,"total_time":40,"total_cputime":30}', true);
          attempt('{"call_count":100,"total_time":41,"total_cputime":30}', true);
        })(),
      ]);
      // A network failure is still an attempt.
      countMetaCall();
    });
    assert.equal(meter.calls, 5);
    assert.equal(meter.rateLimitedResponses, 2);
  });

  it("counts nothing outside a meter, and never throws there", () => {
    assert.equal(currentMetaCallMeter(), undefined);
    assert.doesNotThrow(() => attempt('{"call_count":1}'));
  });

  it("keeps two concurrent runs apart", async () => {
    const a = createMetaCallMeter();
    const b = createMetaCallMeter();
    await Promise.all([
      withMetaCallMeter(a, async () => {
        for (let i = 0; i < 3; i += 1) {
          attempt(null);
          await new Promise((r) => setTimeout(r, 1));
        }
      }),
      withMetaCallMeter(b, async () => {
        attempt(null);
        await new Promise((r) => setTimeout(r, 2));
        attempt(null);
      }),
    ]);
    assert.equal(a.calls, 3);
    assert.equal(b.calls, 2);
  });

  it("keeps the last header seen; a response without one doesn't wipe it", async () => {
    const meter = createMetaCallMeter();
    await withMetaCallMeter(meter, async () => {
      attempt('{"call_count":55,"total_time":20,"total_cputime":12}');
      attempt(null);
      attempt("not json");
      attempt("null");
    });
    assert.deepEqual(meter.lastAppUsage, { call_count: 55, total_time: 20, total_cputime: 12 });
    assert.equal(meter.lastRateLimitedAppUsage, null);
  });

  it("keeps the header from the rate-limited response, null when it had none", async () => {
    const meter = createMetaCallMeter();
    await withMetaCallMeter(meter, async () => {
      attempt('{"call_count":98,"total_time":60,"total_cputime":40}');
      attempt('{"call_count":100,"total_time":61,"total_cputime":41}', true);
    });
    assert.deepEqual(meter.lastRateLimitedAppUsage, { call_count: 100, total_time: 61, total_cputime: 41 });

    const bare = createMetaCallMeter();
    await withMetaCallMeter(bare, async () => {
      attempt('{"call_count":98,"total_time":60,"total_cputime":40}');
      attempt(null, true);
    });
    assert.equal(bare.lastRateLimitedAppUsage, null);
    assert.deepEqual(bare.lastAppUsage, { call_count: 98, total_time: 60, total_cputime: 40 });
  });

  it("writes Meta's field names", () => {
    assert.deepEqual(
      toAppUsageReading(parseAppUsageHeader('{"call_count":"7","total_time":3,"total_cputime":2}')),
      { call_count: 7, total_time: 3, total_cputime: 2 },
    );
    assert.equal(toAppUsageReading(null), null);
  });
});

describe("meta call meter — onAppUsage watcher (bm-page-scan 80 % stop)", () => {
  it("hands the watcher every reading, in order, and skips responses with no header", async () => {
    const meter = createMetaCallMeter();
    const seen: number[] = [];
    meter.onAppUsage = (r) => seen.push(r.total_time);
    await withMetaCallMeter(meter, async () => {
      attempt('{"call_count":10,"total_time":20,"total_cputime":0}');
      attempt(null);
      attempt('{"call_count":30,"total_time":85,"total_cputime":0}', true);
    });
    assert.deepEqual(seen, [20, 85]);
    assert.equal(meter.calls, 3);
  });

  it("a watcher that throws never breaks the Graph call", async () => {
    const meter = createMetaCallMeter();
    meter.onAppUsage = () => {
      throw new Error("watcher bug");
    };
    await withMetaCallMeter(meter, async () => {
      attempt('{"call_count":1,"total_time":2,"total_cputime":3}');
    });
    assert.deepEqual(meter.lastAppUsage, { call_count: 1, total_time: 2, total_cputime: 3 });
  });
});

describe("client.ts reports every Graph attempt to the meter", () => {
  const src = readFileSync(new URL("../client.ts", import.meta.url), "utf8");

  it("counts the GET retry loop's attempts right after fetch, network failures included", () => {
    const body = src.slice(src.indexOf("async function executeGetWithRetry"), src.indexOf("function parseMetaError"));
    const fetchAt = body.indexOf("await fetch(");
    const countAt = body.indexOf("countMetaCall();");
    assert.ok(fetchAt > 0 && countAt > fetchAt, "countMetaCall follows the fetch");
    assert.ok(countAt < body.indexOf("if (!response)"), "and comes before the network-error branch");
    assert.equal(body.split("noteMetaUsage(").length - 1, 2, "usage on success and on error");
  });

  it("counts graphPostWithToken too", () => {
    const body = src.slice(src.indexOf("export async function graphPostWithToken"));
    const end = body.indexOf("\nexport ", 10);
    const fn = body.slice(0, end);
    assert.equal(fn.split("countMetaCall();").length - 1, 2, "on a network failure and on a response");
    assert.ok(fn.includes("noteMetaUsage("));
  });
});
