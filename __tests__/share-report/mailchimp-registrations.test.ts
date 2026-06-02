import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Unit tests for the Mailchimp registrations card computation logic.
 *
 * The card computes three derived values from a snapshots array:
 *   - totalRegistrations  = latest.email_subscribers
 *   - newRegistrations    = latest.email_subscribers - first.email_subscribers
 *   - costPerRegistration = totalSpendGbp / newRegistrations
 *
 * These tests exercise the pure logic directly (no React rendering) so
 * they run fast in the Node test runner without a DOM.
 */

// ─── Replicated pure logic (mirrors mailchimp-registrations-card.tsx) ────────

interface SnapshotRow {
  email_subscribers: number | null;
  snapshot_at: string;
}

interface ComputeResult {
  totalRegistrations: number | null;
  newRegistrations: number | null;
  costPerRegistration: string;
}

function computeMailchimpMetrics(
  snapshots: SnapshotRow[],
  totalSpendGbp: number | null,
): ComputeResult {
  if (snapshots.length === 0) {
    return {
      totalRegistrations: null,
      newRegistrations: null,
      costPerRegistration: "—",
    };
  }

  const latest = snapshots.at(-1)!;
  const first = snapshots[0]!;

  const totalRegistrations = latest.email_subscribers ?? null;
  const newRegistrations =
    latest.email_subscribers != null && first.email_subscribers != null
      ? latest.email_subscribers - first.email_subscribers
      : null;

  let costPerRegistration: string;
  if (
    newRegistrations != null &&
    newRegistrations > 0 &&
    totalSpendGbp != null &&
    totalSpendGbp > 0
  ) {
    costPerRegistration = new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(totalSpendGbp / newRegistrations);
  } else {
    costPerRegistration = "—";
  }

  return { totalRegistrations, newRegistrations, costPerRegistration };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("computeMailchimpMetrics", () => {
  it("returns null metrics with '—' CPR when snapshots is empty", () => {
    const result = computeMailchimpMetrics([], 500);
    assert.equal(result.totalRegistrations, null);
    assert.equal(result.newRegistrations, null);
    assert.equal(result.costPerRegistration, "—");
  });

  it("single snapshot (baseline only): total = baseline, new = 0, CPR = '—'", () => {
    const snapshots: SnapshotRow[] = [
      { email_subscribers: 2996, snapshot_at: "2026-06-02T00:00:00Z" },
    ];
    const result = computeMailchimpMetrics(snapshots, 1000);
    assert.equal(result.totalRegistrations, 2996);
    assert.equal(result.newRegistrations, 0);
    // new_registrations = 0 → CPR guard fires → "—"
    assert.equal(result.costPerRegistration, "—");
  });

  it("multi-snapshot growth: computes new registrations and CPR", () => {
    const snapshots: SnapshotRow[] = [
      { email_subscribers: 2996, snapshot_at: "2026-06-02T00:00:00Z" },
      { email_subscribers: 3100, snapshot_at: "2026-06-09T00:00:00Z" },
      { email_subscribers: 3250, snapshot_at: "2026-06-16T00:00:00Z" },
    ];
    // spend = £1,300; new = 3250 - 2996 = 254; CPR = 1300 / 254 ≈ £5.12
    const result = computeMailchimpMetrics(snapshots, 1300);
    assert.equal(result.totalRegistrations, 3250);
    assert.equal(result.newRegistrations, 254);
    // CPR = 1300 / 254 = 5.118110...
    assert.ok(
      result.costPerRegistration.startsWith("£5."),
      `Expected £5.xx, got ${result.costPerRegistration}`,
    );
  });

  it("zero-growth divide-by-zero guard: CPR = '—' when new_registrations = 0", () => {
    const snapshots: SnapshotRow[] = [
      { email_subscribers: 3000, snapshot_at: "2026-06-02T00:00:00Z" },
      { email_subscribers: 3000, snapshot_at: "2026-06-09T00:00:00Z" },
    ];
    const result = computeMailchimpMetrics(snapshots, 5000);
    assert.equal(result.newRegistrations, 0);
    assert.equal(result.costPerRegistration, "—");
  });

  it("null spend renders CPR as '—'", () => {
    const snapshots: SnapshotRow[] = [
      { email_subscribers: 2996, snapshot_at: "2026-06-02T00:00:00Z" },
      { email_subscribers: 3200, snapshot_at: "2026-06-09T00:00:00Z" },
    ];
    const result = computeMailchimpMetrics(snapshots, null);
    assert.equal(result.newRegistrations, 204);
    assert.equal(result.costPerRegistration, "—");
  });

  it("zero spend renders CPR as '—'", () => {
    const snapshots: SnapshotRow[] = [
      { email_subscribers: 2996, snapshot_at: "2026-06-02T00:00:00Z" },
      { email_subscribers: 3200, snapshot_at: "2026-06-09T00:00:00Z" },
    ];
    const result = computeMailchimpMetrics(snapshots, 0);
    assert.equal(result.costPerRegistration, "—");
  });

  it("null email_subscribers in latest snapshot: total = null, new = null, CPR = '—'", () => {
    const snapshots: SnapshotRow[] = [
      { email_subscribers: 2996, snapshot_at: "2026-06-02T00:00:00Z" },
      { email_subscribers: null, snapshot_at: "2026-06-09T00:00:00Z" },
    ];
    const result = computeMailchimpMetrics(snapshots, 500);
    assert.equal(result.totalRegistrations, null);
    assert.equal(result.newRegistrations, null);
    assert.equal(result.costPerRegistration, "—");
  });
});
