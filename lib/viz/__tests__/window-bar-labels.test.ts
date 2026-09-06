/**
 * WindowBar label clamp + moment-noun collapse.
 * Run: node --test lib/viz/__tests__/window-bar-labels.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { formatVizMoment } from "../format-moment.ts";
import {
  WINDOW_BAR_HEIGHT_PX,
  WINDOW_HANDLE_LABEL_LANE_PX,
  WINDOW_MOMENT_LABEL_WIDTH,
  WINDOW_MOMENT_LANE_PX,
  WINDOW_RAIL_LANE_PX,
  collapseOverlappingMomentLabels,
  estimateHandleLabelWidth,
  handleLabelLeftPx,
  momentMarkAlign,
  resolveMomentGlyphCollision,
  WINDOW_GLYPH_COLLISION_PCT,
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

  it("now keeps the joined label at its position", () => {
    assert.equal(WINDOW_GLYPH_COLLISION_PCT, 0.02);
    const collision = resolveMomentGlyphCollision([
      { id: "now", noun: "now", ratio: 0.61 },
      { id: "gen-sale", noun: "gen sale passed Fri 4 Sep", ratio: 0.62 },
    ]);
    assert.ok(collision.hideGlyphIds.has("gen-sale"));
    assert.ok(collision.hideNounIds.has("gen-sale"));
    assert.equal(collision.hideGlyphIds.has("now"), false);
    assert.equal(
      collision.joinedLabel.get("now"),
      "now · gen sale passed Fri 4 Sep",
    );
  });

  it("boxes that intersect join even when they sit more than 2% apart", () => {
    const collision = resolveMomentGlyphCollision([
      { id: "now", noun: "now", ratio: 0.68, x: 400, width: 56 },
      { id: "gen-sale", noun: "gen sale passed Fri 4 Sep", ratio: 0.62, x: 360, width: 56 },
    ]);
    assert.equal(
      collision.joinedLabel.get("now"),
      "now · gen sale passed Fri 4 Sep",
    );
    assert.ok(collision.hideNounIds.has("gen-sale"));
  });

  it("placeholders never join now; a passed neighbour does", () => {
    const collision = resolveMomentGlyphCollision([
      { id: "now", noun: "now", ratio: 0.61 },
      { id: "placeholder-presale", noun: "presale", ratio: 0.615, placeholder: true },
      { id: "gen-sale", noun: "gen sale passed Fri 4 Sep", ratio: 0.62 },
    ]);
    assert.equal(collision.joinedLabel.get("now"), "now · gen sale passed Fri 4 Sep");
    assert.ok(collision.hideNounIds.has("gen-sale"));
    assert.equal(collision.joinedLabel.has("placeholder-presale"), false);
    assert.equal(collision.hideNounIds.has("now"), false);
  });

  it("end at 100% right-aligns and keeps the full date inside the rail", () => {
    const end = new Date("2026-09-06T23:00:00+01:00");
    const text = formatVizMoment(end);
    assert.equal(text, "Sun 6 Sep · 23:00");
    assert.equal(momentMarkAlign(1), "end");
    const barWidth = 640;
    const labelWidth = estimateHandleLabelWidth(text);
    const left = handleLabelLeftPx({
      handlePx: barWidth,
      labelWidth,
      barWidth,
      align: "end",
    });
    assert.equal(left + labelWidth, barWidth);
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /momentMarkAlign/);
    assert.match(source, /data-mark-align/);
    assert.match(source, /w-full overflow-visible/);
    assert.match(source, /translateX\(-100%\)/);
    assert.match(source, /paddingRight/);
  });

  it("handle and moment labels are nowrap in the component", () => {
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /whitespace-nowrap/);
    assert.match(source, /data-window-handle-label/);
    assert.doesNotMatch(source, /top-11/);
    assert.doesNotMatch(source, /h-16/);
  });
});
