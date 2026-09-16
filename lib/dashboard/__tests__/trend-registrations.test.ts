import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildTrendRegistrationsSeries,
  isReconstructedMailchimpSnapshot,
  trendRegistrationsSource,
} from "../trend-registrations.ts";

import { dodCirqlinDays } from "./dod-cirqlin-days.ts";

describe("trend registrations series", () => {
  it("names Cirqlin when those snapshots exist", () => {
    assert.equal(
      trendRegistrationsSource({ cirqlinSnapshots: dodCirqlinDays() }),
      "cirqlin",
    );
  });

  it("matches the tracker REGS column day for day and names Cirqlin on the pill", () => {
    const rows = dodCirqlinDays().filter((row) => row.day !== "1970-01-01");
    const dates = rows.map((row) => row.day);
    const series = buildTrendRegistrationsSeries({
      dates,
      cirqlinSnapshots: dodCirqlinDays(),
    });
    assert.equal(series.source, "cirqlin");
    assert.equal(series.pillSource, "Cirqlin");
    assert.equal(series.hasPlottablePoints, true);
    assert.equal(series.windowStart, "2026-08-24");
    const i18 = dates.indexOf("2026-08-18");
    const i24 = dates.indexOf("2026-08-24");
    assert.ok(i18 >= 0 && i24 >= 0);
    assert.equal(series.daily[i18], null);
    assert.equal(series.cumulative[i18], null);
    assert.equal(series.daily[i24], 130);
    assert.equal(series.cumulative.at(-1), 1839);
  });

  it("excludes reconstructed Mailchimp rows from the series", () => {
    const rows = [
      {
        snapshot_at: "2026-08-26T12:00:00Z",
        email_subscribers: 674,
        raw_json: { method: "weighted_ramp_pre_snapshot" },
      },
      {
        snapshot_at: "2026-08-27T12:00:00Z",
        email_subscribers: 1265,
        raw_json: { method: "weighted_ramp_pre_snapshot" },
      },
      {
        snapshot_at: "2026-09-15T12:00:00Z",
        email_subscribers: 1686,
        raw_json: { method: "mailchimp_tag_sync" },
      },
    ];
    assert.equal(isReconstructedMailchimpSnapshot(rows[0]!), true);
    const series = buildTrendRegistrationsSeries({
      dates: ["2026-08-26", "2026-08-27", "2026-09-15"],
      mailchimpSnapshots: rows,
    });
    assert.equal(series.source, "mailchimp");
    assert.equal(series.daily[0], null);
    assert.equal(series.daily[1], null);
    assert.equal(series.daily[2], 1686);
    assert.match(series.reconstructedCaption ?? "", /reconstructed, not measured/);
  });

  it("a ramp-only event captions the reconstruction and does not name Meta", () => {
    const rows = [
      {
        snapshot_at: "2026-08-26T12:00:00Z",
        email_subscribers: 674,
        raw_json: { method: "weighted_ramp_pre_snapshot" },
      },
      {
        snapshot_at: "2026-08-27T12:00:00Z",
        email_subscribers: 1265,
        raw_json: { method: "linear_ramp_pre_snapshot" },
      },
    ];
    const series = buildTrendRegistrationsSeries({
      dates: ["2026-08-26", "2026-08-27"],
      mailchimpSnapshots: rows,
      metaByDate: new Map([
        ["2026-08-26", null],
        ["2026-08-27", null],
      ]),
    });
    assert.equal(series.source, "meta");
    assert.equal(series.pillSource, null);
    assert.equal(series.hasPlottablePoints, false);
    assert.deepEqual(series.daily, [null, null]);
    assert.deepEqual(series.cumulative, [null, null]);
    assert.match(
      series.reconstructedCaption ?? "",
      /Mailchimp registrations 26 Aug – 27 Aug are reconstructed, not measured/,
    );
  });
});
