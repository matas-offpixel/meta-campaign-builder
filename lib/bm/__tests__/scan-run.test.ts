/**
 * lib/bm/__tests__/scan-run.test.ts
 *
 * The daily bm-page-scan control loop (lib/bm/scan-run.ts): the rate-limit
 * breaker, the time budget, the rotation order and the per-token read cache.
 *
 * The scan functions themselves import `server-only` and `MetaApiError`
 * (parameter properties, which strip-only mode rejects), so the loop is tested
 * with stand-in scans, and errors are plain objects shaped like MetaApiError.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createMetaCallMeter,
  noteMetaUsage,
  withMetaCallMeter,
} from "../../meta/call-meter.ts";
import { parseAppUsageHeader } from "../../meta/app-usage.ts";
import {
  BM_SCAN_TIME_BUDGET_MS,
  BM_SCAN_USAGE_STOP_PCT,
  createTokenContextCache,
  createUsageStopLatch,
  usageAtOrOver,
  isMetaRateLimitError,
  isMetaTokenExpiredError,
  orderForRotation,
  runBmScanLoop,
} from "../scan-run.ts";

function metaError(code?: number, message = "boom", subcode?: number) {
  return Object.assign(new Error(message), { name: "MetaApiError", code, subcode });
}

interface Bm {
  business_id: string;
  business_name: string | null;
  last_scanned_at: string | null;
}

function bm(id: string, last: string | null, name: string | null = id): Bm {
  return { business_id: id, business_name: name, last_scanned_at: last };
}

type Outcome = { id: string; rateLimited: boolean };

describe("isMetaRateLimitError", () => {
  it("matches the app, user, page and hourly rate-limit codes", () => {
    for (const code of [4, 17, 32, 341, 613, 80004]) {
      assert.equal(isMetaRateLimitError(metaError(code)), true, `code ${code}`);
    }
  });

  it("matches subcode 80004 and an HTTP 429 with no Meta code", () => {
    assert.equal(isMetaRateLimitError(metaError(100, "x", 80004)), true);
    assert.equal(isMetaRateLimitError(metaError(undefined, "HTTP 429")), true);
  });

  it("does not match auth, validation, transient or non-Meta errors", () => {
    assert.equal(isMetaRateLimitError(metaError(190)), false);
    assert.equal(isMetaRateLimitError(metaError(100)), false);
    assert.equal(isMetaRateLimitError(metaError(2)), false);
    assert.equal(isMetaRateLimitError(metaError(undefined, "HTTP 500")), false);
    assert.equal(isMetaRateLimitError(Object.assign(new Error("x"), { code: 4 })), false);
    assert.equal(isMetaRateLimitError(null), false);
    assert.equal(isMetaRateLimitError("(#4) Application request limit reached"), false);
  });
});

describe("isMetaTokenExpiredError", () => {
  it("matches code or subcode 190 only", () => {
    assert.equal(isMetaTokenExpiredError(metaError(190)), true);
    assert.equal(isMetaTokenExpiredError(metaError(102, "x", 190)), true);
    assert.equal(isMetaTokenExpiredError(metaError(4)), false);
  });
});

describe("orderForRotation", () => {
  it("puts never-scanned BMs first, then the oldest scan", () => {
    const ordered = orderForRotation([
      bm("a", "2026-11-17T08:01:00Z"),
      bm("b", null),
      bm("c", "2026-07-29T08:10:00Z"),
      bm("d", "2026-11-18T08:02:00Z"),
    ]);
    assert.deepEqual(
      ordered.map((b) => b.business_id),
      ["b", "c", "a", "d"],
    );
  });

  it("breaks ties on name, then business id, and does not mutate the input", () => {
    const input = [
      bm("3", "2026-11-01T00:00:00Z", "Zeta"),
      bm("2", "2026-11-01T00:00:00Z", "Alpha"),
      bm("1", "2026-11-01T00:00:00Z", "Alpha"),
    ];
    const ordered = orderForRotation(input);
    assert.deepEqual(
      ordered.map((b) => b.business_id),
      ["1", "2", "3"],
    );
    assert.deepEqual(
      input.map((b) => b.business_id),
      ["3", "2", "1"],
    );
  });

  it("picks up tomorrow where today stopped", () => {
    // 71 BMs, all last scanned before the run. Today's run gets through the
    // first 35 (they are stamped with today's time); the other 36 keep their
    // old stamps. Tomorrow those 36 come first, in the same relative order.
    const yesterday = "2026-11-17T08:00:00Z";
    const today = "2026-11-18T08:05:00Z";
    const day1 = orderForRotation(
      Array.from({ length: 71 }, (_, i) => bm(`bm${String(i).padStart(2, "0")}`, yesterday)),
    );
    const reached = new Set(day1.slice(0, 35).map((b) => b.business_id));
    const afterDay1 = day1.map((b) =>
      reached.has(b.business_id) ? { ...b, last_scanned_at: today } : b,
    );
    const day2 = orderForRotation(afterDay1);
    assert.deepEqual(
      day2.slice(0, 36).map((b) => b.business_id),
      day1.slice(35).map((b) => b.business_id),
    );
    assert.deepEqual(
      new Set(day2.slice(36).map((b) => b.business_id)),
      reached,
    );
  });

  it("treats an unparseable timestamp like never scanned", () => {
    const ordered = orderForRotation([bm("a", "2026-11-01T00:00:00Z"), bm("b", "not a date")]);
    assert.equal(ordered[0].business_id, "b");
  });
});

describe("runBmScanLoop — breaker", () => {
  it("stops at the first rate-limited BM and skips the rest without scanning them", async () => {
    const bms = ["a", "b", "c", "d", "e"].map((id) => bm(id, null));
    const calls: string[] = [];
    const res = await runBmScanLoop<Bm, Outcome>({
      bms,
      scanOne: async (b) => {
        calls.push(b.business_id);
        return { id: b.business_id, rateLimited: b.business_id === "b" };
      },
      isRateLimited: (o) => o.rateLimited,
      onThrow: (b) => ({ id: b.business_id, rateLimited: false }),
      startedAtMs: 0,
      now: () => 0,
    });
    assert.deepEqual(calls, ["a", "b"]);
    assert.deepEqual(
      res.scanned.map((s) => s.bm.business_id),
      ["a", "b"],
    );
    assert.deepEqual(
      res.skipped.map((s) => [s.bm.business_id, s.reason]),
      [
        ["c", "rate_limited"],
        ["d", "rate_limited"],
        ["e", "rate_limited"],
      ],
    );
    assert.equal(res.stoppedBy, "rate_limited");
    assert.equal(res.rateLimitedAt?.business_id, "b");
  });

  it("scans every BM when nothing is rate limited", async () => {
    const bms = ["a", "b", "c"].map((id) => bm(id, null));
    const res = await runBmScanLoop<Bm, Outcome>({
      bms,
      scanOne: async (b) => ({ id: b.business_id, rateLimited: false }),
      isRateLimited: (o) => o.rateLimited,
      onThrow: (b) => ({ id: b.business_id, rateLimited: false }),
      startedAtMs: 0,
      now: () => 0,
    });
    assert.equal(res.scanned.length, 3);
    assert.equal(res.skipped.length, 0);
    assert.equal(res.stoppedBy, null);
    assert.equal(res.rateLimitedAt, null);
  });

  it("turns a thrown scan into a result and carries on", async () => {
    const bms = ["a", "b", "c"].map((id) => bm(id, null));
    const res = await runBmScanLoop<Bm, Outcome & { threw?: boolean }>({
      bms,
      scanOne: async (b) => {
        if (b.business_id === "b") throw new Error("db down");
        return { id: b.business_id, rateLimited: false };
      },
      isRateLimited: (o) => o.rateLimited,
      onThrow: (b) => ({ id: b.business_id, rateLimited: false, threw: true }),
      startedAtMs: 0,
      now: () => 0,
    });
    assert.deepEqual(
      res.scanned.map((s) => [s.bm.business_id, Boolean(s.result.threw)]),
      [
        ["a", false],
        ["b", true],
        ["c", false],
      ],
    );
    assert.equal(res.stoppedBy, null);
  });
});

describe("runBmScanLoop — 80 % app-usage stop", () => {
  type Reading = { call_count: number; total_time: number; total_cputime: number };
  const low: Reading = { call_count: 40, total_time: 50, total_cputime: 0 };

  /**
   * Runs the loop the way lib/bm/cron-scan.ts wires it: one meter, the latch
   * as its onAppUsage watcher, and each "Graph call" a noteMetaUsage with a
   * real X-App-Usage header. `plan` gives each BM its calls' readings.
   */
  async function run(
    ids: string[],
    plan: Record<string, Array<{ reading: Reading | null; rateLimited?: boolean }>>,
  ) {
    const meter = createMetaCallMeter();
    const latch = createUsageStopLatch();
    meter.onAppUsage = latch.note;
    const calls: string[] = [];
    const res = await withMetaCallMeter(meter, () =>
      runBmScanLoop<Bm, Outcome>({
        bms: ids.map((id) => bm(id, null)),
        scanOne: async (b) => {
          let rateLimited = false;
          for (const [i, c] of (plan[b.business_id] ?? [{ reading: low }]).entries()) {
            calls.push(`${b.business_id}${i + 1}`);
            await new Promise((r) => setImmediate(r));
            noteMetaUsage({
              appUsage: parseAppUsageHeader(c.reading ? JSON.stringify(c.reading) : null),
              rateLimited: Boolean(c.rateLimited),
            });
            if (c.rateLimited) {
              rateLimited = true;
              break;
            }
          }
          return { id: b.business_id, rateLimited };
        },
        isRateLimited: (o) => o.rateLimited,
        onThrow: (b) => ({ id: b.business_id, rateLimited: false }),
        startedAtMs: 0,
        now: () => 0,
        usageStop: latch.tripped,
      }),
    );
    return { res, calls };
  }

  it("stops at 80 %, not before", () => {
    assert.equal(BM_SCAN_USAGE_STOP_PCT, 80);
    assert.equal(usageAtOrOver({ call_count: 79, total_time: 79.9, total_cputime: 79 }), false);
    assert.equal(usageAtOrOver(null), false);
  });

  for (const field of ["call_count", "total_time", "total_cputime"] as const) {
    it(`stops on ${field} at 80, finishes the BM in progress, and skips the rest as app_usage_80`, async () => {
      const at80: Reading = { ...low, [field]: 80 };
      const { res, calls } = await run(["a", "b", "c", "d"], {
        a: [{ reading: low }, { reading: low }],
        // b crosses on its 2nd call; its 3rd call still happens.
        b: [{ reading: low }, { reading: at80 }, { reading: { ...at80, call_count: Math.max(at80.call_count, 41) } }],
      });
      assert.deepEqual(calls, ["a1", "a2", "b1", "b2", "b3"]);
      assert.deepEqual(res.scanned.map((s) => s.bm.business_id), ["a", "b"]);
      assert.deepEqual(
        res.skipped.map((s) => [s.bm.business_id, s.reason]),
        [
          ["c", "app_usage_80"],
          ["d", "app_usage_80"],
        ],
      );
      assert.equal(res.stoppedBy, "app_usage_80");
      assert.deepEqual(res.usageAtStop, at80);
      assert.equal(res.rateLimitedAt, null);
    });
  }

  it("keeps the first reading at 80 even when a later call reads lower", async () => {
    const at85: Reading = { call_count: 60, total_time: 85, total_cputime: 0 };
    const { res } = await run(["a", "b"], { a: [{ reading: at85 }, { reading: low }, { reading: null }] });
    assert.equal(res.stoppedBy, "app_usage_80");
    assert.deepEqual(res.usageAtStop, at85);
    assert.deepEqual(res.skipped.map((s) => s.bm.business_id), ["b"]);
  });

  it("runs to the end when every reading stays under 80", async () => {
    const at79: Reading = { call_count: 79, total_time: 79, total_cputime: 79 };
    const { res } = await run(["a", "b", "c"], { b: [{ reading: at79 }] });
    assert.equal(res.stoppedBy, null);
    assert.equal(res.usageAtStop, null);
    assert.equal(res.scanned.length, 3);
  });

  it("a rate limit before any reading at 80 still stops as rate_limited", async () => {
    const { res } = await run(["a", "b", "c"], {
      b: [{ reading: { call_count: 69, total_time: 100, total_cputime: 0 }, rateLimited: true }],
    });
    // 100 % total_time arrived on the refused call itself: the breaker is what fired.
    assert.equal(res.stoppedBy, "rate_limited");
    assert.equal(res.rateLimitedAt?.business_id, "b");
    assert.equal(res.usageAtStop, null);
    assert.deepEqual(res.skipped.map((s) => [s.bm.business_id, s.reason]), [["c", "rate_limited"]]);

    const noHeader = await run(["a", "b", "c"], { a: [{ reading: null, rateLimited: true }] });
    assert.equal(noHeader.res.stoppedBy, "rate_limited");
    assert.deepEqual(noHeader.res.skipped.map((s) => s.bm.business_id), ["b", "c"]);
  });

  it("puts the usage-skipped BMs first in the next run", async () => {
    // Tonight's order: never-scanned x, then a..d by age.
    const tonight = orderForRotation([
      bm("a", "2026-11-23T21:16:00Z"),
      bm("b", "2026-11-23T21:17:00Z"),
      bm("c", "2026-11-24T01:16:00Z"),
      bm("d", "2026-11-24T04:16:00Z"),
      bm("x", null),
    ]);
    assert.deepEqual(tonight.map((b) => b.business_id), ["x", "a", "b", "c", "d"]);

    const { res } = await run(tonight.map((b) => b.business_id), {
      a: [{ reading: { call_count: 50, total_time: 81, total_cputime: 1 } }],
    });
    assert.deepEqual(res.scanned.map((s) => s.bm.business_id), ["x", "a"]);
    assert.deepEqual(res.skipped.map((s) => s.bm.business_id), ["b", "c", "d"]);

    // The scan stamps last_scanned_at on the BMs it scanned and leaves the skipped ones.
    const stamped = new Set(res.scanned.map((s) => s.bm.business_id));
    const after = tonight.map((b) =>
      stamped.has(b.business_id) ? { ...b, last_scanned_at: "2026-11-24T21:16:00Z" } : b,
    );
    assert.deepEqual(orderForRotation(after).map((b) => b.business_id), ["b", "c", "d", "a", "x"]);
  });
});

