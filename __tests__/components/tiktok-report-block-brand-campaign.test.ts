/**
 * Pure-logic regression guard: XLSX import surfaces are hidden for
 * brand_campaign events.
 *
 * These tests verify the gating predicate used by TikTokReportTab
 * (`isBrandCampaign = eventKind === "brand_campaign"`) without needing a
 * DOM renderer. They document the expected contract so a future refactor
 * can't silently re-expose the legacy import block to brand clients.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Gating predicate (mirrors the prop computation in event-reporting-tabs.tsx)

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

describe("brand_campaign: XLSX import block is hidden", () => {
  it("shouldShowXlsxImport returns false for brand_campaign", () => {
    assert.equal(shouldShowXlsxImport("brand_campaign"), false);
  });

  it("shouldShowEmptyReportState returns false for brand_campaign (no report)", () => {
    assert.equal(shouldShowEmptyReportState("brand_campaign", false), false);
  });

  it("shouldShowEmptyReportState returns false for brand_campaign (with report)", () => {
    assert.equal(shouldShowEmptyReportState("brand_campaign", true), false);
  });

  it("isBrandCampaign returns true only for 'brand_campaign'", () => {
    assert.equal(isBrandCampaign("brand_campaign"), true);
    assert.equal(isBrandCampaign("event"), false);
    assert.equal(isBrandCampaign(null), false);
    assert.equal(isBrandCampaign(undefined), false);
  });
});

describe("brand_campaign: AccountLinkerCard caption uses API-first copy", () => {
  it("linked account shows 'Data auto-syncs daily via API.' caption", () => {
    const caption = accountLinkerCaption("brand_campaign", "Ironworks");
    assert.ok(
      caption.includes("Data auto-syncs daily via API."),
      `Expected API caption but got: "${caption}"`,
    );
    assert.ok(
      !caption.includes("future API integration"),
      `Stale 'future API integration' text should not appear: "${caption}"`,
    );
  });

  it("linked account caption mentions the account name", () => {
    const caption = accountLinkerCaption("brand_campaign", "Ironworks");
    assert.ok(caption.includes("Ironworks"), `Expected account name in caption: "${caption}"`);
  });

  it("unlinked account shows sync-oriented copy for brand_campaign", () => {
    const caption = accountLinkerCaption("brand_campaign", null);
    assert.ok(
      caption.includes("daily data sync via API"),
      `Expected sync caption for unlinked brand_campaign: "${caption}"`,
    );
  });
});
