import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op, type FakeCall } from "../../../launched-ads/__tests__/fake-db.ts";
import { describeFailedAccounts } from "../../../reporting/cron-health-monitor-format.ts";
import { campaignEventCode } from "../../../reporting/campaign-matching.ts";
import {
  countEnabledConversionActions,
  mapCampaignRow,
  mapLocationRows,
  mapSearchTermRows,
  type AccountScope,
  type PlanLink,
} from "../map.ts";
import {
  GOOGLE_ADS_PAGE_ROWS,
  insightsWindow,
  missingCampaignDays,
  queryAllRows,
  runGoogleAdsDailyInsights,
} from "../runner.ts";

const SCOPE: AccountScope = { googleAdsAccountId: "acct-iw", userId: "user-1", customerId: "8398183094" };
const AT = "2026-10-08T04:00:00.000Z";
const SEARCH_RN = "customers/8398183094/campaigns/24322848873";
const PLANS = new Map<string, PlanLink>([[SEARCH_RN, { plan_id: "plan-cp", plan_kind: "search" }]]);

// Shapes as GoogleAdsClient.query returned them from the live API (8 Oct 2026).
const SEARCH_ROW = {
  campaign: {
    resource_name: SEARCH_RN,
    advertising_channel_type: "SEARCH",
    name: "[IRW0004] CP | Search | C1 Brand-Event-Venue",
  },
  metrics: {
    clicks: "34",
    search_impression_share: 0.41116751269035534,
    conversions_value: 12.5,
    conversions: 1,
    cost_micros: "1010000",
    impressions: "93",
    video_trueview_views: "0",
  },
  segments: { date: "2026-10-07" },
};

const VIDEO_ROW = {
  campaign: {
    resource_name: "customers/2885015945/campaigns/23787537755",
    advertising_channel_type: "VIDEO",
    name: "[BB26-KAYODE] YT Views",
  },
  metrics: {
    cost_micros: "140151353",
    impressions: "429229",
    trueview_average_cpv: 3069.7247459260557,
    video_trueview_view_rate: 0.10636746352180304,
    video_trueview_views: "45656",
  },
  segments: { date: "2026-08-02" },
};

describe("GAQL campaign row → google_ads_daily_snapshots", () => {
  it("maps a SEARCH row: micros kept, impression share kept, video fields null, plan linked", () => {
    assert.deepEqual(mapCampaignRow(SEARCH_ROW, SCOPE, PLANS, AT), {
      user_id: "user-1",
      google_ads_account_id: "acct-iw",
      customer_id: "8398183094",
      plan_id: "plan-cp",
      plan_kind: "search",
      campaign_resource_name: SEARCH_RN,
      campaign_name: "[IRW0004] CP | Search | C1 Brand-Event-Venue",
      advertising_channel_type: "SEARCH",
      event_code: "IRW0004",
      date: "2026-10-07",
      impressions: 93,
      clicks: 34,
      cost_micros: 1010000,
      conversions: 1,
      conversion_value_micros: 12_500_000,
      video_trueview_views: null,
      video_trueview_view_rate: null,
      trueview_average_cpv_micros: null,
      search_impression_share: 0.41116751269035534,
      fetched_at: AT,
    });
  });

  it("maps a VIDEO row: TrueView views, rate and CPV in micros; clicks absent read as 0; no impression share", () => {
    const row = mapCampaignRow(VIDEO_ROW, { ...SCOPE, customerId: "2885015945" }, PLANS, AT);
    assert.ok(row);
    assert.equal(row.plan_id, null);
    assert.equal(row.plan_kind, null);
    assert.equal(row.event_code, "BB26-KAYODE");
    assert.equal(row.advertising_channel_type, "VIDEO");
    assert.equal(row.clicks, 0);
    assert.equal(row.cost_micros, 140151353);
    assert.equal(row.video_trueview_views, 45656);
    assert.equal(row.video_trueview_view_rate, 0.10636746352180304);
    assert.equal(row.trueview_average_cpv_micros, 3070);
    assert.equal(Math.round(row.cost_micros / row.video_trueview_views!), row.trueview_average_cpv_micros);
    assert.equal(row.search_impression_share, null);
  });

  it("drops a row with no resource name or date", () => {
    assert.equal(mapCampaignRow({ ...SEARCH_ROW, segments: {} }, SCOPE, PLANS, AT), null);
    assert.equal(mapCampaignRow({ ...SEARCH_ROW, campaign: {} }, SCOPE, PLANS, AT), null);
  });

  it("links a video plan by google_campaign_resource_name", () => {
    const plans = new Map<string, PlanLink>([[VIDEO_ROW.campaign.resource_name, { plan_id: "plan-v", plan_kind: "video" }]]);
    const row = mapCampaignRow(VIDEO_ROW, SCOPE, plans, AT);
    assert.equal(row?.plan_id, "plan-v");
    assert.equal(row?.plan_kind, "video");
  });
});

