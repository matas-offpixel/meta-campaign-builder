/**
 * Funnel visual-language invariants + /plan/[id] nit greps.
 * Run: node --test lib/viz/__tests__/funnel-visual.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { collectBadgeRows } from "../blockers.ts";
import {
  FUNNEL_BAR_SCALE,
  FUNNEL_DASHED_SLOT_PCT,
  benchmarkDeltaTone,
  formatDeltaPp,
  platformSharePercents,
  proportionalBarWidths,
} from "../funnel-scale.ts";
import { VIZ_DELTA_TOKEN, VIZ_DELTA_TONES, VIZ_PLATFORM_BAR } from "../tokens.ts";

const PARENT = "0902624";

describe("sqrt scale — monotonic and zero-safe", () => {
  it("states the scale", () => {
    assert.equal(FUNNEL_BAR_SCALE, "sqrt");
  });

  it("wider bars for larger values; equal values match", () => {
    const widths = proportionalBarWidths([10_000, 1_000, 100]);
    assert.ok(widths[0]!.widthPct > widths[1]!.widthPct);
    assert.ok(widths[1]!.widthPct > widths[2]!.widthPct);
    assert.equal(widths[0]!.widthPct, 100);
    const tied = proportionalBarWidths([400, 400]);
    assert.equal(tied[0]!.widthPct, tied[1]!.widthPct);
  });

  it("zero and empty do not produce NaN", () => {
    const zeros = proportionalBarWidths([0, 0]);
    assert.equal(zeros[0]!.widthPct, 0);
    assert.equal(zeros[1]!.widthPct, 0);
    assert.equal(zeros.every((row) => Number.isFinite(row.widthPct)), true);
    const mixed = proportionalBarWidths([0, 9]);
    assert.equal(mixed[0]!.widthPct, 0);
    assert.equal(mixed[1]!.widthPct, 100);
  });

  it("null is dashed and keeps a visible slot", () => {
    const widths = proportionalBarWidths([10_000, null, 100]);
    assert.equal(widths[1]!.dashed, true);
    assert.equal(widths[1]!.widthPct, FUNNEL_DASHED_SLOT_PCT);
    assert.equal(widths[0]!.dashed, false);
  });
});

describe("benchmark delta colouring", () => {
  it("paints above / below / neutral / none", () => {
    assert.equal(benchmarkDeltaTone(0.2, 0.15), "above");
    assert.equal(benchmarkDeltaTone(0.1, 0.15), "below");
    assert.equal(benchmarkDeltaTone(0.152, 0.15), "neutral");
    assert.equal(benchmarkDeltaTone(null, 0.15), "none");
    assert.equal(benchmarkDeltaTone(0.15, null), "none");
    assert.equal(formatDeltaPp(0.2, 0.15), "5.0pp above seed");
    assert.equal(formatDeltaPp(0.15, 0.15), "at seed");
  });

  it("every tone maps to one colour token", () => {
    for (const tone of VIZ_DELTA_TONES) {
      assert.match(VIZ_DELTA_TOKEN[tone], /^text-/);
    }
  });
});

describe("platform split + tokens", () => {
  it("shares sum to 100 when values exist", () => {
    const shares = platformSharePercents([
      { platform: "meta", value: 75, tracked: true },
      { platform: "tiktok", value: 25, tracked: true },
      { platform: "google", value: null, tracked: false },
    ]);
    assert.equal(shares.length, 2);
    assert.equal(shares.reduce((sum, row) => sum + row.pct, 0), 100);
  });

  it("every platform has a bar fill token", () => {
    assert.match(VIZ_PLATFORM_BAR.meta, /^bg-/);
    assert.match(VIZ_PLATFORM_BAR.tiktok, /^bg-/);
    assert.match(VIZ_PLATFORM_BAR.google, /^bg-/);
  });
});

describe("not-instrumented stays visible and dashed", () => {
  it("FunnelStageBar paints a dashed outline for the empty slot", () => {
    const source = readFileSync("components/viz/funnel-stage-bar.tsx", "utf8");
    assert.match(source, /border-dashed/);
    assert.match(source, /not instrumented/);
  });

  it("the card never hides a not-instrumented stage", () => {
    const card = readFileSync(
      "components/dashboard/event-report/event-funnel-card.tsx",
      "utf8",
    );
    assert.match(card, /proportionalBarWidths/);
    assert.match(card, /not instrumented/);
    assert.doesNotMatch(card, /stages\.filter/);
  });
});

describe("advisory single-render", () => {
  it("workspace folds notes into the badge and does not print them under the button", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(workspace, /collectBadgeRows/);
    assert.match(workspace, /kind: "advisory"|advisories/);
    assert.doesNotMatch(workspace, /split\.notes\.map/);
    assert.match(workspace, /GOOGLE_DATE_ONLY_NOTE/);
    assert.match(workspace, /issue\.href/);
  });

  it("badge treats advisories as neutral and blockers as amber", () => {
    const source = readFileSync("components/viz/blocker-badge.tsx", "utf8");
    assert.match(source, /row\.kind === "advisory"/);
    assert.match(source, /text-warning/);
    assert.match(source, /text-muted-foreground/);
  });

  it("collectBadgeRows dedupes the same message (blocker wins)", () => {
    const rows = collectBadgeRows(
      [{ id: "b", message: "Connect a pixel", href: "/x" }],
      [
        { id: "a", message: "Connect a pixel" },
        { id: "n", message: "skipped — tiktok daily budget is 0" },
      ],
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.kind, "blocker");
    assert.equal(rows[1]!.kind, "advisory");
  });

  it("falsify: parent still prints split.notes as standing text", () => {
    const parent = execFileSync("git", ["show", `${PARENT}:components/plan/plan-workspace.tsx`], {
      encoding: "utf8",
    });
    assert.match(parent, /split\.notes\.map/);
    assert.match(parent, /\{issue\.message\}/);
  });
});

describe("card grep-guards and kit reuse", () => {
  it("keeps recommend-only copy and FunnelCostCell labels reachable", () => {
    const card = readFileSync(
      "components/dashboard/event-report/event-funnel-card.tsx",
      "utf8",
    );
    assert.match(card, /Recommend-only — nothing is auto-applied/);
    assert.match(card, /funnelCostLabel/);
    assert.match(card, /tonality/);
    assert.match(card, /FunnelStageBar/);
    assert.match(card, /ProvenanceBadge/);
    assert.match(card, /MetricChip/);
    assert.doesNotMatch(card, /from ["']@\/lib\/dashboard\/event-funnel["'].*buildEventFunnelView/);
  });

  it("section anchors are icon + tip, never an orphan ⓘ", () => {
    const matrix = readFileSync("components/plan/asset-routing-matrix.tsx", "utf8");
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.match(matrix, /SectionAnchor/);
    assert.match(matrix, /kind="assets"/);
    assert.match(workspace, /kind="derive"/);
  });

  it("falsify: parent has no funnel scale helper", () => {
    try {
      execFileSync("git", ["show", `${PARENT}:lib/viz/funnel-scale.ts`], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      assert.fail("parent should not have lib/viz/funnel-scale.ts");
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.match(String(err), /exists on disk, but not in|does not exist|fatal/);
    }
  });
});