describe("runBmScanLoop — time budget", () => {
  it("defaults to 650 s, under the route's 800 s maxDuration", () => {
    assert.equal(BM_SCAN_TIME_BUDGET_MS, 650_000);
  });

  it("starts no BM once the budget has passed, and lets a started BM finish", async () => {
    // Each scan takes 200 s. Starts at 0, 200, 400, 600 are under 650 s;
    // the BM that would start at 800 s is skipped.
    let clock = 0;
    const bms = ["a", "b", "c", "d", "e", "f"].map((id) => bm(id, null));
    const res = await runBmScanLoop<Bm, Outcome>({
      bms,
      scanOne: async (b) => {
        clock += 200_000;
        return { id: b.business_id, rateLimited: false };
      },
      isRateLimited: (o) => o.rateLimited,
      onThrow: (b) => ({ id: b.business_id, rateLimited: false }),
      startedAtMs: 0,
      now: () => clock,
    });
    assert.deepEqual(
      res.scanned.map((s) => s.bm.business_id),
      ["a", "b", "c", "d"],
    );
    assert.deepEqual(
      res.skipped.map((s) => [s.bm.business_id, s.reason]),
      [
        ["e", "time_budget"],
        ["f", "time_budget"],
      ],
    );
    assert.equal(res.stoppedBy, "time_budget");
    assert.equal(res.rateLimitedAt, null);
  });

  it("honours a custom budget and the run's real start time", async () => {
    let clock = 1_000_000;
    const bms = ["a", "b", "c"].map((id) => bm(id, null));
    const res = await runBmScanLoop<Bm, Outcome>({
      bms,
      scanOne: async (b) => {
        clock += 10_000;
        return { id: b.business_id, rateLimited: false };
      },
      isRateLimited: (o) => o.rateLimited,
      onThrow: (b) => ({ id: b.business_id, rateLimited: false }),
      startedAtMs: 1_000_000,
      now: () => clock,
      budgetMs: 15_000,
    });
    assert.deepEqual(
      res.scanned.map((s) => s.bm.business_id),
      ["a", "b"],
    );
    assert.deepEqual(
      res.skipped.map((s) => s.bm.business_id),
      ["c"],
    );
  });

  it("a rate limit after the budget still reports the breaker, not the budget", async () => {
    let clock = 0;
    const bms = ["a", "b"].map((id) => bm(id, null));
    const res = await runBmScanLoop<Bm, Outcome>({
      bms,
      scanOne: async (b) => {
        clock += 700_000;
        return { id: b.business_id, rateLimited: true };
      },
      isRateLimited: (o) => o.rateLimited,
      onThrow: (b) => ({ id: b.business_id, rateLimited: false }),
      startedAtMs: 0,
      now: () => clock,
    });
    assert.equal(res.stoppedBy, "rate_limited");
    assert.deepEqual(
      res.skipped.map((s) => s.reason),
      ["rate_limited"],
    );
  });
});