describe("event_code from the campaign name", () => {
  it("is the first [CODE], exactly as written: never uppercased or normalised", () => {
    assert.equal(campaignEventCode("[irw0004-Relaunch] CP | Search"), "irw0004-Relaunch");
    assert.equal(campaignEventCode("[ IRW0001 ] JJ | Search"), "IRW0001");
    assert.equal(campaignEventCode("[Bb26-Kayode] x [OTHER]"), "Bb26-Kayode");
    assert.equal(campaignEventCode("BB26-SAINTCLAIR"), null);
    const row = mapCampaignRow(
      { ...SEARCH_ROW, campaign: { ...SEARCH_ROW.campaign, name: "[irw0004] lower" } },
      SCOPE,
      PLANS,
      AT,
    );
    assert.equal(row?.event_code, "irw0004");
  });

  it("nothing in the module uppercases", () => {
    const dir = new URL("../", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /toUpperCase|toLocaleUpperCase/, file);
    }
  });
});

describe("search terms, locations, conversion actions", () => {
  it("maps search_term_view rows and sums duplicate keys", () => {
    const raw = {
      campaign: { resource_name: SEARCH_RN },
      ad_group: { resource_name: "customers/8398183094/adGroups/195704660130" },
      metrics: { clicks: "14", conversions: 0.5, cost_micros: "330000", impressions: "41" },
      search_term_view: { search_term: "Appetite Halloween" },
      segments: { search_term_match_type: "EXACT", date: "2026-10-07" },
    };
    const rows = mapSearchTermRows([raw, raw], SCOPE, PLANS, AT);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      user_id: "user-1",
      customer_id: "8398183094",
      plan_id: "plan-cp",
      campaign_resource_name: SEARCH_RN,
      ad_group_resource_name: "customers/8398183094/adGroups/195704660130",
      date: "2026-10-07",
      search_term: "Appetite Halloween",
      match_type: "EXACT",
      clicks: 28,
      impressions: 82,
      cost_micros: 660000,
      conversions: 1,
      fetched_at: AT,
    });
  });

  it("maps geographic_view rows with country and location type", () => {
    const rows = mapLocationRows(
      [
        {
          campaign: { resource_name: SEARCH_RN },
          metrics: { clicks: "5", cost_micros: "1050000", impressions: "364" },
          segments: { date: "2026-10-08" },
          geographic_view: { location_type: "LOCATION_OF_PRESENCE", country_criterion_id: "2032" },
        },
        { campaign: { resource_name: SEARCH_RN }, segments: { date: "2026-10-08" }, geographic_view: {} },
      ],
      SCOPE,
      AT,
    );
    assert.deepEqual(rows, [
      {
        user_id: "user-1",
        customer_id: "8398183094",
        campaign_resource_name: SEARCH_RN,
        date: "2026-10-08",
        country_criterion_id: 2032,
        location_type: "LOCATION_OF_PRESENCE",
        clicks: 5,
        impressions: 364,
        cost_micros: 1050000,
        fetched_at: AT,
      },
    ]);
  });

  it("GOOGLE_HOSTED conversion actions don't count as tracking", () => {
    assert.equal(
      countEnabledConversionActions([
        { conversion_action: { status: "ENABLED", type: "GOOGLE_HOSTED" } },
        { conversion_action: { status: "HIDDEN", type: "WEBPAGE" } },
      ]),
      0,
    );
    assert.equal(countEnabledConversionActions([{ conversion_action: { status: "ENABLED", type: "WEBPAGE" } }]), 1);
  });
});

