import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aggregatePresaleBucket } from "../presale-bucket.ts";
import { bucketRegs } from "../presale-bucket-cells.ts";
import { presaleBucketLabel } from "../tracker-phase.ts";
import {
  SIGNUP_WINDOW_MIN_DAY,
  SIGNUP_WINDOW_THRESHOLD_LINE,
  applySignupWindowToBucket,
  resolveSignupWindow,
  signupHistoryLine,
  signupWindowLine,
} from "../signup-window.ts";

import { DOD_GENERAL_SALE_AT, dodCirqlinDays } from "./dod-cirqlin-days.ts";

const DOD = {
  announcementAt: "2026-09-02T16:00:00+00:00",
  presaleAt: "2026-09-09T11:00:00+00:00",
  generalSaleAt: DOD_GENERAL_SALE_AT,
};

describe("resolveSignupWindow", () => {
  it("starts D.O.D on the first day above 5 and leaves the test days out", () => {
    const window = resolveSignupWindow(dodCirqlinDays());
    assert.equal(SIGNUP_WINDOW_MIN_DAY, 5);
    assert.equal(window.startDay, "2026-08-24");
    assert.equal(window.usedThreshold, true);
    assert.equal(window.firstSignupDay, "2026-08-18");
    assert.equal(window.excludedSignups, 4);
    assert.equal(window.windowSignups, 1839);
    assert.equal(
      signupWindowLine(window),
      "4 signups before the campaign window — excluded.",
    );
  });

  it("skips the 1970 sentinel when searching for a start", () => {
    const window = resolveSignupWindow(dodCirqlinDays());
    assert.notEqual(window.startDay, "1970-01-01");
  });

  it("falls back to the first signup day when nothing exceeds 5", () => {
    const window = resolveSignupWindow([
      {
        day: "2026-08-18",
        signups_day: 2,
        signups_total: 5,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
      {
        day: "2026-08-19",
        signups_day: 3,
        signups_total: 5,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
    ]);
    assert.equal(window.startDay, "2026-08-18");
    assert.equal(window.usedThreshold, false);
    assert.equal(window.excludedSignups, 0);
    assert.equal(window.windowSignups, 5);
    assert.equal(signupWindowLine(window), SIGNUP_WINDOW_THRESHOLD_LINE);
  });

  it("does not start the window on a day of exactly 5; a day of 6 does", () => {
    const window = resolveSignupWindow([
      {
        day: "2026-08-23",
        signups_day: 5,
        signups_total: 11,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
      {
        day: "2026-08-24",
        signups_day: 6,
        signups_total: 11,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
    ]);
    assert.equal(SIGNUP_WINDOW_MIN_DAY, 5);
    assert.notEqual(window.startDay, "2026-08-23");
    assert.equal(window.startDay, "2026-08-24");
    assert.equal(window.usedThreshold, true);
    assert.equal(window.excludedSignups, 5);
  });

  it("says nothing when nothing was excluded", () => {
    const window = resolveSignupWindow([
      {
        day: "2026-08-24",
        signups_day: 130,
        signups_total: 130,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
    ]);
    assert.equal(window.excludedSignups, 0);
    assert.equal(signupWindowLine(window), null);
  });
});

describe("applySignupWindowToBucket", () => {
  it("labels D.O.D from 24 Aug and puts 1,806 in the collapsed REGS cell", () => {
    const rollup = aggregatePresaleBucket(
      [
        { date: "2026-08-26", ad_spend: 100, meta_regs: 10 },
        { date: "2026-09-08", ad_spend: 50, meta_regs: 4 },
      ],
      "2026-09-09",
    );
    const bucket = applySignupWindowToBucket(rollup, dodCirqlinDays());
    assert.ok(bucket);
    assert.equal(bucket.earliestDate, "2026-08-24");
    assert.equal(
      presaleBucketLabel({
        cutoffDate: bucket.cutoffDate,
        earliestDate: bucket.earliestDate,
        milestones: DOD,
      }),
      "Signup phase (24 Aug – 8 Sept)",
    );
    assert.equal(
      bucketRegs({
        presale: bucket,
        mailchimpSnapshots: null,
        cirqlinSnapshots: dodCirqlinDays(),
        isBrandCampaign: false,
      }),
      1806,
    );
    const genSale = dodCirqlinDays().find((row) => row.day === "2026-09-09");
    assert.equal((bucketRegs({
      presale: bucket,
      mailchimpSnapshots: null,
      cirqlinSnapshots: dodCirqlinDays(),
      isBrandCampaign: false,
    }) ?? 0) + (genSale?.signups_day ?? 0), 1839);
  });

  it("keeps the bucket's own earliestDate when spend starts before the window", () => {
    const rollup = aggregatePresaleBucket(
      [
        { date: "2026-08-20", ad_spend: 80, meta_regs: 0 },
        { date: "2026-09-08", ad_spend: 50, meta_regs: 4 },
      ],
      "2026-09-09",
    );
    assert.ok(rollup);
    assert.equal(rollup.earliestDate, "2026-08-20");
    const bucket = applySignupWindowToBucket(rollup, dodCirqlinDays());
    assert.ok(bucket);
    assert.equal(bucket.earliestDate, "2026-08-20");
  });
});

describe("signupHistoryLine", () => {
  it("names the gap when per-day rows start after the first signup", () => {
    const window = resolveSignupWindow([
      {
        day: "2026-09-03",
        signups_day: 80,
        signups_total: 1839,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
      {
        day: "2026-09-04",
        signups_day: 1347,
        signups_total: 1839,
        snapshot_at: "2026-09-15T12:00:00Z",
        raw_json: {},
      },
    ]);
    assert.equal(window.windowSignups, 1427);
    assert.equal(window.excludedSignups, 0);
    assert.equal(
      signupHistoryLine(window, 1839),
      "Per-day history starts 3 Sept; 412 earlier signups are in the total but not the daily curve.",
    );
  });
});
