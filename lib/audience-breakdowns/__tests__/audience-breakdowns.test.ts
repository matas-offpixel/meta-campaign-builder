import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { TikTokApiError } from "../../tiktok/client.ts";
import { metaOwners, rowBelongsTo, tiktokOwners } from "../attribution.ts";
import { deriveMetaBreakdownRow, fetchMetaAccountBreakdowns, metaBreakdownParams, purchaseValue } from "../meta.ts";
import {
  audienceBreakdownsForClient,
  audienceBreakdownsForShow,
  audienceBreakdownsForVenue,
  NATION_ORDER,
  compareAge,
  summariseMeta,
  summariseTikTok,
  type MetaStoredRow,
  type TikTokStoredRow,
} from "../read.ts";
import { batchesByKeySet, isAudienceBreakdownsEnabled, runAudienceBreakdowns } from "../runner.ts";
import { UK_NATION_BY_PROVINCE, fetchTikTokAdvertiserBreakdowns, tiktokAge, tiktokGender, ukNation, type TikTokRequest } from "../tiktok.ts";
import { fakeDb } from "./fake-db.ts";

const NOW = new Date("2026-11-15T02:30:00Z");
const asDb = (db: unknown) => db as SupabaseClient;

const SHOWS = [
  { eventId: "lock", code: "NX26-LOCKLEAD", showDate: "2026-12-11", linkedCampaignIds: ["900"] },
  { eventId: "azyr", code: "NX26-AZYR", showDate: "2026-11-07", linkedCampaignIds: [] as string[] },
];

describe("killswitch: ENABLE_AUDIENCE_BREAKDOWNS exactly \"1\"", () => {
  it("is on only for \"1\"", () => {
    assert.equal(isAudienceBreakdownsEnabled({ ENABLE_AUDIENCE_BREAKDOWNS: "1" }), true);
    for (const v of [undefined, "", "true", "0", " 1"]) assert.equal(isAudienceBreakdownsEnabled({ ENABLE_AUDIENCE_BREAKDOWNS: v }), false);
  });

  it("off: no read, no call, no write", async () => {
    let calls = 0;
    const db = fakeDb({});
    const result = await runAudienceBreakdowns({
      env: {},
      db: asDb(db),
      graphGet: async () => {
        calls++;
        return { data: [] };
      },
    });
    assert.deepEqual(result, { ok: true, skippedReason: "killswitch" });
    assert.equal(calls, 0);
    assert.equal(db.upserts.length, 0);
  });
});

