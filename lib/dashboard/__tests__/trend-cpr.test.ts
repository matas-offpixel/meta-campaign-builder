import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRegistrationsCardModel } from "../registrations-card-model.ts";
import { buildTrendCprSeries, trendCprPillLabel } from "../trend-cpr.ts";
import { buildTrendRegistrationsSeries } from "../trend-registrations.ts";

import {
  DOD_GENERAL_SALE_AT,
  DOD_SPEND,
  dodCirqlinDays,
} from "./dod-cirqlin-days.ts";

const mailchimp = {
  newSinceBaseline: 1686,
  totalSubscribers: 1686,
  baselineSubscribers: 0,
  lastSyncedAt: "2026-09-15T12:00:00Z",
  hasAudience: true,
  mailchimpAccountConnected: true,
};

const nowMs = Date.parse("2026-09-15T18:00:00Z");

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

const DOD_DATES = daysBetween("2026-08-18", "2026-09-16");

/** Window spend on 26 Aug, then ticket-phase spend after 9 Sept. */
const DOD_SPEND_ROWS = [
  { date: "2026-08-26", ad_spend: DOD_SPEND },
  { date: "2026-09-10", ad_spend: 93.76 },
  { date: "2026-09-11", ad_spend: 61.51 },
  { date: "2026-09-12", ad_spend: 26.19 },
  { date: "2026-09-13", ad_spend: 40.63 },
  { date: "2026-09-14", ad_spend: 39.2 },
  { date: "2026-09-15", ad_spend: 21.89 },
  { date: "2026-09-16", ad_spend: 2.33 },
];

function lastNonNull(values: Array<number | null>): number | null {
  let last: number | null = null;
  for (const value of values) {
    if (value != null) last = value;
  }
  return last;
}

describe("trend CPR series", () => {
  it("ends on the gen-sale day and is null after it, matching the card to the penny", () => {
    const series = buildTrendCprSeries({
      dates: DOD_DATES,
      spendRows: DOD_SPEND_ROWS,
      generalSaleAt: DOD_GENERAL_SALE_AT,
      cirqlinSnapshots: dodCirqlinDays(),
    });
    const i9 = DOD_DATES.indexOf("2026-09-09");
    const i10 = DOD_DATES.indexOf("2026-09-10");
    const i16 = DOD_DATES.indexOf("2026-09-16");
    assert.ok(i9 >= 0 && i10 >= 0 && i16 >= 0);
    assert.ok(series.daily[i9] != null);
    for (let i = i10; i <= i16; i++) {
      assert.equal(series.daily[i], null);
    }

    const card = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: dodCirqlinDays(),
      spendRows: DOD_SPEND_ROWS,
      generalSaleAt: DOD_GENERAL_SALE_AT,
      nowMs,
    });
    assert.ok(card.cpr);
    const last = lastNonNull(series.daily);
    assert.ok(last != null);
    assert.equal(Math.round(last * 100), Math.round((card.cpr.cpr ?? 0) * 100));
    assert.equal(Math.round(last * 100) / 100, 0.91);
    assert.equal(series.pillLabel, "CPR · to 9 Sept");
    assert.equal(trendCprPillLabel(series), "CPR · to 9 Sept");
  });

  it("is null before the first spend day", () => {
    const series = buildTrendCprSeries({
      dates: DOD_DATES,
      spendRows: DOD_SPEND_ROWS,
      generalSaleAt: DOD_GENERAL_SALE_AT,
      cirqlinSnapshots: dodCirqlinDays(),
    });
    assert.equal(series.daily[DOD_DATES.indexOf("2026-08-24")], null);
    assert.equal(series.daily[DOD_DATES.indexOf("2026-08-25")], null);
    assert.ok(series.daily[DOD_DATES.indexOf("2026-08-26")] != null);
  });

  it("has no null tail when general sale is unset, and the last point still equals the card", () => {
    const series = buildTrendCprSeries({
      dates: DOD_DATES,
      spendRows: DOD_SPEND_ROWS,
      generalSaleAt: null,
      cirqlinSnapshots: dodCirqlinDays(),
    });
    const i9 = DOD_DATES.indexOf("2026-09-09");
    const i16 = DOD_DATES.indexOf("2026-09-16");
    assert.ok(series.daily[i9] != null);
    assert.ok(series.daily[i16] != null);
    assert.equal(series.daily.slice(i9).some((value) => value == null), false);

    const card = buildRegistrationsCardModel({
      mailchimp,
      cirqlinSnapshots: dodCirqlinDays(),
      spendRows: DOD_SPEND_ROWS,
      generalSaleAt: null,
      nowMs,
    });
    assert.ok(card.cpr);
    const last = lastNonNull(series.daily);
    assert.ok(last != null);
    assert.equal(Math.round(last * 100), Math.round((card.cpr.cpr ?? 0) * 100));
    assert.equal(series.pillLabel, "CPR · all-time");
  });

  it("is entirely null when the window has spend and zero signups", () => {
    const series = buildTrendCprSeries({
      dates: ["2026-08-26", "2026-09-09", "2026-09-10"],
      spendRows: [{ date: "2026-08-26", ad_spend: 100 }],
      generalSaleAt: DOD_GENERAL_SALE_AT,
      cirqlinSnapshots: [
        {
          day: "2026-08-26",
          signups_day: 0,
          signups_total: 0,
          snapshot_at: "2026-09-15T12:00:00Z",
          raw_json: { totals: { counted: 0 } },
        },
      ],
    });
    assert.deepEqual(series.daily, [null, null, null]);
  });

  it("does not truncate the registrations tail — D.O.D stays 1,839 across 10–16 Sept", () => {
    const regs = buildTrendRegistrationsSeries({
      dates: DOD_DATES,
      cirqlinSnapshots: dodCirqlinDays(),
    });
    const i9 = DOD_DATES.indexOf("2026-09-09");
    const i16 = DOD_DATES.indexOf("2026-09-16");
    for (let i = i9; i <= i16; i++) {
      assert.equal(regs.cumulative[i], 1839);
    }
  });
});
