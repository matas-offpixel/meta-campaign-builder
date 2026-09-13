import { execSync } from "node:child_process";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDescribeCells,
  cellForDraft,
  formatDescribeCellLine,
  formatEmptyDescribeTable,
  type DescribeDecisionPoint,
  type DescribeLaunchedRow,
} from "../describe-cells.ts";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function row(partial: Partial<DescribeLaunchedRow> & { metaAdsetId: string }): DescribeLaunchedRow {
  return {
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
    assert.doesNotMatch(line, /not enough data/);
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