describe("Meta breakdown read", () => {
  it("asks for campaign-day insights with the rollup's attribution windows", () => {
    const p = metaBreakdownParams("age_gender")("2026-11-12", "2026-11-14", 500, "abc");
    assert.equal(p.level, "campaign");
    assert.equal(p.time_increment, "1");
    assert.equal(p.breakdowns, "age,gender");
    assert.equal(p.action_attribution_windows, JSON.stringify(["7d_click", "1d_view"]));
    assert.match(p.fields, /action_values/);
    assert.equal(p.after, "abc");
    assert.equal(metaBreakdownParams("region")("a", "b", 25).breakdowns, "region");
  });

  it("reads registrations as the first type present, never a sum, and revenue from action_values", () => {
    const row = deriveMetaBreakdownRow(
      "act_1",
      "age_gender",
      {
        date_start: "2026-11-13",
        campaign_id: "900",
        campaign_name: "[NX26-LOCKLEAD] Signup",
        age: "18-24",
        gender: "male",
        spend: "14.434",
        impressions: "2640",
        clicks: "162",
        inline_link_clicks: "130",
        actions: [
          { action_type: "offsite_conversion.fb_pixel_complete_registration", value: "54" },
          { action_type: "complete_registration", value: "54" },
          { action_type: "offsite_conversion.fb_pixel_purchase", value: "1" },
        ],
        action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "45.6" }],
      },
      NOW,
    );
    assert.ok(row);
    assert.equal(row.registrations, 54);
    assert.equal(row.purchases, 1);
    assert.equal(row.purchase_value, 45.6);
    assert.equal(row.spend, 14.43);
    assert.equal(row.region, "");
    assert.equal(purchaseValue(undefined), 0);
  });

  it("never carries campaign_name or event_id as a null key", () => {
    const row = deriveMetaBreakdownRow("act_1", "region", { date_start: "2026-11-13", campaign_id: "900", region: "England", spend: "1" }, NOW)!;
    assert.equal("campaign_name" in row, false);
    assert.equal("event_id" in row, false);
    assert.equal(row.age, "");
    assert.equal(row.region, "England");
    assert.equal(deriveMetaBreakdownRow("act_1", "region", { campaign_id: "900" }, NOW), null);
  });

  it("a rate limit on age+gender stops the account before the region read, every call counted", async () => {
    const asked: string[] = [];
    const out = await fetchMetaAccountBreakdowns({
      graphGet: async (_p, params) => {
        asked.push(params.breakdowns!);
        throw Object.assign(new Error("User request limit reached"), { code: 17 });
      },
      adAccountId: "act_1",
      since: "2026-11-12",
      until: "2026-11-14",
      now: NOW,
      onSpan: async () => null,
    });
    assert.deepEqual(asked, ["age,gender"]);
    assert.equal(out.calls, 1);
    assert.equal(out.stopped?.status, "rate_limited");
  });

  it("an ordinary error on one breakdown still reads the other", async () => {
    const asked: string[] = [];
    const out = await fetchMetaAccountBreakdowns({
      graphGet: async (_p, params) => {
        asked.push(params.breakdowns!);
        if (params.breakdowns === "age,gender") throw Object.assign(new Error("bad"), { code: 100 });
        return { data: [{ date_start: "2026-11-13", campaign_id: "900", region: "England", spend: "2" }] };
      },
      adAccountId: "act_1",
      since: "2026-11-13",
      until: "2026-11-13",
      now: NOW,
      onSpan: async () => null,
    });
    assert.deepEqual(asked, ["age,gender", "region"]);
    assert.equal(out.stopped, null);
    assert.equal(out.results[0]!.result.status, "error");
    assert.equal(out.results[1]!.result.status, "ok");
  });
});

describe("attribution: the dashboard's rule, no second matcher", () => {
  it("Meta: override, then events.meta_campaign_id, then [CODE] exactly as written", () => {
    const names = new Map([
      ["900", "Untagged signup"],
      ["901", "[NX26-AZYR] On sale"],
      ["902", "[NX26-Locklead] wrong case"],
      ["903", "[NX26-AZYR] moved"],
    ]);
    const owners = metaOwners({ shows: SHOWS, metaOverrides: { "903": "lock" } }, names);
    assert.equal(owners.get("900"), "lock");
    assert.equal(owners.get("901"), "azyr");
    assert.equal(owners.has("902"), false);
    assert.equal(owners.get("903"), "lock");
  });

  it("TikTok: override, then [CODE]; no name and no override is no owner", () => {
    const owners = tiktokOwners(
      { shows: SHOWS, tiktokOverrides: new Map([["t1", "lock"]]) },
      new Map([
        ["t1", "[NX26-Locklead] Locklead - SIGNUP"],
        ["t2", "[NX26-AZYR] Signup"],
      ]),
      ["t1", "t2", "t3"],
    );
    assert.equal(owners.get("t1"), "lock");
    assert.equal(owners.get("t2"), "azyr");
    assert.equal(owners.has("t3"), false);
  });

  it("a reader honours today's override over the stored show", () => {
    const overrides = new Map([["903", "lock"]]);
    assert.equal(rowBelongsTo("lock", { campaignId: "903", storedEventId: "azyr" }, overrides), true);
    assert.equal(rowBelongsTo("azyr", { campaignId: "903", storedEventId: "azyr" }, overrides), false);
    assert.equal(rowBelongsTo("azyr", { campaignId: "901", storedEventId: "azyr" }, overrides), true);
  });
});

