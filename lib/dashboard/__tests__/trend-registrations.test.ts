import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cirqlinSignupsForDay } from "../../cirqlin/tracker-signups.ts";
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
    assert.equal(series.windowStart, "2026-08-24");
    for (let i = 0; i < dates.length; i++) {
      const expected = cirqlinSignupsForDay(dodCirqlinDays(), dates[i]!);
      if (dates[i]! < "2026-08-24") {
        assert.equal(series.daily[i], null);
        assert.equal(series.cumulative[i], null);
      } else {
        assert.equal(series.daily[i], expected);
      }
    }
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
});
