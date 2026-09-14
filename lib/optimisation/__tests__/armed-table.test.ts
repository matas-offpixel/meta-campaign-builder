import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createDefaultBudgetGuardrails } from "../../campaign-defaults.ts";
import { createDefaultDraft } from "../../campaign-defaults.ts";
import type { ArmedImpact } from "../armed-impact.ts";
import {
  controlsFromStrategy,
  type ArmedCampaignControls,
  type ArmedCampaignRow,
  type ArmedLastDecision,
} from "../armed-read-model.ts";
import {
  bindingCapPence,
  budgetBaseFromDraft,
  compareArmedRows,
  DEFAULT_ARMED_SORT,
  emptyBudgetBase,
  formatActingCell,
  formatDailyBudgetCell,
  formatMetricCell,
  formatNetChangeCell,
  formatPercentCell,
  isEndedArmedRow,
  nextArmedSort,
  parseArmedTableSort,
  partitionArmedRows,
  readArmedTableSort,
  sortArmedRows,
  vsCap,
  vsTarget,
} from "../armed-table.ts";

function impact(partial: Partial<ArmedImpact> = {}): ArmedImpact {
  return {
    writeCount: 0,
    netDailyBudgetPence: null,
    currentDailyBudgetPence: null,
    metric: "cpr",
    metricWindow: "24h",
    metricFirst: null,
    metricLatest: null,
    metricSeries: [],
    resultFirst: null,
    resultLatest: null,
    resultPresentCount: 0,
    resultSeries: [],
    adSetCount: 0,
    writeByAdSetPence: {},
    writeCampaignPence: null,
    ...partial,
  };
}

function controls(partial: Partial<ArmedCampaignControls> = {}): ArmedCampaignControls {
  const guardrails = createDefaultBudgetGuardrails();
  return {
    objective: "registration",
    currency: "GBP",
    campaignTargetValue: null,
    accountBenchmarkValue: null,
    useOverride: false,
    primaryMetric: "cpr",
    primaryMetricWindow: "24h",
    guardrails,
    baseCampaignBudget: guardrails.baseCampaignBudget,
    hardBudgetCeiling: 0,
    ...partial,
    guardrails: partial.guardrails ?? guardrails,
  };
}

function decision(partial: Partial<ArmedLastDecision> = {}): ArmedLastDecision {
  return {
    at: "2026-09-14T17:00:00.000Z",
    action: "skip_not_delivering",
    reasonText: "",
    dryRun: true,
    applied: false,
    ...partial,
  };
}

function row(partial: Partial<ArmedCampaignRow> = {}): ArmedCampaignRow {
  return {
    id: partial.id ?? "id-1",
    name: partial.name ?? "Campaign",
    status: "published",
    ownerUserId: "u1",
    ownerLabel: "you",
    canWrite: true,
    arm: "shadow",
    eventId: null,
    eventLabel: null,
    eventWarning: null,
    lastDecision: null,
    lastWrite: null,
    controls: controls(),
    budgetBase: emptyBudgetBase(),
    nextTickAt: "2026-09-14T20:00:00.000Z",
    impact: impact(),
    describeLine: null,
    wiring: null,
    canStampEvent: false,
    ...partial,
  };
}

const now = new Date("2026-09-14T20:00:00.000Z");