describe("window and paging", () => {
  it("restates the last three complete UTC days", () => {
    assert.deepEqual(insightsWindow(new Date("2026-10-08T04:00:00Z")), { since: "2026-10-05", until: "2026-10-07" });
  });

  it("halves a span that fills a page, down to one day, and reports a full one-day page", async () => {
    const asked: string[] = [];
    const truncated: string[] = [];
    const rows = await queryAllRows(
      async (w) => {
        asked.push(`${w.since}..${w.until}`);
        const full = w.since !== w.until || w.since === "2026-10-05";
        return new Array(full ? GOOGLE_ADS_PAGE_ROWS : 3).fill(w.since);
      },
      { since: "2026-10-05", until: "2026-10-07" },
      truncated,
    );
    assert.deepEqual(asked, [
      "2026-10-05..2026-10-07",
      "2026-10-05..2026-10-05",
      "2026-10-06..2026-10-07",
      "2026-10-06..2026-10-06",
      "2026-10-07..2026-10-07",
    ]);
    assert.deepEqual(truncated, ["2026-10-05"]);
    assert.equal(rows.length, GOOGLE_ADS_PAGE_ROWS + 6);
  });
});

/** Supabase stand-in for one run: one client on one account, one event. */
function runDb(options: { rollup: { date: string; google_ads_spend: number }[] }) {
  return fakeDb((call: FakeCall) => {
    switch (call.table) {
      case "clients":
        return { data: [{ id: "client-iw", status: "active", google_ads_account_id: "acct-iw" }], error: null };
      case "events":
        return { data: [{ id: "event-cp", client_id: "client-iw", google_ads_account_id: null }], error: null };
      case "google_ads_accounts":
        if (op(call, "update")) return { data: null, error: null };
        return { data: [{ id: "acct-iw", user_id: "user-1", google_customer_id: "839-818-3094" }], error: null };
      case "google_video_campaigns":
        return { data: [], error: null };
      case "google_search_campaigns":
        return { data: [{ plan_id: "plan-cp", pushed_resource_name: SEARCH_RN }], error: null };
      case "event_daily_rollups":
        return { data: options.rollup.map((r) => ({ event_id: "event-cp", ...r })), error: null };
      default:
        return { data: null, error: null };
    }
  });
}

const CREDS = { customer_id: "839-818-3094", refresh_token: "rt", login_customer_id: "333-703-8088" };

function queryReturning(campaignRows: unknown[]) {
  const gaql: string[] = [];
  return {
    gaql,
    query: async (_c: unknown, q: string) => {
      gaql.push(q);
      return q.includes("FROM campaign ") ? campaignRows : [];
    },
  };
}

describe("runner", () => {
  it("killswitch: unset or not exactly \"1\" touches nothing", async () => {
    for (const value of [undefined, "true", "0", " 1"]) {
      const { db, calls } = fakeDb(() => ({ data: [], error: null }));
      let queried = 0;
      const result = await runGoogleAdsDailyInsights({
        env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: value },
        db,
        query: async () => {
          queried += 1;
          return [];
        },
        loadCredentials: async () => CREDS,
      });
      assert.deepEqual(result, { ok: true, skippedReason: "killswitch" });
      assert.equal(calls.length, 0);
      assert.equal(queried, 0);
    }
  });

  it("ok: writes campaign rows, counts calls, records the run", async () => {
    const { db, calls } = runDb({ rollup: [{ date: "2026-10-07", google_ads_spend: 1.01 }] });
    const google = queryReturning([SEARCH_ROW]);
    const result = await runGoogleAdsDailyInsights({
      env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: "1" },
      db,
      query: google.query,
      loadCredentials: async () => CREDS,
      now: new Date(AT),
      recordRun: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.calls, 4);
    assert.ok(google.gaql.every((q) => /^SELECT /.test(q)));
    const upsert = calls.find((c) => c.table === "google_ads_daily_snapshots");
    assert.equal((op(upsert!, "upsert")![0] as { plan_id: string }[])[0].plan_id, "plan-cp");
    assert.deepEqual(op(upsert!, "upsert")![1], { onConflict: "campaign_resource_name,date" });
    const run = calls.find((c) => c.table === "google_ads_insights_runs");
    assert.equal((op(run!, "insert")![0] as { ok: boolean }).ok, true);
  });

  it("silent failure: rollup Google spend > 0 on a day with zero campaign rows fails the account and the run", async () => {
    const { db, calls } = runDb({
      rollup: [
        { date: "2026-10-06", google_ads_spend: 9.4 },
        { date: "2026-10-07", google_ads_spend: 1.01 },
      ],
    });
    const result = await runGoogleAdsDailyInsights({
      env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: "1" },
      db,
      query: queryReturning([SEARCH_ROW]).query,
      loadCredentials: async () => CREDS,
      now: new Date(AT),
      recordRun: true,
    });
    assert.equal(result.ok, false);
    const [outcome] = result.outcomes!;
    assert.equal(outcome.status, "rollup_spend_without_campaign_rows");
    assert.deepEqual(outcome.missingDays, ["2026-10-06"]);
    const run = op(calls.find((c) => c.table === "google_ads_insights_runs")!, "insert")![0] as {
      ok: boolean;
      failed_accounts: unknown;
    };
    assert.equal(run.ok, false);
    assert.equal(
      describeFailedAccounts(run.failed_accounts),
      "839-818-3094 rollup_spend_without_campaign_rows (2026-10-06)",
    );
  });

  it("silent failure holds in a dry run too, and a dry run writes nothing", async () => {
    const { db, calls } = runDb({ rollup: [{ date: "2026-10-07", google_ads_spend: 3 }] });
    const result = await runGoogleAdsDailyInsights({
      env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: "1" },
      db,
      query: queryReturning([]).query,
      loadCredentials: async () => CREDS,
      now: new Date(AT),
      write: false,
      recordRun: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcomes![0].status, "rollup_spend_without_campaign_rows");
    assert.ok(calls.every((c) => !op(c, "upsert") && !op(c, "insert") && !op(c, "update")));
  });

  it("no rollup spend and no campaign rows is ok; missingCampaignDays ignores zero spend", async () => {
    assert.deepEqual(missingCampaignDays(new Map([["2026-10-07", 0]]), []), []);
    assert.deepEqual(missingCampaignDays(undefined, []), []);
    const { db } = runDb({ rollup: [] });
    const result = await runGoogleAdsDailyInsights({
      env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: "1" },
      db,
      query: queryReturning([]).query,
      loadCredentials: async () => CREDS,
      now: new Date(AT),
    });
    assert.equal(result.ok, true);
  });

  it("an account without credentials fails the run", async () => {
    const { db } = runDb({ rollup: [] });
    const result = await runGoogleAdsDailyInsights({
      env: { ENABLE_GOOGLE_ADS_DAILY_INSIGHTS: "1" },
      db,
      query: queryReturning([]).query,
      loadCredentials: async () => null,
      now: new Date(AT),
    });
    assert.equal(result.ok, false);
    assert.equal(result.outcomes![0].status, "no_credentials");
  });
});