describe("TikTok audience read", () => {
  it("names ages, genders and the UK nations", () => {
    assert.equal(tiktokAge("AGE_25_34"), "25-34");
    assert.equal(tiktokAge("AGE_55_100"), "55+");
    assert.equal(tiktokAge("NONE"), "unknown");
    assert.equal(tiktokGender("FEMALE"), "female");
    assert.equal(tiktokGender("NONE"), "unknown");
    assert.equal(ukNation("6269131"), "England");
    assert.equal(ukNation("2638360"), "Scotland");
    assert.equal(ukNation("2634895"), "Wales");
    assert.equal(ukNation("2641364"), "Northern Ireland");
    assert.equal(ukNation("2523119"), "Outside the UK");
    assert.equal(ukNation("-1"), "Unknown");
  });

  it("folds every non-UK province into one row, then names the campaigns", async () => {
    const asked: string[] = [];
    const request: TikTokRequest = async <T,>(path: string, params: Record<string, unknown>) => {
      asked.push(path === "/campaign/get/" ? "names" : String((params.dimensions as string[]).at(-1)));
      if (path === "/campaign/get/") return { list: [{ campaign_id: "t1", campaign_name: "[NX26-AZYR] Signup" }] } as T;
      const dims = params.dimensions as string[];
      if (dims.includes("province_id")) {
        return {
          list: [
            { dimensions: { campaign_id: "t1", stat_time_day: "2026-11-13 00:00:00", province_id: "6269131" }, metrics: { spend: "10", impressions: "1000", clicks: "5" } },
            { dimensions: { campaign_id: "t1", stat_time_day: "2026-11-13 00:00:00", province_id: "2523119" }, metrics: { spend: "0.5", impressions: "40", clicks: "0" } },
            { dimensions: { campaign_id: "t1", stat_time_day: "2026-11-13 00:00:00", province_id: "2905330" }, metrics: { spend: "0.25", impressions: "20", clicks: "1" } },
          ],
          page_info: { page: 1, total_page: 1 },
        } as T;
      }
      return {
        list: [{ dimensions: { campaign_id: "t1", stat_time_day: "2026-11-13 00:00:00", age: "AGE_18_24", gender: "MALE" }, metrics: { spend: "10.75", impressions: "1060", clicks: "6" } }],
        page_info: { page: 1, total_page: 1 },
      } as T;
    };
    const out = await fetchTikTokAdvertiserBreakdowns({ request, advertiserId: "a", token: "t", since: "2026-11-13", until: "2026-11-13", now: NOW });
    assert.equal(out.status, "ok");
    assert.equal(out.calls, 3);
    assert.deepEqual(asked, ["gender", "province_id", "names"]);
    const outside = out.rows.find((r) => r.nation === "Outside the UK")!;
    assert.equal(outside.spend, 0.75);
    assert.equal(outside.impressions, 60);
    assert.equal(outside.date, "2026-11-13");
    assert.ok(out.rows.every((r) => r.campaign_name === "[NX26-AZYR] Signup"));
  });

  it("a rate limit stops the advertiser and returns nothing to write", async () => {
    let calls = 0;
    const out = await fetchTikTokAdvertiserBreakdowns({
      request: async () => {
        calls++;
        throw new TikTokApiError("Too many requests", 50001);
      },
      advertiserId: "a",
      token: "t",
      since: "2026-11-13",
      until: "2026-11-13",
      now: NOW,
    });
    assert.equal(out.status, "rate_limited");
    assert.equal(calls, 1);
    assert.equal(out.rows.length, 0);
  });
});

describe("writes never send NULL over a stored value", () => {
  it("batches rows by their exact key set", () => {
    const batches = batchesByKeySet([{ a: 1, b: 2 }, { a: 1 }, { b: 2, a: 3 }, { a: 4 }]);
    assert.equal(batches.length, 2);
    for (const batch of batches) {
      const keys = new Set(batch.map((r) => Object.keys(r).sort().join(",")));
      assert.equal(keys.size, 1);
    }
  });
});

