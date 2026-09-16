/**
 * Campaign-grain daily insights store (Armed floor 4 / PR A).
 *
 * Run: node --test lib/insights/__tests__/campaign-daily.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CAMPAIGN_DAILY_WINDOW_DAYS,
  campaignDailyWindow,
  formatCampaignDailyDryRunRow,
  mergeCampaignDailyRows,
  resolveDailyPrimaryResult,
  rowsFromGraphRows,
  runCampaignDailyInsightsSync,
  type ArmedDailyCampaign,
  type CampaignDailyGraphRow,
  type CampaignDailyInsightRow,
} from "../campaign-daily.ts";
import { fetchCampaignDailyInsights } from "../campaign-daily-fetch.ts";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const MIGRATION = readFileSync(
  "supabase/migrations/178_campaign_daily_insights.sql",
  "utf8",
);
const LIVE_METRIC = readFileSync("lib/optimisation/live-metric.ts", "utf8");
const CRON = readFileSync("app/api/cron/rollup-sync-events/route.ts", "utf8");
const UPSERT = readFileSync("lib/db/campaign-daily-insights.ts", "utf8");

function campaign(
  overrides: Partial<ArmedDailyCampaign> = {},
): ArmedDailyCampaign {
  return {
    draftId: "draft-1",
    userId: "user-1",
    campaignId: "1200001",
    adAccountId: "act_99",
    objective: "registration",
    ...overrides,
  };
}

function dayRow(
  date: string,
  overrides: Partial<CampaignDailyGraphRow> = {},
): CampaignDailyGraphRow {
  return {
    campaign_id: "1200001",
    date_start: date,
    spend: "10.00",
    impressions: "1000",
    reach: "800",
    clicks: "40",
    inline_link_clicks: "30",
    actions: [
      {
        action_type: "complete_registration",
        value: "5",
      },
    ],
    ...overrides,
  };
}

function fourteenDays(): CampaignDailyGraphRow[] {
  const { since } = campaignDailyWindow(NOW);
  const start = new Date(`${since}T00:00:00.000Z`);
  return Array.from({ length: CAMPAIGN_DAILY_WINDOW_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return dayRow(`${y}-${m}-${day}`, { spend: String(10 + i) });
  });
}

function memoryStore() {
  const map = new Map<string, CampaignDailyInsightRow>();
  return {
    upsert(rows: CampaignDailyInsightRow[]) {
      for (const row of rows) {
        map.set(`${row.meta_campaign_id}|${row.date}`, { ...row });
      }
      return map.size;
    },
    insert(rows: CampaignDailyInsightRow[]) {
      for (const row of rows) {
        const key = `${row.meta_campaign_id}|${row.date}`;
        if (map.has(key)) {
          throw new Error(`duplicate (${row.meta_campaign_id}, ${row.date})`);
        }
        map.set(key, { ...row });
      }
      return map.size;
    },
    size() {
      return map.size;
    },
    get(campaignId: string, date: string) {
      return map.get(`${campaignId}|${date}`);
    },
  };
}

describe("campaign_daily_insights migration", () => {
  it("is unique on (meta_campaign_id, date) and defaults channel to meta", () => {
    assert.match(MIGRATION, /create table if not exists campaign_daily_insights/);
    assert.match(MIGRATION, /unique \(meta_campaign_id, date\)/);
    assert.match(MIGRATION, /channel\s+text not null default 'meta'/);
    assert.match(MIGRATION, /Do not apply in this run/);
    assert.match(UPSERT, /onConflict:\s*"meta_campaign_id,date"/);
  });

  it("the unique key rejects a duplicate insert of the same (campaign, date)", () => {
    const store = memoryStore();
    const row = rowsFromGraphRows([dayRow("2026-09-16")], {
      campaignId: "1200001",
      adAccountId: "act_99",
      draftId: "draft-1",
      objective: "registration",
      fetchedAt: NOW.toISOString(),
    })[0]!;
    store.insert([row]);
    assert.throws(
      () => store.insert([row]),
      /duplicate \(1200001, 2026-09-16\)/,
    );
    assert.equal(store.size(), 1);
  });
});

describe("window and mapping", () => {
  it("covers 14 inclusive UTC days ending today", () => {
    const window = campaignDailyWindow(NOW);
    assert.equal(window.until, "2026-09-16");
    assert.equal(window.since, "2026-09-03");
  });

  it("resolves the primary result, not a summed action bag", () => {
    assert.deepEqual(
      resolveDailyPrimaryResult("registration", [
        { action_type: "complete_registration", value: "4" },
        { action_type: "purchase", value: "9" },
      ]),
      { count: 4, actionType: "complete_registration" },
    );
    assert.equal(resolveDailyPrimaryResult("awareness", [
      { action_type: "complete_registration", value: "4" },
    ]), null);
  });
});

describe("writer", () => {
  it("a campaign with 14 days of insights writes 14 rows and a re-run writes 14, not 28", async () => {
    const store = memoryStore();
    const days = fourteenDays();
    assert.equal(days.length, 14);

    const first = await runCampaignDailyInsightsSync({
      now: NOW,
      dryRun: false,
      loadCampaigns: async () => [campaign()],
      resolveToken: async () => "token",
      fetchInsights: async () => days,
      upsert: async (rows) => store.upsert(rows),
    });
    assert.equal(first.written, 14);
    assert.equal(store.size(), 14);

    const revised = days.map((row, i) =>
      i === days.length - 1 ? { ...row, spend: "99.00" } : row,
    );
    const second = await runCampaignDailyInsightsSync({
      now: NOW,
      dryRun: false,
      loadCampaigns: async () => [campaign()],
      resolveToken: async () => "token",
      fetchInsights: async () => revised,
      upsert: async (rows) => store.upsert(rows),
    });
    assert.equal(second.written, 14);
    assert.equal(store.size(), 14);
    assert.equal(store.get("1200001", "2026-09-16")?.spend, 99);
  });

  it("a day Meta reports nothing writes no row, so the series is a gap not a zero", async () => {
    const store = memoryStore();
    const days = fourteenDays().filter((row) => row.date_start !== "2026-09-10");
    assert.equal(days.length, 13);

    await runCampaignDailyInsightsSync({
      now: NOW,
      dryRun: false,
      loadCampaigns: async () => [campaign()],
      resolveToken: async () => "token",
      fetchInsights: async () => days,
      upsert: async (rows) => store.upsert(rows),
    });
    assert.equal(store.size(), 13);
    assert.equal(store.get("1200001", "2026-09-10"), undefined);
    assert.ok(store.get("1200001", "2026-09-09"));
    assert.ok(store.get("1200001", "2026-09-11"));
  });

  it("a revised figure overwrites the stored spend", () => {
    const first = rowsFromGraphRows([dayRow("2026-09-16", { spend: "10.00" })], {
      campaignId: "1200001",
      adAccountId: "act_99",
      draftId: "draft-1",
      objective: "registration",
      fetchedAt: "2026-09-16T10:00:00.000Z",
    });
    const second = rowsFromGraphRows([dayRow("2026-09-16", { spend: "12.50" })], {
      campaignId: "1200001",
      adAccountId: "act_99",
      draftId: "draft-1",
      objective: "registration",
      fetchedAt: "2026-09-16T18:00:00.000Z",
    });
    const merged = mergeCampaignDailyRows(first, second);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.spend, 12.5);
  });

  it("the backfill dry run writes nothing and names every row it would", async () => {
    const store = memoryStore();
    const days = fourteenDays();
    const result = await runCampaignDailyInsightsSync({
      now: NOW,
      dryRun: true,
      loadCampaigns: async () => [campaign()],
      resolveToken: async () => "token",
      fetchInsights: async () => days,
      upsert: async (rows) => store.upsert(rows),
    });
    assert.equal(result.written, 0);
    assert.equal(store.size(), 0);
    assert.equal(result.rows.length, 14);
    const named = result.rows.map(formatCampaignDailyDryRunRow);
    assert.equal(named.length, 14);
    assert.match(named[0]!, /1200001 2026-09-03 spend=10/);
    assert.match(named[13]!, /1200001 2026-09-16 spend=23/);
  });
});

describe("fetch shape", () => {
  it("asks for level=campaign and time_increment=1, filtered by campaign id", async () => {
    const seen: Array<{ path: string; params: Record<string, string> }> = [];
    await fetchCampaignDailyInsights(
      async (path, params) => {
        seen.push({ path, params });
        return { data: [] };
      },
      {
        adAccountId: "99",
        campaignId: "1200001",
        token: "token",
        since: "2026-09-03",
        until: "2026-09-16",
      },
    );
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.path, "/act_99/insights");
    assert.equal(seen[0]?.params.level, "campaign");
    assert.equal(seen[0]?.params.time_increment, "1");
    assert.match(seen[0]?.params.filtering ?? "", /campaign\.id/);
    assert.match(seen[0]?.params.fields ?? "", /inline_link_clicks/);
  });
});

describe("guards", () => {
  it("rollup-sync-events owns the pass even when no events are eligible", () => {
    assert.match(CRON, /runCampaignDailyInsightsPass/);
    assert.match(CRON, /eligibleIds\.length === 0/);
    assert.doesNotMatch(CRON, /from ["']@\/lib\/optimisation\/evaluate/);
    assert.doesNotMatch(CRON, /from ["']@\/lib\/optimisation\/apply/);
    assert.doesNotMatch(CRON, /from ["']@\/lib\/optimisation\/gates/);
    assert.doesNotMatch(CRON, /preflight\.ts/);
  });

  it("primary result candidates stay locked to live-metric.ts", () => {
    assert.match(
      LIVE_METRIC,
      /offsite_conversion\.fb_pixel_complete_registration/,
    );
    assert.match(LIVE_METRIC, /onsite_conversion\.complete_registration/);
    assert.match(LIVE_METRIC, /complete_registration/);
    assert.match(LIVE_METRIC, /offsite_conversion\.fb_pixel_purchase/);
    assert.match(LIVE_METRIC, /offsite_conversion\.fb_pixel_initiate_checkout/);
  });

  it("does not record campaign_automation_decisions or touch the evaluator", () => {
    const writer = readFileSync("lib/insights/campaign-daily.ts", "utf8");
    const cron = readFileSync("lib/insights/campaign-daily-cron.ts", "utf8");
    for (const source of [writer, cron, UPSERT]) {
      assert.doesNotMatch(source, /campaign_automation_decisions/);
      assert.doesNotMatch(source, /evaluateAdSet/);
      assert.doesNotMatch(source, /applyOptimisationDecision/);
    }
  });

  it("the backfill script is dry-run unless --apply", () => {
    const script = readFileSync(
      "scripts/backfill-campaign-daily-insights.ts",
      "utf8",
    );
    assert.match(script, /const APPLY = process\.argv\.includes\("--apply"\)/);
    assert.match(script, /dryRun: !APPLY/);
  });
});
