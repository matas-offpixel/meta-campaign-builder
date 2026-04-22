/**
 * lib/insights/meta.test.ts
 *
 * Pure-helper tests for the day-chunked fallback that fires when
 * Meta returns "Please reduce the amount of data you're asking
 * for". No network, no Supabase, no Meta — just `isReduceDataError`
 * and `resolvePresetToDays` over hand-rolled fixtures so the math
 * is easy to eyeball when the test fails.
 *
 * Run with:
 *   node --test lib/insights/meta.test.ts
 *
 * The repo runs node:test directly against .ts files (see
 * lib/reporting/active-creatives-group.test.ts for the same
 * pattern). The MODULE_TYPELESS_PACKAGE_JSON warning at the top of
 * the run is expected and harmless.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

// Import from the pure helper modules — `lib/meta/client.ts` uses
// TS parameter properties (rejected by Node's strip-only mode) and
// `lib/insights/meta.ts` imports `server-only` (no node_modules
// entry → throws at import time outside Next). The pure modules
// are re-exported by both, so production callers see no diff.
import { isReduceDataError } from "../meta/error-classify.ts";
import { resolvePresetToDays } from "./date-chunks.ts";

// ─── isReduceDataError ──────────────────────────────────────────────────────

test(
  "isReduceDataError: code=1 + canonical message → true",
  () => {
    const err = {
      code: 1,
      message:
        "Please reduce the amount of data you're asking for, then retry your request",
    };
    assert.equal(isReduceDataError(err), true);
  },
);

test("isReduceDataError: code=2 + canonical message → true", () => {
  const err = {
    code: 2,
    message: "Please reduce the amount of data you're asking for",
  };
  assert.equal(isReduceDataError(err), true);
});

test(
  "isReduceDataError: plain Error wrapping the message → true via stringify fallback",
  () => {
    const err = new Error(
      "Network error calling Meta API: Please reduce the amount of data you're asking for",
    );
    assert.equal(isReduceDataError(err), true);
  },
);

test("isReduceDataError: rate-limit / unrelated error → false", () => {
  const err = { code: 17, message: "User request limit reached" };
  assert.equal(isReduceDataError(err), false);
});

test("isReduceDataError: userMsg carrying the phrase → true", () => {
  const err = {
    code: 1,
    message: "API limit reached",
    userMsg: "Please reduce the amount of data you're asking for",
  };
  assert.equal(isReduceDataError(err), true);
});

test(
  "isReduceDataError: rawErrorData payload carrying the phrase → true",
  () => {
    const err = {
      code: 100,
      message: "Generic error",
      rawErrorData: {
        error: {
          message: "Please reduce the amount of data you're asking for",
        },
      },
    };
    assert.equal(isReduceDataError(err), true);
  },
);

test("isReduceDataError: null / undefined → false", () => {
  assert.equal(isReduceDataError(null), false);
  assert.equal(isReduceDataError(undefined), false);
});

// ─── resolvePresetToDays ────────────────────────────────────────────────────

/** Fixed "today" in UTC so the day-list assertions stay deterministic. */
const TODAY = new Date(Date.UTC(2026, 3, 22)); // 2026-04-22

test(
  "resolvePresetToDays(last_7d): 7 inclusive days ending today",
  () => {
    const days = resolvePresetToDays("last_7d", undefined, TODAY);
    assert.deepEqual(days, [
      "2026-04-16",
      "2026-04-17",
      "2026-04-18",
      "2026-04-19",
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
  },
);

test("resolvePresetToDays(last_3d): 3 inclusive days ending today", () => {
  const days = resolvePresetToDays("last_3d", undefined, TODAY);
  assert.deepEqual(days, ["2026-04-20", "2026-04-21", "2026-04-22"]);
});

test("resolvePresetToDays(today): single-day list", () => {
  const days = resolvePresetToDays("today", undefined, TODAY);
  assert.deepEqual(days, ["2026-04-22"]);
});

test(
  "resolvePresetToDays(yesterday): single-day list one before today",
  () => {
    const days = resolvePresetToDays("yesterday", undefined, TODAY);
    assert.deepEqual(days, ["2026-04-21"]);
  },
);

test(
  "resolvePresetToDays(custom): inclusive enumeration of since→until",
  () => {
    const days = resolvePresetToDays(
      "custom",
      { since: "2026-04-19", until: "2026-04-22" },
      TODAY,
    );
    assert.deepEqual(days, [
      "2026-04-19",
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
    ]);
  },
);

test(
  "resolvePresetToDays(maximum): null — caller short-circuits to non-chunked path",
  () => {
    const days = resolvePresetToDays("maximum", undefined, TODAY);
    assert.equal(days, null);
  },
);

test(
  "resolvePresetToDays(this_month): start-of-month → today inclusive",
  () => {
    const days = resolvePresetToDays("this_month", undefined, TODAY);
    // April 2026 → 1st through 22nd inclusive = 22 days.
    assert.equal(days?.length, 22);
    assert.equal(days?.[0], "2026-04-01");
    assert.equal(days?.[days.length - 1], "2026-04-22");
  },
);

test(
  "resolvePresetToDays(last_30d) crossing a month boundary preserves the right number of days",
  () => {
    const days = resolvePresetToDays("last_30d", undefined, TODAY);
    assert.equal(days?.length, 30);
    assert.equal(days?.[0], "2026-03-24");
    assert.equal(days?.[29], "2026-04-22");
  },
);
