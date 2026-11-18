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
  BM_SCAN_TIME_BUDGET_MS,
  createTokenContextCache,
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
