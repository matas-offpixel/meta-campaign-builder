import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDescribeCells,
  cellForDraft,
  formatDescribeCellLine,
  formatDescribeUnreadable,
  formatEmptyDescribeTable,
  type DescribeDecisionPoint,
  type DescribeLaunchedRow,
} from "../describe-cells.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function row(partial: Partial<DescribeLaunchedRow> & { metaAdsetId: string }): DescribeLaunchedRow {
  return {
    clientId: "client-1",
    draftId: "draft-a",
    metaCampaignId: "camp-a",
    sourceType: "lookalike_group",
    objective: "registration",
    phaseAtLaunch: "presale",
    advantagePlusEffective: true,
    descriptorSource: "launch",
    initialDailyBudgetPence: 2000,
    launchedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

function point(metaAdsetId: string, value: number): DescribeDecisionPoint {
  return {
    metaAdsetId,
    metric: "cpr",
    metricValue: value,
    decidedAt: "2026-09-13T12:00:00.000Z",
  };
}

describe("buildDescribeCells", () => {
  it("4 ad sets in a cell render not enough data — n=4", () => {
    const rows = [1, 2, 3, 4].map((n) =>
      row({
        metaAdsetId: `ad-${n}`,
        draftId: `draft-${n}`,
        metaCampaignId: `camp-${n}`,
      }),
    );
    const cells = buildDescribeCells(rows, [], NOW);
    assert.equal(cells.length, 1);
    assert.equal(cells[0]?.reportable, false);
    assert.match(formatDescribeCellLine(cells[0]!), /not enough data — n=4/);
  });

  it("5 ad sets across 3 campaigns and £600 render the numbers", () => {
    const rows: DescribeLaunchedRow[] = [
      row({ metaAdsetId: "a1", draftId: "d1", metaCampaignId: "c1", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a2", draftId: "d1", metaCampaignId: "c1", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a3", draftId: "d2", metaCampaignId: "c2", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a4", draftId: "d2", metaCampaignId: "c2", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a5", draftId: "d3", metaCampaignId: "c3", initialDailyBudgetPence: 2000 }),
    ];
    const points = [
      point("a1", 0.61),
      point("a2", 1.4),
      point("a3", 0.8),
      point("a4", 1.0),
      point("a5", 0.9),
    ];
    const cells = buildDescribeCells(rows, points, NOW);
    assert.equal(cells[0]?.reportable, true);
    assert.equal(cells[0]?.n, 5);
    assert.equal(cells[0]?.campaignCount, 3);
    assert.ok((cells[0]?.budgetPence ?? 0) >= 60_000);
    const line = formatDescribeCellLine(cells[0]!);
    assert.match(line, /5 ad sets, 3 campaigns/);
    assert.match(line, /cpr 0\.61–1\.40/);
    assert.match(line, /metric n=5/);
    assert.match(line, /budget £1400 \(budget-days since launch\)/);
    assert.doesNotMatch(line, /not enough data/);
  });

  it("a cell with 5 ad sets and 1 metric contributor renders metric n=1", () => {
    const rows: DescribeLaunchedRow[] = [
      row({ metaAdsetId: "a1", draftId: "d1", metaCampaignId: "c1", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a2", draftId: "d1", metaCampaignId: "c1", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a3", draftId: "d2", metaCampaignId: "c2", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a4", draftId: "d2", metaCampaignId: "c2", initialDailyBudgetPence: 2000 }),
      row({ metaAdsetId: "a5", draftId: "d3", metaCampaignId: "c3", initialDailyBudgetPence: 2000 }),
    ];
    const cells = buildDescribeCells(rows, [point("a1", 0.61)], NOW);
    assert.equal(cells[0]?.metricN, 1);
    assert.match(formatDescribeCellLine(cells[0]!), /metric n=1/);
    assert.match(formatDescribeCellLine(cells[0]!), /cpr 0\.61–0\.61/);
  });

  it("orders cells by n descending, not by median", () => {
    const rows = [
      row({
        metaAdsetId: "cheap",
        draftId: "d1",
        metaCampaignId: "c1",
        sourceType: "lookalike_group",
      }),
      row({
        metaAdsetId: "volume-a",
        draftId: "d2",
        metaCampaignId: "c2",
        sourceType: "page_group",
      }),
      row({
        metaAdsetId: "volume-b",
        draftId: "d3",
        metaCampaignId: "c3",
        sourceType: "page_group",
      }),
    ];
    const cells = buildDescribeCells(
      rows,
      [point("cheap", 0.1), point("volume-a", 9), point("volume-b", 8)],
      NOW,
    );
    assert.equal(cells[0]?.key.sourceType, "page_group");
    assert.equal(cells[1]?.key.sourceType, "lookalike_group");
  });

  it("a cell with 3 launch rows and 4 backfill rows shows n_launch=3 · n_backfill=4", () => {
    const rows = [
      ...[1, 2, 3].map((n) =>
        row({
          metaAdsetId: `L${n}`,
          draftId: "d1",
          metaCampaignId: "c1",
          descriptorSource: "launch",
        }),
      ),
      ...[1, 2, 3, 4].map((n) =>
        row({
          metaAdsetId: `B${n}`,
          draftId: "d2",
          metaCampaignId: "c2",
          descriptorSource: "backfill_from_launch_summary",
        }),
      ),
    ];
    const line = formatDescribeCellLine(buildDescribeCells(rows, [], NOW)[0]!);
    assert.match(line, /n_launch=3 · n_backfill=4/);
  });

  it("the empty table is not enough data and nothing else", () => {
    assert.deepEqual(buildDescribeCells([], [], NOW), []);
    assert.equal(formatEmptyDescribeTable(), "not enough data — n=0");
  });

  it("two clients with the same shape are two cells, and neither borrows the other's campaigns", () => {
    const clientA = [1, 2, 3, 4, 5].map((n) =>
      row({
        clientId: "client-a",
        metaAdsetId: `a-${n}`,
        draftId: n <= 3 ? "da-1" : "da-2",
        metaCampaignId: n <= 3 ? "ca-1" : "ca-2",
      }),
    );
    const clientB = [1, 2, 3, 4, 5].map((n) =>
      row({
        clientId: "client-b",
        metaAdsetId: `b-${n}`,
        draftId: n <= 3 ? "db-1" : "db-2",
        metaCampaignId: n <= 3 ? "cb-1" : "cb-2",
      }),
    );
    const cells = buildDescribeCells([...clientA, ...clientB], [], NOW);
    assert.equal(cells.length, 2);
    assert.deepEqual(
      cells.map((cell) => cell.key.clientId).sort(),
      ["client-a", "client-b"],
    );
    for (const cell of cells) {
      assert.equal(cell.n, 5);
      assert.equal(cell.campaignCount, 2);
      assert.equal(cell.reportable, false);
    }
  });

  it("groups on advantage_plus_effective, not advantage_plus asked", () => {
    const rows = [
      row({ metaAdsetId: "on", advantagePlusEffective: true }),
      row({ metaAdsetId: "off", advantagePlusEffective: false }),
    ];
    const cells = buildDescribeCells(rows, [], NOW);
    assert.equal(cells.length, 2);
  });
});

describe("cellForDraft", () => {
  it("picks the cell with more of this draft's ad sets", () => {
    const rows = [
      row({ metaAdsetId: "x1", draftId: "d1", sourceType: "lookalike_group" }),
      row({ metaAdsetId: "x2", draftId: "d1", sourceType: "lookalike_group" }),
      row({ metaAdsetId: "y1", draftId: "d1", sourceType: "page_group" }),
    ];
    const cells = buildDescribeCells(rows, [], NOW);
    const picked = cellForDraft(cells, "d1");
    assert.equal(picked?.key.sourceType, "lookalike_group");
  });

  it("a 3/3 split takes the more recent launched_at, not sort position", () => {
    const rows = [
      row({
        metaAdsetId: "cheap-1",
        draftId: "split",
        sourceType: "lookalike_group",
        launchedAt: "2026-08-01T00:00:00.000Z",
        initialDailyBudgetPence: 100,
      }),
      row({
        metaAdsetId: "cheap-2",
        draftId: "split",
        sourceType: "lookalike_group",
        launchedAt: "2026-08-02T00:00:00.000Z",
        initialDailyBudgetPence: 100,
      }),
      row({
        metaAdsetId: "cheap-3",
        draftId: "split",
        sourceType: "lookalike_group",
        launchedAt: "2026-08-03T00:00:00.000Z",
        initialDailyBudgetPence: 100,
      }),
      row({
        metaAdsetId: "newer-1",
        draftId: "split",
        sourceType: "page_group",
        launchedAt: "2026-09-10T00:00:00.000Z",
        initialDailyBudgetPence: 100,
      }),
      row({
        metaAdsetId: "newer-2",
        draftId: "split",
        sourceType: "page_group",
        launchedAt: "2026-09-11T00:00:00.000Z",
        initialDailyBudgetPence: 100,
      }),
      row({
        metaAdsetId: "newer-3",
        draftId: "split",
        sourceType: "page_group",
        launchedAt: "2026-09-12T00:00:00.000Z",
        initialDailyBudgetPence: 100,
      }),
    ];
    const points = [
      point("cheap-1", 0.1),
      point("cheap-2", 0.1),
      point("cheap-3", 0.1),
      point("newer-1", 9),
      point("newer-2", 9),
      point("newer-3", 9),
    ];
    const cells = buildDescribeCells(rows, points, NOW);
    const lookalikeFirst = [...cells].sort((a, b) => {
      const aMed = a.metricMedian ?? Number.POSITIVE_INFINITY;
      const bMed = b.metricMedian ?? Number.POSITIVE_INFINITY;
      return aMed - bMed;
    });
    assert.equal(lookalikeFirst[0]?.key.sourceType, "lookalike_group");
    const picked = cellForDraft(cells, "split");
    assert.equal(picked?.key.sourceType, "page_group");
  });
});

describe("formatDescribeUnreadable", () => {
  it("names a failed read and does not say n=0", () => {
    assert.equal(formatDescribeUnreadable(), "cells unreadable");
    assert.doesNotMatch(formatDescribeUnreadable(), /n=0/);
  });
});

describe("describe-cells word ban", () => {
  it("describe sources do not contain the four banned words", () => {
    const diff = execSync(
      "git diff origin/main -- lib/optimisation/describe-cells.ts lib/db/describe-cells.ts lib/db/armed-campaigns.ts lib/optimisation/armed-read-model.ts app/api/optimisation/campaigns/route.ts components/optimisation/armed-campaign-row.tsx",
      { encoding: "utf8" },
    );
    assert.doesNotMatch(diff, /\b(recommend|suggest|best|should)\b/i);
  });
});
