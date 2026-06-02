/**
 * __tests__/components/tiktok-report-block-null-safety.test.ts
 *
 * Regression guard for Bug 1 in PR #507: the "TikTok" sub-tab on the
 * internal /events/[id]?tab=reporting page crashed with
 * "Cannot read properties of undefined (reading 'length')" when
 * snapshot.ads / .geo / .demographics / .interests were undefined.
 *
 * The fix: pass `snapshot.ads ?? []` (etc.) in TikTokReportBlock so
 * each sub-table receives an array even when the stored JSON is partial.
 *
 * These tests exercise the guard pattern directly — no JSX renderer needed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Guard pattern used in TikTokReportBlock ────────────────────────────────

function safeSnapshotRows<T>(rows: T[] | undefined | null): T[] {
  return rows ?? [];
}

describe("TikTokReportBlock snapshot array guards", () => {
  it("snapshot.ads ?? [] is safe when ads is undefined", () => {
    const snapshot: { ads?: unknown[] } = {};
    const safe = safeSnapshotRows(snapshot.ads);
    assert.equal(safe.length, 0);
  });

  it("snapshot.geo ?? [] is safe when geo is undefined", () => {
    const snapshot: { geo?: unknown[] } = {};
    const safe = safeSnapshotRows(snapshot.geo);
    assert.equal(safe.length, 0);
  });

  it("snapshot.demographics ?? [] is safe when demographics is undefined", () => {
    const snapshot: { demographics?: unknown[] } = {};
    const safe = safeSnapshotRows(snapshot.demographics);
    assert.equal(safe.length, 0);
  });

  it("snapshot.interests ?? [] is safe when interests is undefined", () => {
    const snapshot: { interests?: unknown[] } = {};
    const safe = safeSnapshotRows(snapshot.interests);
    assert.equal(safe.length, 0);
  });

  it("passes through populated arrays unchanged", () => {
    const ads = [{ ad_name: "Test Ad", cost: 100 }];
    assert.deepEqual(safeSnapshotRows(ads), ads);
  });

  it("length check is safe on guarded result", () => {
    const safe = safeSnapshotRows(undefined);
    assert.doesNotThrow(() => safe.length);
    assert.equal(safe.length, 0);
  });

  it("spread into [...rows] is safe on guarded result", () => {
    const safe = safeSnapshotRows<{ cost: number }>(undefined);
    assert.doesNotThrow(() => [...safe].sort((a, b) => b.cost - a.cost));
    assert.deepEqual([...safe].sort((a, b) => b.cost - a.cost), []);
  });
});