describe("vs target — metric against the rule target", () => {
  it("uses the operator target when set", () => {
    const cell = vsTarget(
      row({
        impact: impact({ metric: "cpr", metricLatest: 1.06 }),
        controls: controls({
          campaignTargetValue: 0.91,
          accountBenchmarkValue: 2,
          useOverride: true,
        }),
      }),
    );
    assert.equal(cell.kind, "present");
    if (cell.kind !== "present") return;
    assert.equal(cell.percent, 116);
    assert.equal(cell.detail, "cpr 1.06 / target 0.91 · 116%");
  });

  it("falls back to the account benchmark when no operator target is set", () => {
    const cell = vsTarget(
      row({
        impact: impact({ metric: "cpr", metricLatest: 1.06 }),
        controls: controls({ campaignTargetValue: null, accountBenchmarkValue: 0.91 }),
      }),
    );
    assert.equal(cell.kind, "present");
    if (cell.kind !== "present") return;
    assert.equal(cell.target, 0.91);
    assert.equal(cell.percent, 116);
  });

  it("absent metric is no tick yet, not zero", () => {
    const cell = vsTarget(
      row({
        impact: impact({ metric: "cpr", metricLatest: null }),
        controls: controls({ campaignTargetValue: 0.91 }),
      }),
    );
    assert.deepEqual(cell, { kind: "absent", reason: "no tick yet" });
    assert.equal(formatPercentCell(cell).text, "—");
    assert.equal(formatPercentCell(cell).title, "no tick yet");
  });

  it("absent target is no target set, not zero", () => {
    const cell = vsTarget(
      row({
        impact: impact({ metric: "cpr", metricLatest: 1.06 }),
        controls: controls({ campaignTargetValue: null, accountBenchmarkValue: null }),
      }),
    );
    assert.deepEqual(cell, { kind: "absent", reason: "no target set" });
    assert.equal(formatPercentCell(cell).title, "no target set");
  });

  it("useOverride false ignores a stale campaignTargetValue", () => {
    const cell = vsTarget(
      row({
        impact: impact({ metric: "cpr", metricLatest: 1.06 }),
        controls: controls({
          campaignTargetValue: 0.5,
          accountBenchmarkValue: 0.91,
          useOverride: false,
        }),
      }),
    );
    assert.equal(cell.kind, "present");
    if (cell.kind !== "present") return;
    assert.equal(cell.target, 0.91);
    assert.equal(cell.percent, 116);
  });

  it("roas at 1.2× target is the right way, not pricey", () => {
    const roas = vsTarget(
      row({
        id: "roas",
        impact: impact({ metric: "roas", metricLatest: 3.6 }),
        controls: controls({
          campaignTargetValue: 3,
          useOverride: true,
          primaryMetric: "roas",
        }),
      }),
    );
    const cpr = vsTarget(
      row({
        id: "cpr",
        impact: impact({ metric: "cpr", metricLatest: 1.2 }),
        controls: controls({ campaignTargetValue: 1, useOverride: true }),
      }),
    );
    assert.equal(roas.kind, "present");
    assert.equal(cpr.kind, "present");
    if (roas.kind !== "present" || cpr.kind !== "present") return;
    assert.equal(roas.percent, 83);
    assert.equal(cpr.percent, 120);
    const sorted = sortArmedRows(
      [
        row({
          id: "roas",
          impact: impact({ metric: "roas", metricLatest: 3.6 }),
          controls: controls({
            campaignTargetValue: 3,
            useOverride: true,
            primaryMetric: "roas",
          }),
        }),
        row({
          id: "cpr",
          impact: impact({ metric: "cpr", metricLatest: 1.2 }),
          controls: controls({ campaignTargetValue: 1, useOverride: true }),
        }),
      ],
      { key: "vsTarget", dir: "desc" },
    );
    assert.deepEqual(
      sorted.map((r) => r.id),
      ["cpr", "roas"],
    );
  });
});

