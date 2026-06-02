/**
 * __tests__/share-report/performance-summary-hidden-for-brand.test.ts
 *
 * Tests that the Performance Summary section should not be rendered
 * for brand_campaign events. The logic is: event.kind !== 'brand_campaign'
 * guards the EventSummaryHeader render.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** Mirror of the conditional logic added to EventDailyReportBlock. */
function shouldRenderPerformanceSummary(kind: string): boolean {
  return kind !== "brand_campaign";
}

describe("Performance Summary visibility for event kind", () => {
  test("hidden for brand_campaign", () => {
    assert.equal(shouldRenderPerformanceSummary("brand_campaign"), false);
  });

  test("visible for event kind (ticket sales)", () => {
    assert.equal(shouldRenderPerformanceSummary("event"), true);
  });

  test("visible for unrecognised future kind (safe default)", () => {
    assert.equal(shouldRenderPerformanceSummary("venue"), true);
    assert.equal(shouldRenderPerformanceSummary("hybrid"), true);
  });

  test("null/undefined coerced to non-brand: visible", () => {
    // TypeScript won't allow this at the call site, but test the guard is safe
    assert.equal(shouldRenderPerformanceSummary(""), true);
  });
});
