/**
 * lib/meta/__tests__/retry.test.ts
 *
 * Pure tests for the campaign-boundary single-retry helper used by
 * `fetchActiveAdsForCampaign`. The tests stand in for the
 * "first call throws code 17, second succeeds → ads come through"
 * scenario from the cascade-fix prompt:
 *
 *   - retryOnceOnTransient is the helper that wraps the per-campaign
 *     /ads fetch in production. Asserting it returns the second call's
 *     value is equivalent to asserting the campaign's ads land in the
 *     final result, because the production wrapper just forwards
 *     whatever the inner fetch returns.
 *   - isTransientRateLimit is the classifier the wrapper hands to
 *     retryOnceOnTransient. Tested directly to lock the code set
 *     (1 / 2 / 4 / 17 / 32 / 341 / 613) so a future Meta-codes change
 *     fails the test instead of silently widening (or worse, silently
 *     narrowing — losing the cascade fix).
 *
 * Run with `npm test`.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { isTransientRateLimit } from "../error-classify.ts";
import { retryOnceOnTransient } from "../retry.ts";

// ─── isTransientRateLimit ───────────────────────────────────────────────────

test("isTransientRateLimit: code 17 (user rate limit) → true", () => {
  assert.equal(isTransientRateLimit({ code: 17, message: "x" }), true);
});

test("isTransientRateLimit: code 4 (app limit) → true", () => {
  assert.equal(isTransientRateLimit({ code: 4 }), true);
});

test("isTransientRateLimit: code 1 / 2 / 32 / 341 / 613 → true", () => {
  for (const code of [1, 2, 32, 341, 613]) {
    assert.equal(
      isTransientRateLimit({ code }),
      true,
      `expected code ${code} to be transient`,
    );
  }
});

test("isTransientRateLimit: code 190 (auth expired) → false", () => {
  // Auth expiry is permanent within the request — retrying the same
  // token would just hit the same wall and waste budget.
  assert.equal(isTransientRateLimit({ code: 190 }), false);
});

test("isTransientRateLimit: code 100 (validation) → false", () => {
  assert.equal(isTransientRateLimit({ code: 100 }), false);
});

test("isTransientRateLimit: missing code → false", () => {
  assert.equal(isTransientRateLimit({ message: "boom" }), false);
});

test("isTransientRateLimit: null / undefined / string → false", () => {
  assert.equal(isTransientRateLimit(null), false);
  assert.equal(isTransientRateLimit(undefined), false);
  assert.equal(isTransientRateLimit("nope"), false);
});

// ─── retryOnceOnTransient ───────────────────────────────────────────────────

test(
  "retryOnceOnTransient: first throw transient, second succeeds → returns second value",
  async () => {
    // Mirrors the cascade-fix scenario: the per-campaign /ads call
    // throws a transient meta_code=17 (user rate limit) once because
    // a sibling campaign's chunked /insights fan-out has saturated
    // the per-account quota; 500ms later the quota window has rolled
    // over and the same call returns the campaign's ads.
    let attempts = 0;
    const ads = [{ ad_id: "1" }, { ad_id: "2" }];
    const result = await retryOnceOnTransient(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw { code: 17, message: "(#17) User request limit reached" };
        }
        return ads;
      },
      isTransientRateLimit,
      0, // no real delay in tests — no need to slow them down
    );
    assert.equal(attempts, 2);
    assert.deepEqual(result, ads);
  },
);

test(
  "retryOnceOnTransient: non-transient error → no retry, error rebubbles",
  async () => {
    let attempts = 0;
    await assert.rejects(
      retryOnceOnTransient(
        async () => {
          attempts += 1;
          throw { code: 100, message: "Invalid parameter" };
        },
        isTransientRateLimit,
        0,
      ),
      (err: unknown) => {
        // Validates we surface the same shape the inner fn threw —
        // critical for the campaign-boundary catch upstream which
        // logs the meta code in the failure summary.
        const e = err as { code?: number };
        return e.code === 100;
      },
    );
    assert.equal(attempts, 1);
  },
);

test(
  "retryOnceOnTransient: two transient throws → second throw rebubbles after retry",
  async () => {
    let attempts = 0;
    await assert.rejects(
      retryOnceOnTransient(
        async () => {
          attempts += 1;
          throw { code: 17, message: "still throttled" };
        },
        isTransientRateLimit,
        0,
      ),
      (err: unknown) => (err as { code?: number }).code === 17,
    );
    // Confirms the helper is a SINGLE retry, not a loop. Sustained
    // throttling means something bigger is wrong (token, account
    // suspension, etc.) and surfacing the failure to the campaign
    // boundary catch is correct.
    assert.equal(attempts, 2);
  },
);

test(
  "retryOnceOnTransient: success on first attempt → no retry, no onRetry call",
  async () => {
    let attempts = 0;
    let retryNotices = 0;
    const result = await retryOnceOnTransient(
      async () => {
        attempts += 1;
        return "ok";
      },
      isTransientRateLimit,
      999_999, // would be obvious if the helper slept on success
      () => {
        retryNotices += 1;
      },
    );
    assert.equal(attempts, 1);
    assert.equal(retryNotices, 0);
    assert.equal(result, "ok");
  },
);

test(
  "retryOnceOnTransient: onRetry hook fires once with the original error + delay",
  async () => {
    const seen: Array<{ code?: number; delayMs: number }> = [];
    let attempts = 0;
    await retryOnceOnTransient(
      async () => {
        attempts += 1;
        if (attempts === 1) throw { code: 613, message: "ads rate" };
        return "ok";
      },
      isTransientRateLimit,
      42,
      (err, delayMs) => {
        seen.push({ code: (err as { code?: number }).code, delayMs });
      },
    );
    assert.deepEqual(seen, [{ code: 613, delayMs: 42 }]);
  },
);