describe("vs cap — daily budget against the binding cap", () => {
  it("AZYR-shaped daily against a £500 hard ceiling is 62%", () => {
    const cell = vsCap(
      row({
        impact: impact({ currentDailyBudgetPence: 31167, adSetCount: 2 }),
        controls: controls({
          hardBudgetCeiling: 500,
          guardrails: {
            ...createDefaultBudgetGuardrails(),
            hardBudgetCeiling: 500,
          },
        }),
      }),
    );
    assert.equal(cell.kind, "present");
    if (cell.kind !== "present") return;
    assert.equal(cell.percent, 62);
    assert.match(cell.detail, /£311\.67 \/ £500\.00 · 62%/);
  });

  it("a tighter typed campaign ceiling binds when scope is campaign", () => {
    const cap = bindingCapPence(
      controls({
        hardBudgetCeiling: 500,
        guardrails: {
          ...createDefaultBudgetGuardrails(),
          hardBudgetCeiling: 500,
          budgetCeilingScope: "campaign",
          campaignDailyCeilingSource: "typed",
          campaignDailyCeiling: 200,
        },
      }),
      2,
    );
    assert.ok(!("absent" in cap));
    if ("absent" in cap) return;
    assert.equal(cap.pence, 20000);
  });

  it("maxSingle × ad-set count binds when that is the tighter figure", () => {
    const cap = bindingCapPence(
      controls({
        hardBudgetCeiling: 500,
        guardrails: {
          ...createDefaultBudgetGuardrails(),
          hardBudgetCeiling: 500,
          maxSingleAdSetBudget: 80,
          budgetCeilingScope: "ad_set",
        },
      }),
      2,
    );
    assert.ok(!("absent" in cap));
    if ("absent" in cap) return;
    assert.equal(cap.pence, 16000);
  });

  it("no configured cap is no cap, not 0%", () => {
    const cell = vsCap(
      row({
        impact: impact({ currentDailyBudgetPence: 31167 }),
        controls: controls({ hardBudgetCeiling: 0 }),
      }),
    );
    assert.deepEqual(cell, { kind: "absent", reason: "no cap" });
    assert.equal(formatPercentCell(cell).text, "—");
    assert.equal(formatPercentCell(cell).title, "no cap");
  });

  it("no daily budget is no tick yet", () => {
    const cell = vsCap(
      row({
        impact: impact({ currentDailyBudgetPence: null }),
        controls: controls({ hardBudgetCeiling: 500 }),
      }),
    );
    assert.deepEqual(cell, { kind: "absent", reason: "no tick yet" });
  });

  it("a Shadow draft of three £20 ad sets against a £100 ceiling is 60%", () => {
    const cell = vsCap(
      row({
        arm: "shadow",
        budgetBase: budgetBaseFromDraft({
          budgetLevel: "ad_set",
          adSets: [
            { id: "a", enabled: true, budgetPerDay: 20 },
            { id: "b", enabled: true, budgetPerDay: 20 },
            { id: "c", enabled: true, budgetPerDay: 20 },
          ],
        }),
        controls: controls({
          hardBudgetCeiling: 100,
          guardrails: {
            ...createDefaultBudgetGuardrails(),
            hardBudgetCeiling: 100,
          },
        }),
      }),
    );
    assert.equal(cell.kind, "present");
    if (cell.kind !== "present") return;
    assert.equal(cell.percent, 60);
    assert.match(cell.detail, /£60\.00 \/ £100\.00 · 60%/);
  });

  it("campaign-scope with no typed ceiling is absent, not the hard ceiling", () => {
    const cell = vsCap(
      row({
        budgetBase: budgetBaseFromDraft({
          budgetLevel: "campaign",
          budgetAmount: 60,
        }),
        controls: controls({
          hardBudgetCeiling: 100,
          guardrails: {
            ...createDefaultBudgetGuardrails(),
            hardBudgetCeiling: 100,
            budgetCeilingScope: "campaign",
            campaignDailyCeilingSource: "derived",
          },
        }),
      }),
    );
    assert.deepEqual(cell, { kind: "absent", reason: "derived cap not on this view" });
    assert.equal(formatPercentCell(cell).text, "—");
    assert.equal(formatPercentCell(cell).title, "derived cap not on this view");
  });
});

describe("ended vs active", () => {
  it("skip_event_passed and skip_campaign_ended are ended", () => {
    assert.equal(
      isEndedArmedRow(row({ lastDecision: decision({ action: "skip_event_passed" }) })),
      true,
    );
    assert.equal(
      isEndedArmedRow(row({ lastDecision: decision({ action: "skip_campaign_ended" }) })),
      true,
    );
  });

  it("skip_not_delivering and skip_facts_unreadable stay active", () => {
    assert.equal(
      isEndedArmedRow(row({ lastDecision: decision({ action: "skip_not_delivering" }) })),
      false,
    );
    assert.equal(
      isEndedArmedRow(row({ lastDecision: decision({ action: "skip_facts_unreadable" }) })),
      false,
    );
  });

  it("partition counts match the same rows", () => {
    const rows = [
      row({ id: "a", lastDecision: decision({ action: "skip_not_delivering" }) }),
      row({ id: "b", lastDecision: decision({ action: "skip_event_passed" }) }),
      row({ id: "c", lastDecision: decision({ action: "skip_campaign_ended" }) }),
      row({ id: "d", lastDecision: decision({ action: "skip_facts_unreadable" }) }),
    ];
    const { active, ended } = partitionArmedRows(rows);
    assert.deepEqual(
      active.map((r) => r.id),
      ["a", "d"],
    );
    assert.deepEqual(
      ended.map((r) => r.id),
      ["b", "c"],
    );
  });
});

