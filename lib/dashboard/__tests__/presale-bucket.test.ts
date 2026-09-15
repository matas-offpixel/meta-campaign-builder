import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregatePresaleBucket,
  firstPresaleActivityDate,
  presaleRowHasActivity,
  type PresaleBucketInputRow,
} from "../presale-bucket.ts";

function row(
  date: string,
  overrides: Partial<PresaleBucketInputRow> = {},
): PresaleBucketInputRow {
  return { date, ...overrides };
}

/** Sixty zero-padded sync rows, then the real campaign. Mirrors the
 *  D.O.D shape: rollups reach back to 27 Jun, spend starts 26 Aug. */
function zeroPad(from: string, days: number): PresaleBucketInputRow[] {
  const out: PresaleBucketInputRow[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    out.push(
      row(d.toISOString().slice(0, 10), {
        ad_spend: 0,
        link_clicks: 0,
        meta_regs: 0,
        tickets_sold: 0,
      }),
    );
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("aggregatePresaleBucket", () => {
  it("sums registrations the bucket used to drop", () => {
    const bucket = aggregatePresaleBucket(
      [
        row("2026-08-26", { ad_spend: 100, meta_regs: 64, link_clicks: 10 }),
        row("2026-08-27", { ad_spend: 150, meta_regs: 160, link_clicks: 20 }),
        row("2026-09-09", { ad_spend: 999, meta_regs: 999 }),
      ],
      "2026-09-09T13:00:00+00:00",
    );
    assert.ok(bucket);
    assert.equal(bucket.meta_regs, 224);
    assert.equal(bucket.ad_spend, 250);
    assert.equal(bucket.link_clicks, 30);
    assert.equal(bucket.daysCount, 2);
  });

  it("keeps a column null only when it is null on every day", () => {
    const bucket = aggregatePresaleBucket(
      [
        row("2026-08-26", { ad_spend: 100, meta_regs: null }),
        row("2026-08-27", { ad_spend: 150, meta_regs: null }),
      ],
      "2026-09-09",
    );
    assert.ok(bucket);
    assert.equal(bucket.meta_regs, null);
    assert.equal(bucket.ad_spend, 250);
  });

  it("keeps a genuine zero distinct from a missing column", () => {
    const bucket = aggregatePresaleBucket(
      [row("2026-08-26", { meta_regs: 0, tickets_sold: null })],
      "2026-09-09",
    );
    assert.ok(bucket);
    assert.equal(bucket.meta_regs, 0);
    assert.equal(bucket.tickets_sold, null);
  });

  it("dates the bucket from the first non-zero day, not the first row", () => {
    const bucket = aggregatePresaleBucket(
      [
        ...zeroPad("2026-06-27", 60),
        row("2026-08-26", { ad_spend: 120.5, meta_regs: 64 }),
        row("2026-08-27", { ad_spend: 200, meta_regs: 160 }),
      ],
      "2026-09-09",
    );
    assert.ok(bucket);
    assert.equal(bucket.earliestDate, "2026-08-26");
    assert.equal(bucket.daysCount, 62);
  });

  it("falls back to the earliest row when no day has any activity", () => {
    const bucket = aggregatePresaleBucket(zeroPad("2026-06-27", 5), "2026-09-09");
    assert.ok(bucket);
    assert.equal(bucket.earliestDate, "2026-06-27");
  });

  it("slices a timestamptz cutoff so the general-sale day stays a daily row", () => {
    const bucket = aggregatePresaleBucket(
      [
        row("2026-09-08", { ad_spend: 10 }),
        row("2026-09-09", { ad_spend: 20 }),
      ],
      "2026-09-09T13:00:00+00:00",
    );
    assert.ok(bucket);
    assert.equal(bucket.cutoffDate, "2026-09-09");
    assert.equal(bucket.daysCount, 1);
    assert.equal(bucket.ad_spend, 10);
  });

  it("returns null without a cutoff or without rows before it", () => {
    assert.equal(aggregatePresaleBucket([row("2026-08-26")], null), null);
    assert.equal(
      aggregatePresaleBucket([row("2026-09-10")], "2026-09-09"),
      null,
    );
  });

  it("rounds money columns to 2dp", () => {
    const bucket = aggregatePresaleBucket(
      [
        row("2026-08-26", { ad_spend: 10.005, revenue: 0.1 }),
        row("2026-08-27", { ad_spend: 0.1, revenue: 0.2 }),
      ],
      "2026-09-09",
    );
    assert.ok(bucket);
    assert.equal(bucket.ad_spend, 10.11);
    assert.equal(bucket.revenue, 0.3);
  });
});

describe("presaleRowHasActivity", () => {
  it("treats an all-zero sync row as padding", () => {
    assert.equal(
      presaleRowHasActivity(
        row("2026-06-27", { ad_spend: 0, link_clicks: 0, meta_regs: 0 }),
      ),
      false,
    );
  });

  it("counts registrations on their own as activity", () => {
    assert.equal(
      presaleRowHasActivity(row("2026-08-26", { ad_spend: 0, meta_regs: 64 })),
      true,
    );
  });

  it("treats an all-null row as padding", () => {
    assert.equal(presaleRowHasActivity(row("2026-06-27")), false);
  });
});

describe("firstPresaleActivityDate", () => {
  it("ignores leading zero rows regardless of input order", () => {
    assert.equal(
      firstPresaleActivityDate([
        row("2026-08-27", { ad_spend: 5 }),
        row("2026-06-27", { ad_spend: 0 }),
        row("2026-08-26", { meta_regs: 64 }),
      ]),
      "2026-08-26",
    );
  });

  it("returns null when nothing happened", () => {
    assert.equal(firstPresaleActivityDate(zeroPad("2026-06-27", 3)), null);
  });
});
