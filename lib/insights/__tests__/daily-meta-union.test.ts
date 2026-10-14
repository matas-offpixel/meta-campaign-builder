import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchEventDailyMetaMetricsUnion, mergeDailyRows } from "../daily-meta-union.ts";
import type { DailyMetaMetricsResult, DailyMetaMetricsRow } from "../types.ts";

function row(day: string, spend: number): DailyMetaMetricsRow {
  return {
    day, spend, presaleSpend: 0, linkClicks: 0, landingPageViews: 0, metaRegs: 0,
    metaPurchases: 0, metaLeads: 0, impressions: 0, reach: 0, videoPlays3s: 0,
    videoPlays15s: 0, videoPlaysP100: 0, engagements: 0,
  };
}
const ok = (days: DailyMetaMetricsRow[], ids: string[], names: string[]): DailyMetaMetricsResult =>
  ({ ok: true, days, campaignIds: ids, campaignNames: names });

const SHEFFIELD = "act_1073273492854557";
const NX = "act_606252931141334";

describe("fetchEventDailyMetaMetricsUnion", () => {
  it("finds a campaign the stored hint never knew about (Folamour's on-sale)", async () => {
    const res = await fetchEventDailyMetaMetricsUnion({
      eventCode: "NX26-FOLAMOUR",
      adAccountIds: [NX],
      storedCampaignIds: ["signup-1"],
      fetchDaily: async ({ knownCampaignIds }) =>
        knownCampaignIds
          ? ok([row("2026-09-01", 100)], ["signup-1"], ["[NX26-FOLAMOUR] Signup"])
          : ok(
              [row("2026-09-01", 100), row("2026-09-20", 688.21)],
              ["signup-1", "onsale-1"],
              ["[NX26-FOLAMOUR] Signup", "261023 Folamour | [NX26-FOLAMOUR] On sale"],
            ),
    });
    assert.deepEqual(res.campaignIds.sort(), ["onsale-1", "signup-1"]);
    const added = res.decisions.find((d) => d.campaignId === "onsale-1");
    assert.equal(added?.reason, "coded");
    assert.equal(added?.added, true, "the on-sale campaign is new to the stored list");
    assert.equal(res.days.reduce((t, d) => t + d.spend, 0), 788.21);
  });

  it("sums one event across two ad accounts (Fever's split)", async () => {
    const res = await fetchEventDailyMetaMetricsUnion({
      eventCode: "ES26-FEVER105",
      adAccountIds: [SHEFFIELD, NX],
      storedCampaignIds: [],
      fetchDaily: async ({ adAccountId }) =>
        adAccountId === SHEFFIELD
          ? ok([row("2026-10-03", 1346.86)], ["s1"], ["[ES26-FEVER105] Signup"])
          : ok([row("2026-10-02", 94.07)], ["n1"], ["[ES26-FEVER105] Signup"]),
    });
    // Float sum: 1346.86 + 94.07 is 1440.9299999999998. Spend is parsed as
    // a float everywhere upstream, so assert to the penny, not to the bit.
    const total = res.days.reduce((t, d) => t + d.spend, 0);
    assert.ok(Math.abs(total - 1440.93) < 0.005, `got ${total}`);
    assert.deepEqual(res.campaignIds.sort(), ["n1", "s1"]);
  });

  it("releases a stored campaign renamed into another event, and drops its spend", async () => {
    const res = await fetchEventDailyMetaMetricsUnion({
      eventCode: "NX25-DJ EZ",
      adAccountIds: [NX],
      storedCampaignIds: ["moved-1"],
      fetchDaily: async ({ knownCampaignIds }) =>
        knownCampaignIds
          ? ok([row("2026-08-01", 331.53)], ["moved-1"], ["261002 DJ EZ | [NX26-DJEZ] Traffic"])
          : ok([], [], []),
    });
    assert.deepEqual(res.campaignIds, []);
    assert.equal(res.days.length, 0, "moved spend must not stay on the old event");
    const d = res.decisions[0];
    assert.equal(d?.reason, "moved");
    assert.equal(d?.movedTo, "NX26-DJEZ");
  });

  it("retains an uncoded stored campaign rather than dropping real spend", async () => {
    const res = await fetchEventDailyMetaMetricsUnion({
      eventCode: "NX26-SCHAK",
      adAccountIds: [NX],
      storedCampaignIds: ["uncoded-1"],
      fetchDaily: async ({ knownCampaignIds }) =>
        knownCampaignIds
          ? ok([row("2026-09-01", 999.94)], ["uncoded-1"], ["Schak - Nanna Makina"])
          : ok([], [], []),
    });
    assert.deepEqual(res.campaignIds, ["uncoded-1"]);
    assert.equal(res.decisions[0]?.reason, "uncoded_retained");
  });

  it("keeps going when one account errors, and says which", async () => {
    const res = await fetchEventDailyMetaMetricsUnion({
      eventCode: "NX26-MF",
      adAccountIds: [NX, SHEFFIELD],
      storedCampaignIds: [],
      fetchDaily: async ({ adAccountId }) =>
        adAccountId === NX
          ? ok([row("2026-08-01", 50)], ["a"], ["[NX26-MF] Traffic"])
          : { ok: false, error: { reason: "meta_api_error", message: "rate limited" } },
    });
    assert.equal(res.days.reduce((t, d) => t + d.spend, 0), 50);
    assert.deepEqual(res.accountErrors, [{ adAccountId: SHEFFIELD, message: "rate limited" }]);
  });

  it("merges same-day rows from different accounts into one row", () => {
    const merged = mergeDailyRows([row("2026-10-02", 10), row("2026-10-02", 5), row("2026-10-03", 1)]);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.spend, 15);
  });
});

describe("fetchEventTodayMetaSnapshotUnion", () => {
  it("sums today across accounts instead of reading only the event's own", async () => {
    const { fetchEventTodayMetaSnapshotUnion } = await import("../daily-meta-union.ts");
    const res = await fetchEventTodayMetaSnapshotUnion({
      eventCode: "ES26-FEVER105",
      adAccountIds: [SHEFFIELD, NX],
      claimedCampaignIds: ["s1", "n1"],
      fetchToday: async ({ adAccountId }) =>
        adAccountId === SHEFFIELD
          ? ok([row("2026-10-14", 40)], ["s1"], ["a"])
          : ok([row("2026-10-14", 12)], ["n1"], ["b"]),
    });
    assert.equal(res.day?.spend, 52);
    assert.equal(res.accountsWithRow, 2);
  });

  it("returns no day rather than a zero when every account fails", async () => {
    const { fetchEventTodayMetaSnapshotUnion } = await import("../daily-meta-union.ts");
    const res = await fetchEventTodayMetaSnapshotUnion({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      claimedCampaignIds: [],
      fetchToday: async () =>
        ({ ok: false, error: { reason: "meta_api_error", message: "429" } }),
    });
    assert.equal(res.day, null);
    assert.equal(res.accountErrors.length, 1);
    assert.equal(res.accountsWithRow, 0);
  });

  it("distinguishes 'no rows yet' from 'read failed'", async () => {
    const { fetchEventTodayMetaSnapshotUnion } = await import("../daily-meta-union.ts");
    const res = await fetchEventTodayMetaSnapshotUnion({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      claimedCampaignIds: [],
      fetchToday: async () => ok([], [], []),
    });
    assert.equal(res.day, null);
    assert.equal(res.accountErrors.length, 0, "an empty read is not an error");
  });
});