describe("createTokenContextCache", () => {
  it("loads once per distinct token", async () => {
    const seen: string[] = [];
    const cache = createTokenContextCache(
      async (t: string) => {
        seen.push(t);
        return { pages: [t] };
      },
      () => false,
    );
    await Promise.all([cache.get("t1"), cache.get("t1"), cache.get("t2")]);
    await cache.get("t1");
    assert.deepEqual(seen, ["t1", "t2"]);
    assert.equal(cache.loads(), 2);
  });

  it("keeps a sticky failure (rate limit) so no BM asks Meta again", async () => {
    let calls = 0;
    const cache = createTokenContextCache(
      async () => {
        calls += 1;
        throw metaError(4, "(#4) Application request limit reached");
      },
      isMetaRateLimitError,
    );
    await assert.rejects(cache.get("t"));
    await assert.rejects(cache.get("t"));
    assert.equal(calls, 1);
  });

  it("forgets a non-sticky failure so the next BM tries again", async () => {
    let calls = 0;
    const cache = createTokenContextCache(
      async () => {
        calls += 1;
        if (calls === 1) throw metaError(1, "unknown error");
        return "ok";
      },
      isMetaRateLimitError,
    );
    await assert.rejects(cache.get("t"));
    // Let the rejection handler run.
    await new Promise((r) => setImmediate(r));
    assert.equal(await cache.get("t"), "ok");
    assert.equal(calls, 2);
  });
});
