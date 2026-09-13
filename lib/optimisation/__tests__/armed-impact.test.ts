import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatBudgetImpactLine,
  formatMetricImpactLine,
  formatResultImpactLine,
  impactFromRows,
} from "../armed-impact.ts";
import type { DecisionRowView } from "../automation-ui.ts";

function row(partial: Partial<DecisionRowView>): DecisionRowView {
  return {
    decidedAt: "2026-09-12T12:00:00.000Z",
    metric: "cpr",
    metricValue: 1.2,
    resultCount: 8,
    metricWindow: "7d",
    ruleMatched: "",
    action: "maintain",
    budgetBeforePence: 4000,
    budgetAfterPence: 4000,
    applied: false,
    dryRun: true,
    reasonText: "",
    kind: "dry_run",
    channel: "meta",
    scope: "ad_set",
    adsetId: "adset-a",
    adsetName: "Prospecting",
    ...partial,
  };
}

function write(
  decidedAt: string,
  before: number,
  after: number,
  adsetId: string,
): DecisionRowView {
  return row({
    decidedAt,
    action: "scale_up",
    applied: true,
    dryRun: false,
    kind: "applied",
    budgetBeforePence: before,
    budgetAfterPence: after,
    adsetId,
  });
}

const since = new Date("2026-09-06T00:00:00.000Z");
const input = { metric: "cpr", metricWindow: "7d", seriesSince: since };

