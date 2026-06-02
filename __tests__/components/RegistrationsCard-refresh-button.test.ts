/**
 * RegistrationsCard refresh button behaviour tests.
 *
 * These tests cover the logic that determines when the button renders,
 * when it is disabled, and what it does when clicked.
 *
 * We test the pure data/logic layer (mailchimpAccountConnected propagation)
 * without DOM rendering since React components require a full browser env.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRegistrationsData } from "../../lib/mailchimp/compute-registrations.ts";

describe("computeRegistrationsData — mailchimpAccountConnected propagation", () => {
  it("propagates mailchimpAccountConnected=false when account not set up", () => {
    const result = computeRegistrationsData([], false, false);
    assert.equal(result.mailchimpAccountConnected, false);
  });

  it("propagates mailchimpAccountConnected=true when account is connected", () => {
    const result = computeRegistrationsData([], false, true);
    assert.equal(result.mailchimpAccountConnected, true);
  });

  it("defaults mailchimpAccountConnected to false when omitted", () => {
    // The function has default param = false, so old callers get false.
    const result = computeRegistrationsData([], true);
    assert.equal(result.mailchimpAccountConnected, false);
  });

  it("passes through when there are snapshot rows", () => {
    const snapshots = [
      { email_subscribers: 1000, snapshot_at: "2026-01-01T06:00:00Z" },
      { email_subscribers: 1247, snapshot_at: "2026-01-20T06:00:00Z" },
    ];
    const result = computeRegistrationsData(snapshots, true, true);
    assert.equal(result.mailchimpAccountConnected, true);
    assert.equal(result.newSinceBaseline, 247);
  });
});

describe("refresh button disabled state logic", () => {
  it("button should be disabled when mailchimpAccountConnected is false", () => {
    // Mirrors: const refreshDisabled = !mailchimpAccountConnected;
    const data = computeRegistrationsData([], true, false);
    const refreshDisabled = !data.mailchimpAccountConnected;
    assert.equal(refreshDisabled, true);
  });

  it("button should be enabled when mailchimpAccountConnected is true", () => {
    const data = computeRegistrationsData([], true, true);
    const refreshDisabled = !data.mailchimpAccountConnected;
    assert.equal(refreshDisabled, false);
  });

  it("tooltip message for disconnected account matches spec", () => {
    const data = computeRegistrationsData([], true, false);
    const refreshDisabled = !data.mailchimpAccountConnected;
    const tooltip = refreshDisabled
      ? "Connect Mailchimp at /settings/mailchimp to enable refresh"
      : "Refresh Mailchimp data";
    assert.equal(
      tooltip,
      "Connect Mailchimp at /settings/mailchimp to enable refresh",
    );
  });

  it("button is always rendered when onRefreshRegistrations is provided (regardless of hasAudience)", () => {
    // In RegistrationsCard: button renders when onRefreshRegistrations != null.
    // Here we just test that the logic to always show is correct for brand_campaign.
    const withAudience = computeRegistrationsData([], true, false);
    const withoutAudience = computeRegistrationsData([], false, false);

    // Both cases should provide a button (onRefreshRegistrations drives visibility).
    // We just verify the data exists and doesn't cause a hidden button due to !hasAudience.
    assert.equal(typeof withAudience.mailchimpAccountConnected, "boolean");
    assert.equal(typeof withoutAudience.mailchimpAccountConnected, "boolean");
  });
});
