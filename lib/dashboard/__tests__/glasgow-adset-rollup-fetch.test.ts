/**
 * Tests for lib/dashboard/glasgow-adset-rollup-fetch.ts
 *
 * Run: node --experimental-strip-types --test lib/dashboard/__tests__/glasgow-adset-rollup-fetch.test.ts
 *
 * The module's pure logic + `*WithFetcher` seams take no `@/` imports, so this
 * test runs under the alias-less node runner without resolving the app graph.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyGlasgowAdSetVenue,
  aggregateGlasgowAdSetRowsByDay,
  aggregateGlasgowAdSetRowsToTotals,
  fetchGlasgowAdSetSplitsWithFetcher,
  fetchGlasgowAdSetLifetimeSplitsWithFetcher,
  isGlasgowSplitEventCode,
  type GlasgowAdSetInsightsRow,
  type GlasgowGraphFetcher,
} from "../glasgow-adset-rollup-fetch.ts";

// The 9 production ad sets (2026-06-08 baseline). O2 names use an EN-DASH
// before "O2 academy"; SWG3 names use a hyphen before "SWG3".
const O2_NAMES = [
  "BOFU - Glasgow 40km - 18-50 – O2 academy – Copy",
  "MOFU - Glasgow 40km - 18-50 – O2 academy",
  "TOFU - Glasgow 40km - 18-50 – O2 academy",
  "Lookalikes - Glasgow 40km - 18-50 – O2 academy",
  "Advantage + - Glasgow 40km - 18-50 – O2 academy",
];
const SWG3_NAMES = [
  "Football Prospecting - Glasgow 40km - 18-50 - SWG3",
  "Lookalikes - Glasgow 40km - 18-50 - SWG3",
  "4thefans Fans - Glasgow 40km - 18-50 - SWG3",
  "Advantage + - Glasgow 40km - 18-50 - SWG3",
];

function row(
  name: string,
  day: string,
  spend: number,
  extra: Partial<GlasgowAdSetInsightsRow> = {},
): GlasgowAdSetInsightsRow {
  return {
    adset_id: name,
    adset_name: name,
    spend: String(spend),
    date_start: day,
    ...extra,
  };
}

describe("classifyGlasgowAdSetVenue", () => {
  it("routes all 5 O2-academy ad sets to WC26-GLASGOW-O2 (en-dash + hyphen, any case)", () => {
    for (const n of O2_NAMES) {
      assert.equal(classifyGlasgowAdSetVenue(n), "WC26-GLASGOW-O2", n);
    }
    // hyphen + lowercase variants also match
    assert.equal(
      classifyGlasgowAdSetVenue("tofu - glasgow - o2 academy"),
      "WC26-GLASGOW-O2",
    );
  });

  it("routes all 4 SWG3 ad sets to WC26-GLASGOW-SWG3", () => {
    for (const n of SWG3_NAMES) {
      assert.equal(classifyGlasgowAdSetVenue(n), "WC26-GLASGOW-SWG3", n);
    }
  });

  it("throws on an ad set matching neither suffix (fail loud)", () => {
    assert.throws(
      () => classifyGlasgowAdSetVenue("Retargeting - Glasgow 40km - 18-50"),
      /matches neither/,
    );
  });

  it("throws on an ambiguous name matching both suffixes", () => {
    assert.throws(
      () => classifyGlasgowAdSetVenue("Combo - O2 academy and - SWG3"),
      /BOTH/,
    );
  });
});

describe("aggregateGlasgowAdSetRowsByDay", () => {
  it("splits 9 ad sets into O2 (5) and SWG3 (4) groups, summing per venue per day", () => {
    const rows: GlasgowAdSetInsightsRow[] = [
      ...O2_NAMES.map((n) => row(n, "2026-06-01", 100)),
      ...SWG3_NAMES.map((n) => row(n, "2026-06-01", 50)),
    ];
    const splits = aggregateGlasgowAdSetRowsByDay(rows);
    const o2 = splits.find((s) => s.eventCode === "WC26-GLASGOW-O2")!;
    const swg3 = splits.find((s) => s.eventCode === "WC26-GLASGOW-SWG3")!;
    assert.equal(o2.days.length, 1);
    assert.equal(swg3.days.length, 1);
    // 5 O2 ad sets × £100, 4 SWG3 ad sets × £50.
    assert.equal(o2.days[0]!.spend, 500);
    assert.equal(swg3.days[0]!.spend, 200);
  });

  it("aggregates per-day per-venue across multiple days", () => {
    const rows: GlasgowAdSetInsightsRow[] = [
      row(O2_NAMES[0]!, "2026-06-01", 10),
      row(O2_NAMES[1]!, "2026-06-01", 20),
      row(O2_NAMES[0]!, "2026-06-02", 30),
      row(SWG3_NAMES[0]!, "2026-06-01", 5),
      row(SWG3_NAMES[0]!, "2026-06-02", 7),
    ];
    const splits = aggregateGlasgowAdSetRowsByDay(rows);
    const o2 = splits.find((s) => s.eventCode === "WC26-GLASGOW-O2")!;
    const swg3 = splits.find((s) => s.eventCode === "WC26-GLASGOW-SWG3")!;
    assert.deepEqual(
      o2.days.map((d) => [d.day, d.spend]),
      [
        ["2026-06-01", 30],
        ["2026-06-02", 30],
      ],
    );
    assert.deepEqual(
      swg3.days.map((d) => [d.day, d.spend]),
      [
        ["2026-06-01", 5],
        ["2026-06-02", 7],
      ],
    );
  });

  it("aggregates engagement (clicks, reach, LPV, regs) per venue per day", () => {
    const rows: GlasgowAdSetInsightsRow[] = [
      row(O2_NAMES[0]!, "2026-06-01", 10, {
        clicks: "40",
        reach: "1000",
        impressions: "2000",
        actions: [
          { action_type: "landing_page_view", value: "12" },
          { action_type: "complete_registration", value: "3" },
          { action_type: "post_engagement", value: "80" },
        ],
      }),
      row(O2_NAMES[1]!, "2026-06-01", 5, {
        clicks: "10",
        reach: "500",
        impressions: "800",
        actions: [{ action_type: "landing_page_view", value: "4" }],
      }),
    ];
    const o2 = aggregateGlasgowAdSetRowsByDay(rows).find(
      (s) => s.eventCode === "WC26-GLASGOW-O2",
    )!;
    const d = o2.days[0]!;
    assert.equal(d.linkClicks, 50);
    assert.equal(d.reach, 1500);
    assert.equal(d.impressions, 2800);
    assert.equal(d.landingPageViews, 16);
    assert.equal(d.metaRegs, 3);
    assert.equal(d.engagements, 80);
    assert.equal(d.presaleSpend, 0); // TRAFFIC campaign → all regular
  });

  it("throws if a per-day row is missing date_start", () => {
    assert.throws(
      () => aggregateGlasgowAdSetRowsByDay([{ adset_name: O2_NAMES[0]!, spend: "1" }]),
      /missing date_start/,
    );
  });

  it("throws on an unknown ad-set name in the batch", () => {
    assert.throws(
      () =>
        aggregateGlasgowAdSetRowsByDay([
          row("Weird new ad set with no venue tag", "2026-06-01", 99),
        ]),
      /matches neither/,
    );
  });
});

describe("aggregateGlasgowAdSetRowsToTotals (lifetime)", () => {
  it("sums all rows per venue with no day breakdown", () => {
    const rows: GlasgowAdSetInsightsRow[] = [
      { adset_name: O2_NAMES[0]!, spend: "100", reach: "10" },
      { adset_name: O2_NAMES[1]!, spend: "50", reach: "20" },
      { adset_name: SWG3_NAMES[0]!, spend: "30", reach: "5" },
    ];
    const splits = aggregateGlasgowAdSetRowsToTotals(rows);
    const o2 = splits.find((s) => s.eventCode === "WC26-GLASGOW-O2")!;
    const swg3 = splits.find((s) => s.eventCode === "WC26-GLASGOW-SWG3")!;
    assert.equal(o2.totals.spend, 150);
    assert.equal(o2.totals.reach, 30);
    assert.equal(swg3.totals.spend, 30);
    assert.equal(swg3.totals.reach, 5);
  });
});

describe("fetchGlasgowAdSetSplitsWithFetcher", () => {
  it("requests level=adset + time_increment=1 and aggregates the response", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetcher: GlasgowGraphFetcher = async (path, params) => {
      seen.push(params);
      assert.match(path, /6925933901665\/insights$/);
      return {
        data: [
          row(O2_NAMES[0]!, "2026-06-01", 10),
          row(SWG3_NAMES[0]!, "2026-06-01", 4),
        ],
      } as never;
    };
    const splits = await fetchGlasgowAdSetSplitsWithFetcher(
      { token: "t", adAccountId: "123", since: "2026-06-01", until: "2026-06-01" },
      fetcher,
    );
    assert.equal(seen[0]!.level, "adset");
    assert.equal(seen[0]!.time_increment, "1");
    assert.equal(seen[0]!.time_range, JSON.stringify({ since: "2026-06-01", until: "2026-06-01" }));
    assert.equal(
      splits.find((s) => s.eventCode === "WC26-GLASGOW-O2")!.days[0]!.spend,
      10,
    );
    assert.equal(
      splits.find((s) => s.eventCode === "WC26-GLASGOW-SWG3")!.days[0]!.spend,
      4,
    );
  });

  it("propagates a Meta API error (fail loud, no campaign-level fallback)", async () => {
    const fetcher: GlasgowGraphFetcher = async () => {
      throw new Error("Meta 400: rate limited");
    };
    await assert.rejects(
      fetchGlasgowAdSetSplitsWithFetcher(
        { token: "t", adAccountId: "123", since: "2026-06-01", until: "2026-06-02" },
        fetcher,
      ),
      /rate limited/,
    );
  });

  it("paginates via cursors.after", async () => {
    let call = 0;
    const fetcher: GlasgowGraphFetcher = async () => {
      call += 1;
      if (call === 1) {
        return {
          data: [row(O2_NAMES[0]!, "2026-06-01", 10)],
          paging: { next: "x", cursors: { after: "CUR2" } },
        } as never;
      }
      return { data: [row(O2_NAMES[0]!, "2026-06-01", 5)] } as never;
    };
    const splits = await fetchGlasgowAdSetSplitsWithFetcher(
      { token: "t", adAccountId: "act_123", since: "2026-06-01", until: "2026-06-01" },
      fetcher,
    );
    assert.equal(call, 2);
    assert.equal(
      splits.find((s) => s.eventCode === "WC26-GLASGOW-O2")!.days[0]!.spend,
      15,
    );
  });
});

describe("fetchGlasgowAdSetLifetimeSplitsWithFetcher", () => {
  it("requests date_preset=maximum (no time_increment) and totals per venue", async () => {
    const seen: Array<Record<string, string>> = [];
    const fetcher: GlasgowGraphFetcher = async (_path, params) => {
      seen.push(params);
      return {
        data: [
          { adset_name: O2_NAMES[0]!, spend: "100", reach: "10" },
          { adset_name: SWG3_NAMES[0]!, spend: "30", reach: "5" },
        ],
      } as never;
    };
    const splits = await fetchGlasgowAdSetLifetimeSplitsWithFetcher(
      { token: "t", adAccountId: "123" },
      fetcher,
    );
    assert.equal(seen[0]!.date_preset, "maximum");
    assert.equal(seen[0]!.time_increment, undefined);
    assert.equal(
      splits.find((s) => s.eventCode === "WC26-GLASGOW-O2")!.totals.spend,
      100,
    );
  });
});

describe("isGlasgowSplitEventCode", () => {
  it("matches only the two Glasgow venue codes", () => {
    assert.equal(isGlasgowSplitEventCode("WC26-GLASGOW-O2"), true);
    assert.equal(isGlasgowSplitEventCode("WC26-GLASGOW-SWG3"), true);
    assert.equal(isGlasgowSplitEventCode("WC26-GLASGOW"), false);
    assert.equal(isGlasgowSplitEventCode("WC26-MANCHESTER"), false);
    assert.equal(isGlasgowSplitEventCode(null), false);
    assert.equal(isGlasgowSplitEventCode(undefined), false);
  });
});