describe("acting cell", () => {
  it("names the action and a compact age", () => {
    const cell = formatActingCell(
      decision({ action: "skip_not_delivering", at: "2026-09-14T17:00:00.000Z" }),
      now,
    );
    assert.equal(cell.text, "skip_not_delivering · 3h");
  });

  it("no decision is an absent cell", () => {
    assert.deepEqual(formatActingCell(null), { text: "—", title: "no tick yet" });
  });
});

describe("money and metric cells stay absent when empty", () => {
  it("daily budget, net, and metric do not render 0", () => {
    const empty = row();
    assert.deepEqual(formatDailyBudgetCell(empty), { text: "—", title: "no tick yet" });
    assert.deepEqual(formatNetChangeCell(empty), { text: "—", title: "no writes yet" });
    assert.deepEqual(formatMetricCell(empty), { text: "—", title: "no tick yet" });
  });

  it("net change is signed money and a write count", () => {
    const cell = formatNetChangeCell(
      row({
        impact: impact({ writeCount: 11, netDailyBudgetPence: 6212 }),
      }),
    );
    assert.equal(cell.text, "+£62.12/day · 11");
  });

  it("metric cell is the latest point", () => {
    assert.equal(
      formatMetricCell(row({ impact: impact({ metric: "cpr", metricLatest: 1.06 }) })).text,
      "cpr 1.06",
    );
  });
});

