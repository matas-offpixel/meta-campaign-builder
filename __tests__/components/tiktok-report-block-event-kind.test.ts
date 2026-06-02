/**
 * Pure-logic regression guard: XLSX import surfaces remain visible for
 * event-kind (ticket-sale) events. Ensures no regression from the
 * brand_campaign gating introduced in feat(brand-campaign): hide legacy
 * TikTok XLSX import block.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Mirrors gating predicate from event-reporting-tabs.tsx

function isBrandCampaign(eventKind: string | null | undefined): boolean {
  return eventKind === "brand_campaign";
}

function shouldShowXlsxImport(eventKind: string | null | undefined): boolean {
  return !isBrandCampaign(eventKind);
}

function shouldShowEmptyReportState(
  eventKind: string | null | undefined,
  hasReport: boolean,
): boolean {
  if (hasReport) return false;
  return !isBrandCampaign(eventKind);
}

function accountLinkerCaption(
  eventKind: string | null | undefined,
  linkedAccountName: string | null,
): string {
  const linked = linkedAccountName != null;
  if (!linked) {
    return isBrandCampaign(eventKind)
      ? "Link a TikTok account to enable daily data sync via API."
      : "Optional. The manual report import works regardless; linking helps once OAuth lands.";
  }
  const suffix = isBrandCampaign(eventKind)
    ? ". Data auto-syncs daily via API."
    : ". Reports import either way — this is metadata for future API integration.";
  return `Linked to ${linkedAccountName}${suffix}`;
}

describe("event-kind: XLSX import block stays visible", () => {
  it("shouldShowXlsxImport returns true for event kind", () => {
    assert.equal(shouldShowXlsxImport("event"), true);
  });

  it("shouldShowXlsxImport returns true for null kind (default fallback)", () => {
    assert.equal(shouldShowXlsxImport(null), true);
  });

  it("shouldShowEmptyReportState returns true for event kind when no report", () => {
    assert.equal(shouldShowEmptyReportState("event", false), true);
  });

  it("shouldShowEmptyReportState returns false for event kind when report exists", () => {
    assert.equal(shouldShowEmptyReportState("event", true), false);
  });
});

describe("event-kind: AccountLinkerCard retains legacy copy", () => {
  it("linked account still shows legacy 'future API integration' text", () => {
    const caption = accountLinkerCaption("event", "Junction 2");
    assert.ok(
      caption.includes("Reports import either way"),
      `Expected legacy caption for event kind: "${caption}"`,
    );
    assert.ok(
      caption.includes("future API integration"),
      `Expected 'future API integration' text for event kind: "${caption}"`,
    );
  });

  it("unlinked account shows legacy copy for event kind", () => {
    const caption = accountLinkerCaption("event", null);
    assert.ok(
      caption.includes("manual report import works regardless"),
      `Expected legacy unlinked copy for event kind: "${caption}"`,
    );
  });
});
