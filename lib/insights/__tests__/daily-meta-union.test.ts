import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchEventDailyMetaMetricsUnion, mergeDailyRows } from "../daily-meta-union.ts";
import type { DailyMetaUnionArgs } from "../daily-meta-union.ts";
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

/**
 * Defaults for the two reads that are not about spend. A test that cares
 * passes its own. `fetchCampaignName` defaults to failing so a test that
 * reaches it unintentionally says so instead of quietly retaining.
 */
function union(
  args: Omit<DailyMetaUnionArgs, "fetchCodedCampaigns" | "fetchCampaignName"> &
    Partial<Pick<DailyMetaUnionArgs, "fetchCodedCampaigns" | "fetchCampaignName">>,
) {
  return fetchEventDailyMetaMetricsUnion({
    fetchCodedCampaigns: async () => ({ ok: true, campaigns: [] }),
    fetchCampaignName: async () => ({ ok: false, error: { message: "no name read stubbed" } }),
    ...args,
  });
}

const SHEFFIELD = "act_1073273492854557";
const NX = "act_606252931141334";

describe("fetchEventDailyMetaMetricsUnion", () => {
  it("finds a campaign the stored hint never knew about (Folamour's on-sale)", async () => {
    const res = await union({
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
    const res = await union({
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
    const res = await union({
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
    const res = await union({
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

  // ── No insights row is not a disclaim (14 Oct 2026) ──────────────────
  //
  // The rollup deleted six campaign ids across three Electric Brixton
  // shows because they had no insights row inside the 60-day window:
  // MF's lead gen (£596.96, last spend 5 Aug), lead gen - older (£370.30,
  // 5 Aug) and Newcastle - Purchase (£0.50, 5 Aug); IPC's SIGNUP v3
  // (£0.33, 7 Aug) and v4 (£16.01, 10 Aug); and Rudimental's On Sale,
  // which never spent at all. All six still carried their own [CODE].

  it("keeps a coded campaign paused for longer than the window", async () => {
    const res = await union({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      storedCampaignIds: ["leadgen-1"],
      // Last spend 5 Aug: outside a window opening 16 Aug, so insights
      // answers with nothing at all, for the account and for the id.
      fetchDaily: async () => ok([], [], []),
      fetchCampaignName: async () => ({
        ok: true,
        name: "261016 Modern Funktion | [NX26-MF] Modern Funktion - Newcastle - lead gen",
      }),
    });
    assert.deepEqual(res.campaignIds, ["leadgen-1"], "silence is not a disclaim");
    const d = res.decisions.find((x) => x.campaignId === "leadgen-1");
    assert.equal(d?.reason, "retained_no_delivery");
    assert.equal(d?.claim, "coded", "the name still carries this event's code");
  });

  it("keeps a coded campaign that never spent", async () => {
    const res = await union({
      eventCode: "NX26-RUDIMENTAL",
      adAccountIds: [NX],
      storedCampaignIds: ["onsale-paused"],
      fetchDaily: async () => ok([], [], []),
      fetchCampaignName: async () => ({
        ok: true,
        name: "261212 Rudimental | [NX26-RUDIMENTAL] RUDIMENTAL - On Sale",
      }),
    });
    assert.deepEqual(res.campaignIds, ["onsale-paused"]);
    assert.equal(
      res.decisions.find((x) => x.campaignId === "onsale-paused")?.reason,
      "retained_no_delivery",
    );
  });

  it("keeps an uncoded stored campaign with no delivery", async () => {
    // The hint's one irreplaceable job: name discovery can never find
    // this campaign again, so dropping it loses its spend for good.
    const res = await union({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      storedCampaignIds: ["uncoded-1"],
      fetchDaily: async () => ok([], [], []),
      fetchCampaignName: async () => ({ ok: true, name: "Modern Funktion retargeting" }),
    });
    assert.deepEqual(res.campaignIds, ["uncoded-1"]);
    const d = res.decisions.find((x) => x.campaignId === "uncoded-1");
    assert.equal(d?.reason, "retained_no_delivery");
    assert.equal(d?.claim, "uncoded_retained");
  });

  it("still releases a campaign renamed into another event, with no delivery", async () => {
    // The one positive answer that removes an id. Nine campaigns were
    // hand-renamed on 13 Oct; a paused one must still leave.
    const res = await union({
      eventCode: "NX25-DJ EZ",
      adAccountIds: [NX],
      storedCampaignIds: ["renamed-1"],
      fetchDaily: async () => ok([], [], []),
      fetchCampaignName: async () => ({ ok: true, name: "[NX26-DJEZ] DJ EZ - On Sale" }),
    });
    assert.deepEqual(res.campaignIds, [], "the other event owns it now");
    const d = res.decisions.find((x) => x.campaignId === "renamed-1");
    assert.equal(d?.reason, "moved");
    assert.equal(d?.movedTo, "NX26-DJEZ");
  });

  it("keeps the id when the name read itself fails", async () => {
    const res = await union({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      storedCampaignIds: ["unknown-1"],
      fetchDaily: async () => ok([], [], []),
      fetchCampaignName: async () => ({ ok: false, error: { message: "(#17) rate limit" } }),
    });
    assert.deepEqual(res.campaignIds, ["unknown-1"], "a failed read is not evidence");
    const d = res.decisions.find((x) => x.campaignId === "unknown-1");
    assert.equal(d?.reason, "retained_read_failed");
    assert.match(d?.readError ?? "", /rate limit/);
  });

  it("rediscovers a campaign the window lost, without the stored hint", async () => {
    // How the six come back: the campaigns edge answers on existence, so
    // a campaign already deleted from the hint rejoins its event.
    const res = await union({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      storedCampaignIds: [],
      fetchDaily: async () => ok([], [], []),
      fetchCodedCampaigns: async () => ({
        ok: true,
        campaigns: [{ id: "leadgen-1", name: "[NX26-MF] Modern Funktion - lead gen" }],
      }),
    });
    assert.deepEqual(res.campaignIds, ["leadgen-1"]);
    const d = res.decisions.find((x) => x.campaignId === "leadgen-1");
    assert.equal(d?.reason, "coded_no_delivery");
    assert.equal(d?.added, true);
  });

  it("never shrinks the list when the campaigns edge fails", async () => {
    const res = await union({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      storedCampaignIds: ["leadgen-1"],
      fetchDaily: async () => ok([], [], []),
      fetchCodedCampaigns: async () => ({ ok: false, error: { message: "(#17) rate limit" } }),
      fetchCampaignName: async () => ({ ok: true, name: "[NX26-MF] lead gen" }),
    });
    assert.equal(res.accountErrors.length, 1, "the caller must see the gap and skip the write");
    assert.deepEqual(res.campaignIds, ["leadgen-1"]);
  });

  it("gives every stored id a decision line, every run", async () => {
    const res = await union({
      eventCode: "NX26-MF",
      adAccountIds: [NX],
      storedCampaignIds: ["a", "b", "c"],
      fetchDaily: async ({ knownCampaignIds }) =>
        knownCampaignIds?.[0] === "a"
          ? ok([row("2026-10-01", 12)], ["a"], ["[NX26-MF] live"])
          : ok([], [], []),
      fetchCampaignName: async ({ campaignId }) =>
        campaignId === "b"
          ? { ok: true, name: "[NX26-MF] paused" }
          : { ok: false, error: { message: "gone" } },
    });
    assert.deepEqual(
      res.decisions.map((d) => [d.campaignId, d.reason]).sort(),
      [["a", "coded"], ["b", "retained_no_delivery"], ["c", "retained_read_failed"]],
      "no stored id may leave or stay without a line saying why",
    );
  });

  it("keeps going when one account errors, and says which", async () => {
    const res = await union({
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
