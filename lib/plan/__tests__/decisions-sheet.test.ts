/**
 * PR 6 — the decisions sheet model.
 *
 * Fixtures cover every action plus the three honest-empty states.
 * Grouping, older disclosure, preset drift and the zero-row StatusLine
 * live here so the React sheet has nothing to decide.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DecisionRowView } from "../../optimisation/automation-ui.ts";
import {
  bandDashedFor,
  compactRelative,
  emptyDecisionsStatus,
  glyphActionFor,
  groupDecisions,
  metricChipText,
  presetDriftLabel,
  provenanceMarkForDecision,
  whyForDecision,
} from "../decisions-sheet.ts";

const NOW = new Date("2026-09-04T18:00:00.000Z");

function row(partial: Partial<DecisionRowView> & Pick<DecisionRowView, "action" | "decidedAt">): DecisionRowView {
  return {
    metric: "",
    metricValue: null,
    resultCount: null,
    metricWindow: "24h",
    ruleMatched: "",
    budgetBeforePence: null,
    budgetAfterPence: null,
    applied: false,
    dryRun: true,
    reasonText: "",
    kind: "dry_run",
    channel: "meta",
    scope: "ad_set",
    ...partial,
  };
}

describe("glyphs and why — every action + honest empties", () => {
  it("scale_up ▲ · +20% · 38 conv ≥ 5", () => {
    const decision = row({
      action: "scale_up",
      decidedAt: "2026-09-04T16:00:00.000Z",
      metric: "cpr",
      metricValue: 1.72,
      resultCount: 38,
      metricWindow: "7d",
      budgetBeforePence: 5000,
      budgetAfterPence: 6000,
      reasonText: "cpr=1.72 matched \"below target\" → scale_up +20%.",
    });
    assert.equal(glyphActionFor(decision.action), "scale_up");
    assert.equal(whyForDecision(decision, NOW), "+20% · 38 conv ≥ 5");
    assert.equal(metricChipText(decision), "cpr 1.72 · 38 / 7d");
    assert.equal(bandDashedFor(decision.action), false);
    assert.equal(provenanceMarkForDecision(decision), "plat");
  });

  it("scale_down ▼ · −15% · above ceiling", () => {
    const decision = row({
      action: "scale_down",
      decidedAt: "2026-09-04T16:00:00.000Z",
      metric: "cpc",
      metricValue: 0.44,
      resultCount: 88,
      metricWindow: "24h",
      budgetBeforePence: 10000,
      budgetAfterPence: 8500,
      reasonText: "cpc=0.44 matched \"above\" but hit the hard budget ceiling — ceilingBehaviour=stop.",
    });
    assert.equal(glyphActionFor(decision.action), "scale_down");
    assert.equal(whyForDecision(decision, NOW), "-15% · above ceiling");
    assert.equal(metricChipText(decision), "cpc 0.44 · 88 / 24h");
  });

  it("maintain — · in band", () => {
    const decision = row({
      action: "maintain",
      decidedAt: "2026-09-04T16:00:00.000Z",
      metric: "cpc",
      metricValue: 0.26,
      resultCount: 610,
      metricWindow: "24h",
      reasonText: "cpc=0.26 matched \"in band\" → maintain.",
    });
    assert.equal(glyphActionFor(decision.action), "maintain");
    assert.equal(whyForDecision(decision, NOW), "in band");
    assert.equal(metricChipText(decision), "cpc 0.26 · 610 / 24h");
  });

  it("pause ⏸", () => {
    const decision = row({
      action: "pause",
      decidedAt: "2026-09-04T16:00:00.000Z",
      metric: "cpr",
      metricValue: 4.8,
      resultCount: 12,
      metricWindow: "7d",
      reasonText: "cpr=4.8 matched \"far above\" → pause.",
    });
    assert.equal(glyphActionFor(decision.action), "pause");
    assert.equal(whyForDecision(decision, NOW), "pause");
  });

  it("skip_dormant · dormant", () => {
    const decision = row({
      action: "skip_dormant",
      decidedAt: "2026-09-04T16:00:00.000Z",
      reasonText: "No meta spend in the 24h window — dormant.",
    });
    assert.equal(glyphActionFor(decision.action), "skip_dormant");
    assert.equal(whyForDecision(decision, NOW), "dormant");
    assert.equal(metricChipText(decision), "—");
    assert.equal(provenanceMarkForDecision(decision), "┄");
  });

  it("metric_unavailable ◌ · no reads yet · dashed band", () => {
    const decision = row({
      action: "metric_unavailable",
      decidedAt: "2026-09-04T16:00:00.000Z",
      metric: "lpv_cost",
      metricWindow: "24h",
      reasonText: "metric_unavailable — no insights row.",
    });
    assert.equal(glyphActionFor(decision.action), "metric_unavailable");
    assert.equal(whyForDecision(decision, NOW), "no reads yet");
    assert.equal(metricChipText(decision), "lpv_cost · — / 24h");
    assert.equal(bandDashedFor(decision.action), true);
    assert.equal(provenanceMarkForDecision(decision), "┄");
  });

  it("insufficient_conversions · n/5 conv · insufficient", () => {
    const decision = row({
      action: "insufficient_conversions",
      decidedAt: "2026-09-04T16:00:00.000Z",
      metric: "cpr",
      resultCount: 3,
      metricWindow: "7d",
      reasonText: "3/5 conversions in the 7d window — insufficient evidence, no budget change.",
    });
    assert.equal(glyphActionFor(decision.action), "insufficient_conversions");
    assert.equal(whyForDecision(decision, NOW), "3/5 conv · insufficient");
    assert.equal(metricChipText(decision), "—");
    assert.equal(bandDashedFor(decision.action), false);
    assert.equal(provenanceMarkForDecision(decision), "┄");
  });

  it("insufficient_conversions reads n from reasonText when resultCount is missing", () => {
    const decision = row({
      action: "insufficient_conversions",
      decidedAt: "2026-09-04T16:00:00.000Z",
      reasonText: "4/5 conversions in the 7d window — insufficient evidence.",
    });
    assert.equal(whyForDecision(decision, NOW), "4/5 conv · insufficient");
  });

  it("skip_recent_touch (evaluate's skipped_cooldown) · cooldown · until", () => {
    const decision = row({
      action: "skip_recent_touch",
      decidedAt: "2026-09-04T16:00:00.000Z",
      reasonText: "Touched 2.0h ago — inside the 6h cooldown window.",
    });
    assert.equal(glyphActionFor(decision.action), "skip_recent_touch");
    assert.equal(whyForDecision(decision, NOW), "cooldown · until in 2h");
    assert.equal(glyphActionFor("skipped_cooldown"), "skip_recent_touch");
    assert.equal(
      whyForDecision(
        row({
          action: "skipped_cooldown",
          decidedAt: "2026-09-04T16:00:00.000Z",
          reasonText: "Touched 2.0h ago — inside the 6h cooldown window.",
        }),
        NOW,
      ),
      "cooldown · until in 2h",
    );
  });
});

describe("grouping and older disclosure", () => {
  it("newest first, grouped by London day; older is past 7d", () => {
    const rows = [
      row({ action: "maintain", decidedAt: "2026-09-04T12:00:00.000Z" }),
      row({ action: "scale_up", decidedAt: "2026-09-03T12:00:00.000Z" }),
      row({ action: "scale_down", decidedAt: "2026-08-20T12:00:00.000Z" }),
      row({ action: "pause", decidedAt: "2026-09-04T17:00:00.000Z" }),
    ];
    const grouped = groupDecisions(rows, NOW);
    assert.equal(grouped.recent.length, 2);
    assert.equal(grouped.recent[0]!.dayKey, "2026-09-04");
    assert.equal(grouped.recent[0]!.rows[0]!.action, "pause");
    assert.equal(grouped.recent[0]!.rows[1]!.action, "maintain");
    assert.equal(grouped.recent[1]!.dayKey, "2026-09-03");
    assert.equal(grouped.older.length, 1);
    assert.equal(grouped.older[0]!.rows[0]!.action, "scale_down");
  });
});

describe("preset version drift", () => {
  it("shows v3 → v4 when the live preset is newer", () => {
    assert.equal(presetDriftLabel(3, 4), "v3 → v4");
    assert.equal(presetDriftLabel(3, 3), null);
    assert.equal(presetDriftLabel(4, 3), null);
    assert.equal(presetDriftLabel(0, 1), "seed → v1");
    assert.equal(presetDriftLabel(null, 4), null);
  });
});

describe("zero-decisions StatusLine", () => {
  it("has no next-tick when there is no last tick", () => {
    assert.equal(emptyDecisionsStatus(null, NOW), "◌ no decisions yet");
  });

  it("uses the 4h cron cadence from the last tick", () => {
    assert.equal(
      emptyDecisionsStatus("2026-09-04T16:00:00.000Z", NOW),
      "◌ no decisions yet · next tick in 2h",
    );
  });

  it("says soon when the next tick is already due", () => {
    assert.equal(
      emptyDecisionsStatus("2026-09-04T10:00:00.000Z", NOW),
      "◌ no decisions yet · next tick soon",
    );
  });
});

describe("compact relative", () => {
  it("past and future forms", () => {
    assert.equal(compactRelative("2026-09-04T16:00:00.000Z", NOW), "2h");
    assert.equal(compactRelative("2026-09-03T18:00:00.000Z", NOW), "1d");
    assert.equal(compactRelative("2026-09-04T20:00:00.000Z", NOW, true), "in 2h");
  });
});
