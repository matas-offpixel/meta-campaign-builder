/**
 * HE1 panel: E1 / EV1 as amended by PI1–PI3
 * (docs/design-record/2026-11-15-dashboard-v2-phase-2-ingest.html).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summariseMeta, summariseTikTok, type MetaStoredRow, type TikTokStoredRow } from "../../audience-breakdowns/read.ts";
import { LOCKLEAD_AUDIENCE, LOCKLEAD_CAMPAIGNS, locklead } from "../audience-panels-fixture.ts";
import {
  AGE_UNKNOWN,
  META_EMPTY,
  META_REGION_NOTE,
  META_REGION_TITLE,
  META_WITHHELD,
  REGION_UNKNOWN,
  TIKTOK_EMPTY,
  TIKTOK_NOTE,
  buildWhoWeReached,
  orderRegions,
  totalsNote,
} from "../who-we-reached.ts";

const EMPTY_TIKTOK = summariseTikTok([]);

function metaRow(over: Partial<MetaStoredRow>): MetaStoredRow {
  return {
    meta_campaign_id: "c1",
    date: "2026-11-01",
    breakdown: "age_gender",
    age: "18-24",
    gender: "female",
    region: "",
    event_id: "e1",
    campaign_name: "[X] Signup",
    spend: 10,
    impressions: 1000,
    clicks: 20,
    link_clicks: 10,
    registrations: 2,
    purchases: 0,
    purchase_value: 0,
    ...over,
  };
}

describe("Who we reached · Meta results by age (PI1)", () => {
  it("Locklead reads 'these add to 500 signups; the campaigns count 498' (HI1's acceptance)", () => {
    const m = locklead();
    assert.equal(m.metaSays.totalsNote, "Meta models its split by age, so these add to 500 signups; the campaigns count 498.");
    assert.equal(m.metaSays.withheld, null);
  });

  it("every age is a row, 65+ included, with 'Age unknown' last", () => {
    const rows = ["65+", "Unknown", "18-24", "55-64", "25-34"].map((age) => metaRow({ age }));
    const m = buildWhoWeReached({ meta: summariseMeta(rows), tiktok: EMPTY_TIKTOK }, null, "Show");
    assert.deepEqual(
      m.metaSays.byAge.map((r) => r.segment),
      ["18–24", "25–34", "55–64", "65+", AGE_UNKNOWN],
    );
  });

  it("the All row is the sum of the age rows, spend in whole pounds", () => {
    const m = locklead();
    assert.equal(m.metaSays.total.segment, "All");
    assert.equal(m.metaSays.total.spendText, "£1,570");
    assert.equal(m.metaSays.total.signupsText, "500");
    assert.equal(m.metaSays.total.purchasesText, "25");
    assert.equal(m.metaSays.total.revenueText, "£1,304");
    assert.deepEqual(
      m.metaSays.byAge.map((r) => r.spendText),
      ["£1,072", "£411", "£79", "£7", "£0"],
    );
  });

  it("the CTR column is link clicks ÷ impressions ('Link CTR')", () => {
    const m = locklead();
    assert.equal(m.metaSays.byAge[0]!.linkCtrText, "1.12 %");
    assert.equal(m.metaSays.byAge[0]!.impressionShareText, "69.2 %");
    assert.equal(m.metaSays.byAge[0]!.costPerSignupText, "£2.94");
    assert.equal(m.metaSays.byAge[2]!.costPerPurchaseText, "—");
  });

  it("names only the measures that differ", () => {
    assert.equal(totalsNote({ signups: 500, purchases: 25 }, { spend: 0, signups: 500, purchases: 25 }), null);
    assert.equal(
      totalsNote({ signups: 500, purchases: 24 }, { spend: 0, signups: 500, purchases: 25 }),
      "Meta models its split by age, so these add to 24 purchases; the campaigns count 25.",
    );
    assert.equal(
      totalsNote({ signups: 1500, purchases: 24 }, { spend: 0, signups: 1498, purchases: 25 }),
      "Meta models its split by age, so these add to 1,500 signups and 24 purchases; the campaigns count 1,498 and 25.",
    );
    assert.equal(totalsNote({ signups: 500, purchases: 24 }, null), null);
  });

  it("withholds the table when spend is more than £1 off the campaigns' (a data fault)", () => {
    const off = buildWhoWeReached(LOCKLEAD_AUDIENCE, { ...LOCKLEAD_CAMPAIGNS, spend: 1568.5 }, "Locklead");
    assert.equal(off.metaSays.withheld, META_WITHHELD);
    assert.equal(off.metaSays.totalsNote, null);
    const pennies = buildWhoWeReached(LOCKLEAD_AUDIENCE, { ...LOCKLEAD_CAMPAIGNS, spend: 1568.6 }, "Locklead");
    assert.equal(pennies.metaSays.withheld, null);
  });

  it("keeps byGender in the model", () => {
    assert.deepEqual(
      locklead().metaSays.byGender.map((r) => r.segment),
      ["female", "male", "unknown"],
    );
  });

  it("says so when there's no Meta delivery", () => {
    const m = buildWhoWeReached({ meta: summariseMeta([]), tiktok: EMPTY_TIKTOK }, null, "Show");
    assert.equal(m.metaSays.empty, META_EMPTY);
    assert.equal(m.tiktok.empty, TIKTOK_EMPTY);
  });

  it("footnotes the scope and the days", () => {
    assert.equal(locklead().metaSays.footnote, "Locklead · all Meta campaigns · 29 Oct – 14 Nov");
  });
});

describe("Who we reached · Meta delivery by region (PI2)", () => {
  it("is its own table with its title and line, and no result columns", () => {
    const region = locklead().metaSays.region!;
    assert.equal(region.title, META_REGION_TITLE);
    assert.equal(region.note, META_REGION_NOTE);
    assert.deepEqual(Object.keys(region.rows[0]!).sort(), ["impressionShareText", "linkCtrText", "segment", "spend", "spendText"]);
    assert.deepEqual(
      region.rows.map((r) => r.segment),
      ["England", "Scotland", REGION_UNKNOWN],
    );
  });

  it("orders England, Scotland, Wales, Northern Ireland, the rest by spend, then unknown", () => {
    const r = (segment: string, spend: number) => ({ segment, spend, impressions: 1, impressionShare: null, clicks: 0, linkClicks: 0, ctr: null });
    assert.deepEqual(
      orderRegions([r("Unknown", 5), r("Ireland", 1), r("Northern Ireland", 1), r("Wales", 1), r("Île-de-France", 3), r("England", 0.5)]).map((x) => x.segment),
      ["England", "Wales", "Northern Ireland", "Île-de-France", "Ireland", "Unknown"],
    );
  });
});

describe("Who we reached · TikTok (PI3)", () => {
  it("spend, impressions and clicks only, by age and by nation, with E1's sentence", () => {
    const t = locklead().tiktok;
    assert.equal(t.note, TIKTOK_NOTE);
    assert.deepEqual(Object.keys(t.byAge[0]!).sort(), ["clicksText", "ctrText", "impressionShareText", "impressionsText", "segment", "spend", "spendText"]);
    assert.equal(t.byAge[0]!.ctrText, "0.29 %");
    assert.deepEqual(t.byNation.map((r) => r.segment), ["England"]);
    assert.equal(t.total.clicksText, "261");
  });

  it("folds TikTok's unknown age into one 'Age unknown' row", () => {
    const rows: TikTokStoredRow[] = ["18-24", "unknown", "Unknown"].map((age) => ({
      tiktok_campaign_id: "t1",
      date: "2026-11-01",
      breakdown: "age_gender",
      age,
      gender: "female",
      nation: "",
      event_id: "e1",
      campaign_name: null,
      spend: 1,
      impressions: 100,
      clicks: 1,
    }));
    const m = buildWhoWeReached({ meta: summariseMeta([]), tiktok: summariseTikTok(rows) }, null, "Show");
    assert.deepEqual(m.tiktok.byAge.map((r) => [r.segment, r.impressionsText]), [["18–24", "100"], [AGE_UNKNOWN, "200"]]);
  });
});