describe("wiring", () => {
  it("route: killswitch before any client, 207 on failure, 04:00 UTC, cron-health, CLAUDE.md", () => {
    const route = readFileSync("app/api/cron/google-ads-daily-insights/route.ts", "utf8");
    const kill = route.indexOf("isGoogleAdsDailyInsightsEnabled(process.env)");
    assert.ok(kill > 0 && kill < route.indexOf("createServiceRoleClient()") && kill < route.indexOf("new GoogleAdsClient()"));
    assert.match(route, /skippedReason: "killswitch"/);
    assert.match(route, /result\.ok \? 200 : 207/);
    assert.doesNotMatch(route, /mutate/);
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    assert.deepEqual(
      vercel.crons.find((c) => c.path === "/api/cron/google-ads-daily-insights"),
      { path: "/api/cron/google-ads-daily-insights", schedule: "0 4 * * *" },
    );
    assert.match(
      readFileSync("lib/reporting/cron-health-monitor.ts", "utf8"),
      /table: "google_ads_insights_runs", freshColumn: "run_at".*okColumn: "ok"/,
    );
    assert.match(readFileSync("CLAUDE.md", "utf8"), /ENABLE_GOOGLE_ADS_DAILY_INSIGHTS=/);
  });

  it("the module never mutates Google Ads", () => {
    const dir = new URL("../", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      assert.doesNotMatch(readFileSync(new URL(file, dir), "utf8"), /\.mutate\(|:mutate/, file);
    }
    assert.doesNotMatch(readFileSync("scripts/backfill-google-ads-insights.mts", "utf8"), /\.mutate\(/);
  });

  it("migration 192: three unique keys, run log, owner-only read policies", () => {
    const sql = readFileSync("supabase/migrations/192_google_ads_campaign_insights.sql", "utf8");
    assert.match(sql, /unique \(campaign_resource_name, date\)/);
    assert.match(sql, /unique \(campaign_resource_name, ad_group_resource_name, date, search_term, match_type\)/);
    assert.match(sql, /unique \(campaign_resource_name, date, country_criterion_id, location_type\)/);
    assert.match(sql, /create table if not exists google_ads_insights_runs/);
    assert.match(sql, /using \(user_id = auth\.uid\(\)\)/);
    assert.doesNotMatch(sql, /for (insert|update|all)/);
  });
});
