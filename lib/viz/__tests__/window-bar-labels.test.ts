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
  dateToRatio,
  estimateHandleLabelWidth,
  handleLabelBoxesOverlap,
  handleLabelLeftPx,
  momentMarkAlign,
  resolveMomentGlyphCollision,
  windowRailView,
  windowSpanMs,
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

  it("marks more than 2% apart do not join, even if label boxes overlap", () => {
    const collision = resolveMomentGlyphCollision([
      { id: "now", noun: "now", ratio: 0.68, x: 400, width: 56 },
      { id: "gen-sale", noun: "gen sale passed Fri 4 Sep", ratio: 0.62, x: 360, width: 56 },
    ]);
    assert.equal(collision.joinedLabel.has("now"), false);
    assert.equal(collision.hideNounIds.has("gen-sale"), false);
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

  it("end === now && show > end → exactly one label, end · now", () => {
    const now = new Date("2026-09-06T23:00:00+01:00");
    const end = now;
    const start = new Date("2026-08-20T12:00:00+01:00");
    const show = new Date("2026-10-03T20:00:00+01:00");
    const view = windowRailView({
      start,
      end,
      now,
      moments: [
        { id: "now", label: "now", at: now },
        { id: "show", label: "show", at: show },
      ],
    });
    assert.equal(view.nowAtEnd, true);
    assert.equal(view.endNoun, "end · now");
    assert.deepEqual(view.moments, []);
    assert.deepEqual(view.labels, ["end · now"]);
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /windowRailView/);
    assert.match(source, /rail\.moments/);
    assert.match(source, /rail\.endNoun/);
  });

  it("three marks within 2% collapse to one label with three nouns", () => {
    const end = new Date("2026-04-20T23:00:00+01:00");
    const now = new Date("2026-04-20T12:00:00+01:00");
    const show = new Date("2026-04-20T12:00:00+01:00");
    const start = new Date("2026-03-01T09:00:00.000Z");
    const view = windowRailView({
      start,
      end,
      now,
      moments: [
        { id: "now", label: "now", at: now },
        { id: "show", label: "show", at: show },
      ],
    });
    assert.equal(view.endNoun, "end · now · show");
    assert.deepEqual(view.moments, []);
    assert.deepEqual(view.labels, ["end · now · show"]);
  });

  it("two marks within 2% collapse to two nouns", () => {
    const collision = resolveMomentGlyphCollision([
      { id: "now", noun: "now", ratio: 0.5, at: new Date("2026-04-20T12:00:00Z") },
      { id: "show", noun: "show", ratio: 0.51, at: new Date("2026-04-20T12:00:00Z") },
    ]);
    assert.equal(collision.joinedLabel.get("show") ?? collision.joinedLabel.get("now"), "now · show");
    assert.equal(collision.hideNounIds.size, 1);
  });

  it("a real moment that replaces a placeholder still joins at 2%", () => {
    const collision = resolveMomentGlyphCollision([
      { id: "now", noun: "now", ratio: 0.61 },
      { id: "presale", noun: "presale", ratio: 0.615 },
    ]);
    assert.equal(
      collision.joinedLabel.get("now") ?? collision.joinedLabel.get("presale"),
      "now · presale",
    );
    assert.equal(collision.hideNounIds.size, 1);
  });

  it("start and end within 2% share one rail-order label", () => {
    const now = new Date("2026-03-18T12:00:00.000Z");
    const start = new Date("2026-07-31T12:00:00.000Z");
    const end = new Date("2026-08-01T12:00:00.000Z");
    const view = windowRailView({ start, end, now, moments: [], min: now });
    assert.equal(view.hideStartLabel, true);
    assert.equal(view.endNoun, "start · end");
    assert.equal(view.startNoun, "start · end");
    assert.deepEqual(view.labels, ["start · end"]);
  });

  it("A13 start/end labels on the right of a future window overlap and collapse", () => {
    const now = new Date("2026-03-18T12:00:00.000Z");
    const start = new Date("2026-07-10T00:00:00");
    const end = new Date("2026-08-01T23:00:00");
    const view = windowRailView({
      start,
      end,
      now,
      moments: [{ id: "now", label: "now", at: now }],
      min: now,
    });
    const { from, to } = windowSpanMs(start, end, now);
    const startRatio = dateToRatio(start, from, to);
    const endRatio = dateToRatio(end, from, to);
    assert.ok(Math.abs(startRatio - endRatio) > WINDOW_GLYPH_COLLISION_PCT);
    assert.equal(view.hideStartLabel, false);
    const barWidth = 640;
    const startText = formatVizMoment(start);
    const endText = formatVizMoment(end);
    const startWidth = estimateHandleLabelWidth(startText);
    const endWidth = estimateHandleLabelWidth(endText);
    const startLeft = handleLabelLeftPx({
      handlePx: startRatio * barWidth,
      labelWidth: startWidth,
      barWidth,
      align: "start",
    });
    const visualEndLeft = Math.max(0, barWidth - endWidth);
    assert.equal(
      handleLabelBoxesOverlap({
        startLeft,
        startWidth,
        endLeft: visualEndLeft,
        endWidth,
      }),
      true,
    );
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /hideStartLabel/);
    assert.match(source, /handleLabelBoxesOverlap/);
  });

  it("handle and moment labels are nowrap in the component", () => {
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /whitespace-nowrap/);
    assert.match(source, /data-window-handle-label/);
    assert.doesNotMatch(source, /top-11/);
    assert.doesNotMatch(source, /h-16/);
  });
});