describe("runner", () => {
  const tables = () => ({
    clients: [
      { id: "c1", status: "active", meta_ad_account_id: "act_606252931141334", tiktok_account_id: "tt1" },
      { id: "c2", status: "archived", meta_ad_account_id: "act_999999999", tiktok_account_id: null },
    ],
    events: [
      { id: "lock", client_id: "c1", event_code: "NX26-LOCKLEAD", event_date: "2026-12-11", meta_campaign_id: null, meta_ad_account_id: null, tiktok_account_id: null },
      { id: "old", client_id: "c2", event_code: "OLD-1", event_date: "2026-01-01", meta_campaign_id: null, meta_ad_account_id: "act_999999999", tiktok_account_id: null },
    ],
    launched_ad_sets: [],
    campaign_event_overrides: [{ platform: "tiktok", campaign_id: "t1", event_id: "lock" }],
    tiktok_accounts: [{ id: "tt1", tiktok_advertiser_id: "7681317718284304385" }],
  });
  const graphGet = async (_path: string, params: Record<string, string>) => ({
    data: [
      params.breakdowns === "region"
        ? { date_start: "2026-11-13", campaign_id: "900", campaign_name: "[NX26-LOCKLEAD] Signup", region: "England", spend: "3" }
        : { date_start: "2026-11-13", campaign_id: "800", campaign_name: "No code", age: "18-24", gender: "female", spend: "1" },
    ],
  });
  const tiktok = {
    request: (async <T,>(path: string) =>
      (path === "/campaign/get/"
        ? { list: [{ campaign_id: "t1", campaign_name: "[NX26-Locklead] Locklead - SIGNUP" }] }
        : { list: [{ dimensions: { campaign_id: "t1", stat_time_day: "2026-11-13 00:00:00", age: "AGE_18_24", gender: "MALE", province_id: "6269131" }, metrics: { spend: "2", impressions: "100", clicks: "1" } }] }) as T) as TikTokRequest,
    getToken: async () => "token",
  };

  it("dry run reads both platforms, attributes, and writes nothing; archived clients' accounts are not read", async () => {
    const db = fakeDb(tables());
    const accounts: string[] = [];
    const result = await runAudienceBreakdowns({
      env: { ENABLE_AUDIENCE_BREAKDOWNS: "1" },
      db: asDb(db),
      graphGet: async (path, params) => {
        accounts.push(path);
        return graphGet(path, params);
      },
      tiktok,
      now: NOW,
      dryRun: true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.since, "2026-11-12");
    assert.equal(result.until, "2026-11-14");
    assert.equal(db.upserts.length, 0);
    assert.ok(accounts.every((p) => p.startsWith("/act_606252931141334/")));
    assert.equal(result.metaCalls, 2);
    assert.equal(result.tiktokCalls, 3);
    const meta = result.outcomes!.find((o) => o.platform === "meta")!;
    assert.equal(meta.rows, 2);
    assert.equal(meta.attributed, 1);
    const tt = result.outcomes!.find((o) => o.platform === "tiktok")!;
    assert.equal(tt.attributed, tt.rows);
  });

  it("apply upserts on the primary key, leaving event_id out of an unattributed row", async () => {
    const db = fakeDb(tables());
    const result = await runAudienceBreakdowns({ env: { ENABLE_AUDIENCE_BREAKDOWNS: "1" }, db: asDb(db), graphGet, tiktok, now: NOW });
    assert.equal(result.ok, true);
    const meta = db.upserts.filter((u) => u.table === "meta_audience_breakdowns");
    assert.ok(meta.length >= 2);
    assert.ok(meta.every((u) => u.onConflict === "meta_campaign_id,date,breakdown,age,gender,region"));
    const unattributed = meta.flatMap((u) => u.rows).find((r) => r.meta_campaign_id === "800")!;
    assert.equal("event_id" in unattributed, false);
    const tt = db.upserts.find((u) => u.table === "tiktok_audience_breakdowns")!;
    assert.equal(tt.onConflict, "tiktok_campaign_id,date,breakdown,age,gender,nation");
    assert.ok(tt.rows.every((r) => r.event_id === "lock"));
  });

  it("a scope read failure writes nothing", async () => {
    const db = fakeDb(tables(), { missing: ["events"] });
    const result = await runAudienceBreakdowns({ env: { ENABLE_AUDIENCE_BREAKDOWNS: "1" }, db: asDb(db), graphGet, tiktok, now: NOW });
    assert.equal(result.ok, false);
    assert.match(result.error ?? "", /scope read failed/);
    assert.equal(db.upserts.length, 0);
  });

  it("past the deadline, accounts are deferred, not read", async () => {
    const db = fakeDb(tables());
    let calls = 0;
    const result = await runAudienceBreakdowns({
      env: { ENABLE_AUDIENCE_BREAKDOWNS: "1" },
      db: asDb(db),
      graphGet: async () => {
        calls++;
        return { data: [] };
      },
      tiktok,
      now: NOW,
      deadline: Date.now() - 1,
    });
    assert.equal(calls, 0);
    assert.ok(result.outcomes!.every((o) => o.status === "deferred"));
    assert.equal(result.ok, false);
  });
});

const metaRow = (over: Partial<MetaStoredRow>): MetaStoredRow => ({
  meta_campaign_id: "900",
  date: "2026-11-13",
  breakdown: "age_gender",
  age: "18-24",
  gender: "female",
  region: "",
  event_id: "lock",
  campaign_name: "[NX26-LOCKLEAD] Signup",
  spend: 0,
  impressions: 0,
  clicks: 0,
  link_clicks: 0,
  registrations: 0,
  purchases: 0,
  purchase_value: 0,
  ...over,
});

describe("E1 tables from stored rows", () => {
  it("sums age across gender, with share, link CTR, cost per signup and per purchase", () => {
    const m = summariseMeta([
      metaRow({ age: "18-24", gender: "female", spend: "6.40", impressions: 1000, link_clicks: 20, registrations: 2 }),
      metaRow({ age: "18-24", gender: "male", spend: 13.6, impressions: 2000, link_clicks: 40, registrations: 8, purchases: 1, purchase_value: "45.60" }),
      metaRow({ age: "65+", gender: "male", spend: 5, impressions: 1000, link_clicks: 10 }),
      metaRow({ age: "Unknown", gender: "unknown", spend: 1, impressions: 0 }),
      metaRow({ breakdown: "region", age: "", gender: "", region: "England", spend: 24, impressions: 3900, registrations: 0 }),
      metaRow({ breakdown: "region", age: "", gender: "", region: "Scotland", spend: 1, impressions: 100 }),
    ]);
    assert.deepEqual(m.byAge.map((r) => r.segment), ["18-24", "65+", "Unknown"]);
    const young = m.byAge[0]!;
    assert.equal(young.spend, 20);
    assert.equal(young.impressionShare, 0.75);
    assert.equal(young.ctr, 0.02);
    assert.equal(young.signups, 10);
    assert.equal(young.costPerSignup, 2);
    assert.equal(young.costPerPurchase, 20);
    assert.equal(young.revenue, 45.6);
    assert.equal(m.byAge[1]!.costPerSignup, null);
    assert.equal(m.byAge[2]!.ctr, null);
    assert.equal(m.total.spend, 26);
    assert.deepEqual(m.byRegion.map((r) => r.segment), ["England", "Scotland"]);
    assert.equal(m.byRegion[0]!.impressionShare, 0.975);
    assert.equal("signups" in m.byRegion[0]!, false);
    assert.equal(m.campaigns, 1);
    assert.equal(m.firstDay, "2026-11-13");
  });

  it("orders ages by their first number, unknown last", () => {
    assert.deepEqual(["65+", "Unknown", "25-34", "18-24", "13-17"].sort(compareAge), ["13-17", "18-24", "25-34", "65+", "Unknown"]);
  });

  it("the nation order covers every name the TikTok read writes", () => {
    assert.deepEqual(NATION_ORDER.slice(0, 4).sort(), Object.values(UK_NATION_BY_PROVINCE).sort());
  });

  it("TikTok: clicks and CTR only, nations in fixed order", () => {
    const row = (over: Partial<TikTokStoredRow>): TikTokStoredRow => ({
      tiktok_campaign_id: "t1",
      date: "2026-11-13",
      breakdown: "age_gender",
      age: "18-24",
      gender: "male",
      nation: "",
      event_id: "lock",
      campaign_name: null,
      spend: 0,
      impressions: 0,
      clicks: 0,
      ...over,
    });
    const t = summariseTikTok([
      row({ spend: 2, impressions: 1000, clicks: 3 }),
      row({ breakdown: "nation", age: "", gender: "", nation: "Outside the UK", spend: 0.5, impressions: 10 }),
      row({ breakdown: "nation", age: "", gender: "", nation: "Scotland", spend: 0.5, impressions: 40 }),
      row({ breakdown: "nation", age: "", gender: "", nation: "England", spend: 1, impressions: 950 }),
    ]);
    assert.equal(t.total.ctr, 0.003);
    assert.deepEqual(t.byNation.map((r) => r.segment), ["England", "Scotland", "Outside the UK"]);
    assert.equal(t.byNation[0]!.impressionShare, 0.95);
    assert.equal("signups" in t.total, false);
  });
});

describe("read helpers: per show, venue, client", () => {
  const tables = () => ({
    events: [
      { id: "lock", client_id: "c1", venue_key: "nx newcastle" },
      { id: "azyr", client_id: "c1", venue_key: "nx newcastle" },
      { id: "bx", client_id: "c1", venue_key: "electric brixton" },
    ],
    campaign_event_overrides: [{ platform: "meta", campaign_id: "903", event_id: "lock" }],
    meta_audience_breakdowns: [
      metaRow({ meta_campaign_id: "900", event_id: "lock", spend: 10, impressions: 100 }),
      metaRow({ meta_campaign_id: "903", event_id: "azyr", spend: 5, impressions: 50 }),
      metaRow({ meta_campaign_id: "904", event_id: "azyr", spend: 7, impressions: 70 }),
      metaRow({ meta_campaign_id: "905", event_id: "bx", spend: 1, impressions: 10 }),
      metaRow({ meta_campaign_id: "900", date: "2026-10-01", event_id: "lock", spend: 100, impressions: 1000 }),
    ],
    tiktok_audience_breakdowns: [],
  });

  it("a show takes its stored rows plus campaigns overridden to it, and loses those overridden away", async () => {
    const db = fakeDb(tables());
    const lock = await audienceBreakdownsForShow(asDb(db), "lock", { since: "2026-11-01" });
    assert.equal(lock.meta.total.spend, 15);
    const azyr = await audienceBreakdownsForShow(asDb(db), "azyr");
    assert.equal(azyr.meta.total.spend, 7);
    const ordered = db.orders.filter((o) => o.table === "meta_audience_breakdowns");
    assert.ok(ordered.length > 0);
    assert.ok(ordered.every((o) => o.columns.join(",") === "meta_campaign_id,date,breakdown,age,gender,region"));
  });

  it("a venue is its shows by venue_key exactly; a client is all its shows", async () => {
    const db = fakeDb(tables());
    const venue = await audienceBreakdownsForVenue(asDb(db), "c1", "nx newcastle", { since: "2026-11-01" });
    assert.equal(venue.meta.total.spend, 22);
    const client = await audienceBreakdownsForClient(asDb(db), "c1", { since: "2026-11-01" });
    assert.equal(client.meta.total.spend, 23);
    assert.equal(client.tiktok.total.spend, 0);
  });

  it("before migration 245 is applied, a read is empty, not an error", async () => {
    const db = fakeDb(tables(), { missing: ["meta_audience_breakdowns", "tiktok_audience_breakdowns"] });
    const out = await audienceBreakdownsForShow(asDb(db), "lock");
    assert.equal(out.meta.total.spend, 0);
    assert.equal(out.meta.byAge.length, 0);
  });
});