describe("impactFromRows — loop footprint, not a cause", () => {
  it("AZYR-shaped writes are +£62.12/day across 11 writes against the current daily budget", () => {
    const deltas = [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 1212];
    assert.equal(deltas.reduce((sum, n) => sum + n, 0), 6212);
    let a = 8000;
    let b = 6000;
    const writes = deltas.map((delta, i) => {
      const hour = 8 + (i % 3) * 4;
      const day = 10 + Math.floor(i / 3);
      const at = `2026-09-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
      if (i % 2 === 0) {
        const next = write(at, a, a + delta, "a");
        a += delta;
        return next;
      }
      const next = write(at, b, b + delta, "b");
      b += delta;
      return next;
    });

    const impact = impactFromRows(writes, input);
    assert.equal(impact.writeCount, 11);
    assert.equal(impact.netDailyBudgetPence, 6212);
    assert.equal(impact.currentDailyBudgetPence, a + b);

    const line = formatBudgetImpactLine(impact, "GBP");
    assert.equal(
      line,
      `+£62.12/day · 11 writes · daily budget now ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format((a + b) / 100)}`,
    );
    assert.match(line, /daily budget/);
    assert.doesNotMatch(line, /spend/i);
  });

  it("zero applied writes is no writes yet, not £0.00", () => {
    const impact = impactFromRows(
      [
        row({ applied: false, dryRun: true, metricValue: 1.1, resultCount: 4 }),
        row({
          decidedAt: "2026-09-13T00:00:00.000Z",
          applied: false,
          dryRun: true,
          metricValue: 0.9,
          resultCount: 5,
        }),
      ],
      input,
    );
    assert.equal(impact.writeCount, 0);
    assert.equal(impact.netDailyBudgetPence, null);
    assert.equal(formatBudgetImpactLine(impact, "GBP"), "no writes yet");
    assert.doesNotMatch(formatBudgetImpactLine(impact, "GBP"), /£0/);
  });

  it("a dry_run applied-looking row does not count as a write", () => {
    const impact = impactFromRows(
      [
        row({
          applied: true,
          dryRun: true,
          kind: "dry_run",
          budgetBeforePence: 4000,
          budgetAfterPence: 5200,
        }),
      ],
      input,
    );
    assert.equal(impact.writeCount, 0);
    assert.equal(formatBudgetImpactLine(impact, "GBP"), "no writes yet");
  });
});

describe("metric and results series — correlated, not multiplied", () => {
  it("cpr first → latest uses the rules' metric and window", () => {
    const impact = impactFromRows(
      [
        row({ decidedAt: "2026-09-10T00:00:00.000Z", metricValue: 0.22, resultCount: 6 }),
        row({ decidedAt: "2026-09-11T00:00:00.000Z", metricValue: 1.4, resultCount: 9 }),
        row({ decidedAt: "2026-09-13T00:00:00.000Z", metricValue: 3.03, resultCount: 11 }),
      ],
      input,
    );
    assert.deepEqual(impact.metricSeries, [0.22, 1.4, 3.03]);
    assert.equal(formatMetricImpactLine(impact), "cpr · 7d 0.22 → 3.03");
    assert.equal(formatResultImpactLine(impact), "results 6 → 11");
  });

  it("lpv_cost with no resultCount renders the metric and omits results, not zero", () => {
    const impact = impactFromRows(
      [
        row({
          metric: "lpv_cost",
          metricValue: 0.1,
          resultCount: null,
          decidedAt: "2026-09-10T00:00:00.000Z",
        }),
        row({
          metric: "lpv_cost",
          metricValue: 0.71,
          resultCount: null,
          decidedAt: "2026-09-13T00:00:00.000Z",
        }),
      ],
      { metric: "lpv_cost", metricWindow: "7d", seriesSince: since },
    );
    assert.equal(formatMetricImpactLine(impact), "lpv_cost · 7d 0.1 → 0.71");
    assert.equal(formatResultImpactLine(impact), null);
    assert.equal(impact.resultPresentCount, 0);
    assert.ok(!impact.resultSeries.some((value) => value === 0));
  });

  it("a missing resultCount on one tick is a gap, not a zero", () => {
    const impact = impactFromRows(
      [
        row({ decidedAt: "2026-09-10T00:00:00.000Z", metricValue: 1, resultCount: 4 }),
        row({ decidedAt: "2026-09-11T00:00:00.000Z", metricValue: 1.2, resultCount: null }),
        row({ decidedAt: "2026-09-12T00:00:00.000Z", metricValue: 0.9, resultCount: 7 }),
      ],
      input,
    );
    assert.deepEqual(impact.resultSeries, [4, null, 7]);
    assert.equal(impact.resultFirst, 4);
    assert.equal(impact.resultLatest, 7);
    assert.equal(formatResultImpactLine(impact), "results 4 → 7");
  });

  it("ticks older than the series window do not move first/latest", () => {
    const impact = impactFromRows(
      [
        row({ decidedAt: "2026-08-01T00:00:00.000Z", metricValue: 9.99, resultCount: 99 }),
        row({ decidedAt: "2026-09-10T00:00:00.000Z", metricValue: 0.5, resultCount: 3 }),
      ],
      input,
    );
    assert.deepEqual(impact.metricSeries, [0.5]);
    assert.equal(formatMetricImpactLine(impact), "cpr · 7d 0.5");
  });

  it("an old applied write still counts in the net after the series window", () => {
    const impact = impactFromRows(
      [write("2026-08-01T00:00:00.000Z", 4000, 5000, "a")],
      input,
    );
    assert.equal(impact.writeCount, 1);
    assert.equal(impact.netDailyBudgetPence, 1000);
    assert.match(formatBudgetImpactLine(impact, "GBP"), /\+£10\.00\/day · 1 write/);
  });
});

describe("labels stay honest", () => {
  it("no formatter claims the automation caused the metric to move, or names spend", () => {
    const impact = impactFromRows(
      [
        write("2026-09-10T00:00:00.000Z", 4000, 4600, "a"),
        row({ decidedAt: "2026-09-10T00:00:00.000Z", metricValue: 2, resultCount: 5 }),
        row({ decidedAt: "2026-09-13T00:00:00.000Z", metricValue: 1, resultCount: 8 }),
      ],
      input,
    );
    const text = [
      formatBudgetImpactLine(impact, "GBP"),
      formatMetricImpactLine(impact),
      formatResultImpactLine(impact),
    ].join(" ");
    assert.doesNotMatch(
      text,
      /improv|because|caused|attribut|spend|better|worse|automation/i,
    );
  });
});
