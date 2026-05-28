/**
 * lib/insights/__tests__/lpv-priority-chain.test.ts
 *
 * Pinned behaviour for the shared LPV resolver. Extracted from
 * `lib/reporting/active-creatives-fetch.ts` (the original home of the
 * priority chain at line 296-300) for PR-A of issue #467 so the rollup
 * writer (`lib/insights/meta.ts`) and the lifetime-cache writer
 * (`lib/insights/event-code-lifetime-two-pass.ts`) can reuse the same
 * resolver without re-implementing it.
 *
 * Why these tests matter:
 *   The orphan active-creatives rollup was the LPV source of record
 *   pre-PR-A. PR-A re-aliased `ORPHAN_LPV_PRIORITY` to the shared
 *   `LPV_ACTION_PRIORITY` so the per-creative panel keeps the same
 *   numbers as the new rollup-column LPV. If either constant drifts,
 *   one surface starts overcounting (when omni AND raw both fire) or
 *   undercounting (when omni is the only emitted variant).
 *
 * Run via `node --experimental-strip-types --test
 * lib/insights/__tests__/lpv-priority-chain.test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LPV_ACTION_PRIORITY,
  resolveLpvFromActions,
} from "../lpv-priority-chain.ts";

describe("LPV_ACTION_PRIORITY", () => {
  it("preserves the omni > pixel > raw order", () => {
    assert.deepEqual(
      [...LPV_ACTION_PRIORITY],
      [
        "omni_landing_page_view",
        "offsite_conversion.fb_pixel_landing_page_view",
        "landing_page_view",
      ],
      "order is the single source of truth for every LPV resolver call site",
    );
  });
});

describe("resolveLpvFromActions", () => {
  it("returns 0 for undefined / null / empty actions", () => {
    assert.equal(resolveLpvFromActions(undefined), 0);
    assert.equal(resolveLpvFromActions(null), 0);
    assert.equal(resolveLpvFromActions([]), 0);
  });

  it("picks omni_landing_page_view when present (highest priority)", () => {
    // Realistic Edinburgh-style payload (Meta MCP verification
    // 2026-05-21 → 2026-05-27): omni_landing_page_view = landing_page_view
    // for web-only sales campaigns. The resolver MUST pick exactly one
    // — picking both would double-count.
    const value = resolveLpvFromActions([
      { action_type: "page_engagement", value: "38159" },
      { action_type: "landing_page_view", value: "4375" },
      { action_type: "omni_landing_page_view", value: "4375" },
      { action_type: "video_view", value: "32462" },
    ]);
    assert.equal(value, 4375);
  });

  it("falls back to pixel landing_page_view when omni is absent", () => {
    // Older pixel-only events where omni isn't emitted.
    const value = resolveLpvFromActions([
      {
        action_type: "offsite_conversion.fb_pixel_landing_page_view",
        value: "120",
      },
      { action_type: "landing_page_view", value: "115" },
    ]);
    assert.equal(value, 120);
  });

  it("falls back to raw landing_page_view when omni + pixel both absent", () => {
    const value = resolveLpvFromActions([
      { action_type: "landing_page_view", value: "42" },
    ]);
    assert.equal(value, 42);
  });

  it("returns 0 when no priority match exists", () => {
    const value = resolveLpvFromActions([
      { action_type: "purchase", value: "5" },
      { action_type: "page_engagement", value: "300" },
    ]);
    assert.equal(value, 0);
  });

  it("handles numeric values without string conversion", () => {
    // `value` can be number when callers fan in pre-parsed payloads.
    const value = resolveLpvFromActions([
      { action_type: "omni_landing_page_view", value: 17 },
    ]);
    assert.equal(value, 17);
  });

  it("treats non-finite parsed values as 0 rather than NaN", () => {
    const value = resolveLpvFromActions([
      { action_type: "omni_landing_page_view", value: "not-a-number" },
    ]);
    assert.equal(value, 0);
  });

  it("never sums across the priority chain (regression guard)", () => {
    // Critical pre-PR-A bug surface: a naive sum across the chain
    // would return 8750 here (= 4375 × 2) because Meta emits omni AND
    // raw for the same underlying LPV. The contract is "pick the
    // first non-missing match" — same value, not double.
    const value = resolveLpvFromActions([
      { action_type: "omni_landing_page_view", value: "4375" },
      { action_type: "landing_page_view", value: "4375" },
      {
        action_type: "offsite_conversion.fb_pixel_landing_page_view",
        value: "4375",
      },
    ]);
    assert.equal(value, 4375);
  });
});
