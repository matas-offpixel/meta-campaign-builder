import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getSeriesDisplayLabel,
  SERIES_DISPLAY_LABELS,
} from "../series-display-labels.ts";

describe("getSeriesDisplayLabel", () => {
  it("returns null for missing / empty code", () => {
    assert.equal(getSeriesDisplayLabel(null), null);
    assert.equal(getSeriesDisplayLabel(undefined), null);
    assert.equal(getSeriesDisplayLabel(""), null);
  });

  it("returns mapped label when present", () => {
    assert.equal(
      getSeriesDisplayLabel("4TF-TITLERUNIN-LONDON"),
      "Arsenal Title Run In",
    );
    assert.equal(SERIES_DISPLAY_LABELS["LEEDS26-FACUP"], "Leeds FA Cup Semi Final");
  });

  it("returns null when code is not in the map", () => {
    assert.equal(getSeriesDisplayLabel("WC26-BRIGHTON"), null);
  });
});
