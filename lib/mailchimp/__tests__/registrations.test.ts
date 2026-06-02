/**
 * Unit tests for registrations data computation logic.
 *
 * Coverage:
 *   1. brand_campaign with growth → positive newSinceBaseline
 *   2. brand_campaign with zero growth → newSinceBaseline = 0 (CPR guard)
 *   3. brand_campaign with no Mailchimp audience (hasAudience = false)
 *   4. hasAudience=true but no snapshot rows yet
 *   5. Single snapshot row (baseline === latest → zero growth)
 *   6. Null email_subscribers → newSinceBaseline = null
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegistrationsData } from "../compute-registrations.ts";

describe("computeRegistrationsData", () => {
  it("brand_campaign with growth — returns positive newSinceBaseline", () => {
    const snapshots = [
      { email_subscribers: 1000, snapshot_at: "2026-01-01T06:00:00Z" },
      { email_subscribers: 1200, snapshot_at: "2026-01-10T06:00:00Z" },
      { email_subscribers: 2247, snapshot_at: "2026-01-20T06:00:00Z" },
    ];

    const result = computeRegistrationsData(snapshots, true);

    assert.equal(result.hasAudience, true);
    assert.equal(result.newSinceBaseline, 1247); // 2247 - 1000
    assert.equal(result.totalSubscribers, 2247);
    assert.equal(result.baselineSubscribers, 1000);
    assert.equal(result.lastSyncedAt, "2026-01-20T06:00:00Z");
  });

  it("brand_campaign with zero growth — newSinceBaseline = 0 (CPR should show —)", () => {
    const snapshots = [
      { email_subscribers: 5000, snapshot_at: "2026-01-01T06:00:00Z" },
      { email_subscribers: 5000, snapshot_at: "2026-01-05T06:00:00Z" },
    ];

    const result = computeRegistrationsData(snapshots, true);

    assert.equal(result.newSinceBaseline, 0);
    assert.equal(result.totalSubscribers, 5000);
    assert.equal(result.baselineSubscribers, 5000);
    // Callers: CPR divides by newSinceBaseline — must guard <= 0 → show "—"
    assert.ok(result.newSinceBaseline !== null && result.newSinceBaseline <= 0);
  });

  it("brand_campaign with no Mailchimp audience linked — hasAudience false, all metrics null", () => {
    const result = computeRegistrationsData([], false);

    assert.equal(result.hasAudience, false);
    assert.equal(result.newSinceBaseline, null);
    assert.equal(result.totalSubscribers, null);
    assert.equal(result.baselineSubscribers, null);
    assert.equal(result.lastSyncedAt, null);
  });

  it("audience linked but no snapshot rows yet — hasAudience=true, metrics null", () => {
    const result = computeRegistrationsData([], true);

    assert.equal(result.hasAudience, true);
    assert.equal(result.newSinceBaseline, null);
    assert.equal(result.totalSubscribers, null);
    assert.equal(result.lastSyncedAt, null);
  });

  it("single snapshot row — baseline === latest → newSinceBaseline = 0", () => {
    const snapshots = [
      { email_subscribers: 800, snapshot_at: "2026-02-01T06:00:00Z" },
    ];

    const result = computeRegistrationsData(snapshots, true);

    assert.equal(result.newSinceBaseline, 0); // 800 - 800
    assert.equal(result.totalSubscribers, 800);
    assert.equal(result.baselineSubscribers, 800);
  });

  it("null email_subscribers on latest snapshot → totalSubscribers = null, newSinceBaseline = null", () => {
    const snapshots = [
      { email_subscribers: 1000, snapshot_at: "2026-01-01T06:00:00Z" },
      { email_subscribers: null, snapshot_at: "2026-01-10T06:00:00Z" },
    ];

    const result = computeRegistrationsData(snapshots, true);

    assert.equal(result.totalSubscribers, null);
    assert.equal(result.newSinceBaseline, null);
    // lastSyncedAt still derives from the latest row's snapshot_at
    assert.equal(result.lastSyncedAt, "2026-01-10T06:00:00Z");
  });
});
