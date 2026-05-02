import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { rankByMetricQuartile } from "../patterns-quartile-rank.ts";

describe("rankByMetricQuartile", () => {
  test("ranks ascending metric values into quartiles", () => {
    const rows = [
      { id: "a", cpa: 40, spend: 100 },
      { id: "b", cpa: 10, spend: 100 },
      { id: "c", cpa: 30, spend: 100 },
      { id: "d", cpa: 20, spend: 100 },
    ];

    assert.deepEqual(
      rankByMetricQuartile(rows, (row) => row.cpa).map((row) => [
        row.item.id,
        row.quartile,
      ]),
      [
        ["b", 1],
        ["d", 2],
        ["c", 3],
        ["a", 4],
      ],
    );
  });

  test("pushes null metrics last and breaks ties by spend desc", () => {
    const rows = [
      { id: "low-spend", cpa: 10, spend: 100 },
      { id: "no-value", cpa: null, spend: 1000 },
      { id: "high-spend", cpa: 10, spend: 500 },
    ];

    assert.deepEqual(
      rankByMetricQuartile(
        rows,
        (row) => row.cpa,
        (row) => row.spend,
      ).map((row) => row.item.id),
      ["high-spend", "low-spend", "no-value"],
    );
  });
});
