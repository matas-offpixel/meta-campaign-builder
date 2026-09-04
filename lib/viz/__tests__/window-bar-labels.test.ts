/**
 * WindowBar label clamp + moment-noun collapse.
 * Run: node --test lib/viz/__tests__/window-bar-labels.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  WINDOW_BAR_HEIGHT_PX,
  WINDOW_HANDLE_LABEL_LANE_PX,
  WINDOW_MOMENT_LABEL_WIDTH,
  WINDOW_MOMENT_LANE_PX,
  WINDOW_RAIL_LANE_PX,
  collapseOverlappingMomentLabels,
  handleLabelLeftPx,
} from "../window-bar.ts";

describe("WindowBar label layout", () => {
  it("height is 80 and contains the moment + rail + handle-label lanes", () => {
    assert.equal(WINDOW_BAR_HEIGHT_PX, 80);
    assert.equal(
      WINDOW_MOMENT_LANE_PX + WINDOW_RAIL_LANE_PX + WINDOW_HANDLE_LABEL_LANE_PX,
      WINDOW_BAR_HEIGHT_PX,
    );
  });

  it("two moments 30px apart collapse the later noun", () => {
    const hidden = collapseOverlappingMomentLabels([
      { id: "presale", x: 100, width: WINDOW_MOMENT_LABEL_WIDTH },
      { id: "gen-sale", x: 130, width: WINDOW_MOMENT_LABEL_WIDTH },
    ]);
    assert.equal(hidden.size, 1);
    assert.ok(hidden.has("gen-sale"));
    assert.equal(hidden.has("presale"), false);
  });

  it("end label at 100% keeps its box's right edge on the bar", () => {
    const barWidth = 640;
    const labelWidth = 168;
    const left = handleLabelLeftPx({
      handlePx: barWidth,
      labelWidth,
      barWidth,
      align: "end",
    });
    assert.ok(left + labelWidth <= barWidth);
    assert.equal(left + labelWidth, barWidth);
  });

  it("start label at 0 left-aligns and stays inside the bar", () => {
    const barWidth = 640;
    const labelWidth = 120;
    const left = handleLabelLeftPx({
      handlePx: 0,
      labelWidth,
      barWidth,
      align: "start",
    });
    assert.equal(left, 0);
    assert.ok(left + labelWidth <= barWidth);
  });

  it("handle and moment labels are nowrap in the component", () => {
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /whitespace-nowrap/);
    assert.match(source, /data-window-handle-label/);
    assert.doesNotMatch(source, /top-11/);
    assert.doesNotMatch(source, /h-16/);
  });
});