describe("default sort is Live first, then vs target desc", () => {
  it("ten rows put the two Live ones at the top, pricier first", () => {
    const rows = [
      row({
        id: "s1",
        name: "Shadow A",
        arm: "shadow",
        impact: impact({ metricLatest: 3, metric: "cpr" }),
        controls: controls({ campaignTargetValue: 1, useOverride: true }),
      }),
      row({
        id: "live-cheap",
        name: "Live cheap",
        arm: "live",
        impact: impact({ metricLatest: 0.8, metric: "cpr" }),
        controls: controls({ campaignTargetValue: 1, useOverride: true }),
      }),
      row({
        id: "live-pricey",
        name: "Live pricey",
        arm: "live",
        impact: impact({ metricLatest: 1.5, metric: "cpr" }),
        controls: controls({ campaignTargetValue: 1, useOverride: true }),
      }),
      ...Array.from({ length: 7 }, (_, i) =>
        row({
          id: `s${i + 2}`,
          name: `Shadow ${i + 2}`,
          arm: "shadow",
          impact: impact({ metricLatest: 0.5, metric: "cpr" }),
          controls: controls({ campaignTargetValue: 1, useOverride: true }),
        }),
      ),
    ];
    assert.equal(rows.length, 10);
    const sorted = sortArmedRows(rows, DEFAULT_ARMED_SORT);
    assert.equal(sorted[0]?.id, "live-pricey");
    assert.equal(sorted[1]?.id, "live-cheap");
    assert.equal(sorted[0]?.arm, "live");
    assert.equal(sorted[1]?.arm, "live");
  });

  it("Campaign header toggles a–z then z–a", () => {
    const rows = [
      row({ id: "b", name: "Beta" }),
      row({ id: "a", name: "Alpha" }),
      row({ id: "c", name: "Chi" }),
    ];
    const az = nextArmedSort(DEFAULT_ARMED_SORT, "campaign");
    assert.deepEqual(az, { key: "campaign", dir: "asc" });
    assert.deepEqual(
      sortArmedRows(rows, az).map((r) => r.name),
      ["Alpha", "Beta", "Chi"],
    );
    const za = nextArmedSort(az, "campaign");
    assert.deepEqual(za, { key: "campaign", dir: "desc" });
    assert.deepEqual(
      sortArmedRows(rows, za).map((r) => r.name),
      ["Chi", "Beta", "Alpha"],
    );
  });

  it("vs cap sorts by the ratio", () => {
    const low = row({
      id: "low",
      impact: impact({ currentDailyBudgetPence: 10000 }),
      controls: controls({ hardBudgetCeiling: 100 }),
    });
    const high = row({
      id: "high",
      impact: impact({ currentDailyBudgetPence: 90000 }),
      controls: controls({ hardBudgetCeiling: 100 }),
    });
    const first = nextArmedSort(DEFAULT_ARMED_SORT, "vsCap");
    assert.deepEqual(first, { key: "vsCap", dir: "desc" });
    assert.deepEqual(
      sortArmedRows([low, high], first).map((r) => r.id),
      ["high", "low"],
    );
  });

  it("parseArmedTableSort restores a stored column", () => {
    assert.deepEqual(parseArmedTableSort(null), DEFAULT_ARMED_SORT);
    assert.deepEqual(parseArmedTableSort(JSON.stringify({ key: "vsCap", dir: "asc" })), {
      key: "vsCap",
      dir: "asc",
    });
    assert.deepEqual(parseArmedTableSort("{"), DEFAULT_ARMED_SORT);
    assert.deepEqual(
      readArmedTableSort(() => {
        throw new Error("blocked");
      }),
      DEFAULT_ARMED_SORT,
    );
  });

  it("acting sorts by action then time", () => {
    const a = row({
      id: "a",
      lastDecision: decision({ action: "maintain", at: "2026-09-14T10:00:00.000Z" }),
    });
    const b = row({
      id: "b",
      lastDecision: decision({ action: "maintain", at: "2026-09-14T18:00:00.000Z" }),
    });
    const c = row({
      id: "c",
      lastDecision: decision({ action: "skip_not_delivering", at: "2026-09-14T12:00:00.000Z" }),
    });
    const cmp = compareArmedRows(a, c, { key: "acting", dir: "asc" }, now);
    assert.ok(cmp < 0);
    const byTime = sortArmedRows([b, a], { key: "acting", dir: "asc" }, now);
    assert.deepEqual(
      byTime.map((r) => r.id),
      ["a", "b"],
    );
  });
});

describe("controlsFromStrategy carries the account benchmark", () => {
  it("reads accountBenchmarkValue from the primary rule", () => {
    const draft = createDefaultDraft();
    const strategy = {
      ...draft.optimisationStrategy,
      rules: [
        {
          id: "r1",
          name: "CPR",
          metric: "cpr" as const,
          timeWindow: "24h" as const,
          enabled: true,
          priority: "primary" as const,
          campaignTargetValue: undefined,
          accountBenchmarkValue: 0.91,
          useOverride: false,
          thresholds: [],
        },
      ],
    };
    const next = controlsFromStrategy(strategy, "registration", "GBP");
    assert.equal(next.accountBenchmarkValue, 0.91);
    assert.equal(next.campaignTargetValue, null);
  });
});

describe("the mapper names ratios, not a verdict", () => {
  it("new table files do not carry the banned verbs", () => {
    const mapper = readFileSync(new URL("../armed-table.ts", import.meta.url), "utf8");
    const ui = readFileSync(
      new URL("../../../components/optimisation/armed-campaign-row.tsx", import.meta.url),
      "utf8",
    );
    const needles = [
      "sca" + "le",
      "cu" + "t",
      "inc" + "rease",
      "red" + "uce",
      "sho" + "uld",
      "recom" + "mend",
    ];
    for (const word of needles) {
      assert.equal(mapper.toLowerCase().includes(word), false, `mapper ${word}`);
      assert.equal(ui.toLowerCase().includes(word), false, `ui ${word}`);
    }
  });

  it("the Armed event name stays a link in the folded detail", () => {
    const src = readFileSync(
      new URL("../../../components/optimisation/armed-campaign-row.tsx", import.meta.url),
      "utf8",
    );
    assert.match(src, /Wired to/);
    assert.match(src, /href=\{`\/events\/\$\{row\.eventId\}`\}/);
  });
});
