/**
 * Live click-through fixes for #867/#868/#869.
 * Falsify 1, 2, 4 against parent sha 4f14a25.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PLAN_BUDGET_PRESETS,
  presetChipCopy,
  selectionFromBudget,
} from "../budget-split.ts";
import { createEmptyCampaignPlan } from "../empty-plan.ts";
import {
  eventEndDateSourceFromOption,
  presentEventTimestamp,
  resolveEventEndAnchors,
} from "../event-end-dates.ts";
import { upsertCampaignPlan } from "../persist.ts";
import {
  newPlanVisitPersists,
  shouldMarkUserEdit,
  shouldPersistPlanOnChange,
} from "../persist-policy.ts";

const PARENT = "4f14a25";

function memoryDb() {
  const plans = new Map<string, Record<string, unknown>>();
  return {
    plans,
    from(table: string) {
      return {
        upsert: async (row: Record<string, unknown>) => {
          if (table === "campaign_plans") plans.set(String(row.id), row);
          return { error: null };
        },
      };
    },
  };
}

describe("1 — /plan/new does not persist without an operator edit", () => {
  it("falsify: parent lifetime sync marks hasUserEdit", () => {
    const parent = execFileSync("git", ["show", `${PARENT}:components/plan/plan-workspace.tsx`], {
      encoding: "utf8",
    });
    assert.match(parent, /if \(budgetMode !== "lifetime"\)[\s\S]*setHasUserEdit\(true\)/);
  });

  it("visiting /plan/new and leaving without touching creates no campaign_plans row", async () => {
    const plan = createEmptyCampaignPlan({
      userId: "user-1",
      eventId: "event-default",
      name: "",
    });
    const selected = selectionFromBudget(plan.intent.budget);
    assert.deepEqual(selected, { meta: true, tiktok: true, google: true });
    assert.equal(shouldMarkUserEdit("derived-lifetime"), false);
    assert.equal(shouldMarkUserEdit("derived-selection"), false);
    assert.equal(shouldMarkUserEdit("derived-budget-mode"), false);
    assert.equal(shouldMarkUserEdit("derived-split"), false);
    assert.equal(
      newPlanVisitPersists({
        eventId: plan.intent.eventId,
        sources: ["derived-lifetime", "derived-selection", "derived-budget-mode", "derived-split"],
      }),
      false,
    );
    assert.equal(shouldPersistPlanOnChange({ hasUserEdit: false, eventId: plan.intent.eventId }), false);

    const db = memoryDb();
    if (
      shouldPersistPlanOnChange({
        hasUserEdit: shouldMarkUserEdit("derived-lifetime"),
        eventId: plan.intent.eventId,
      })
    ) {
      await upsertCampaignPlan(db, plan);
    }
    assert.equal(db.plans.size, 0, "no Untitled plan row");
  });

  it("workspace derived lifetime sync no longer flips hasUserEdit", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    const start = workspace.indexOf('if (budgetMode !== "lifetime")');
    assert.ok(start >= 0);
    const effect = workspace.slice(start, workspace.indexOf("}, [", start) + 20);
    assert.doesNotMatch(effect, /setHasUserEdit\(true\)/);
    assert.match(workspace, /shouldPersistPlanOnChange/);
    assert.equal(shouldMarkUserEdit("operator"), true);
    assert.equal(
      newPlanVisitPersists({ eventId: "e1", sources: ["operator"] }),
      true,
    );
  });
});

describe("2 — end-date chips omit sale dates that do not exist", () => {
  it("falsify: parent dateFromIso has no presentEventTimestamp guard", () => {
    const parent = execFileSync("git", ["show", `${PARENT}:lib/plan/event-end-dates.ts`], {
      encoding: "utf8",
    });
    assert.match(parent, /function dateFromIso/);
    assert.doesNotMatch(parent, /presentEventTimestamp/);
    assert.doesNotMatch(parent, /eventEndDateSourceFromOption/);
  });

  it("null presale_at / general_sale_at means those chips are absent — no event_date fallback", () => {
    const source = eventEndDateSourceFromOption({
      eventDate: "2026-09-20",
      presaleAt: null,
      generalSaleAt: null,
    });
    const anchors = resolveEventEndAnchors(source);
    assert.deepEqual(
      anchors.map((row) => row.id),
      ["event"],
    );
    assert.equal(anchors.some((row) => row.label === "Presale"), false);
    assert.equal(anchors.some((row) => row.label === "General sale"), false);
    assert.equal(anchors[0]?.label, "Event date");
    assert.equal(presentEventTimestamp(null), null);
    assert.equal(presentEventTimestamp("   "), null);
    assert.equal(presentEventTimestamp("null"), null);
    assert.equal(resolveEventEndAnchors({ eventDate: "2026-09-20", presaleAt: "2026-09-20" }).map((row) => row.id).includes("presale"), true);
  });
});

describe("3 — /plans row actions collapse to an overflow menu", () => {
  it("PlanRow uses OverflowMenu and keeps #863 PlanDeleteAction confirm", () => {
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    assert.match(rows, /OverflowMenu/);
    assert.match(rows, /Save as plan template/);
    assert.match(rows, /PlanDeleteAction/);
    assert.match(rows, /trigger="none"/);
    assert.match(readFileSync("components/viz/overflow-menu.tsx", "utf8"), /MoreHorizontal/);
    assert.match(readFileSync("components/plan/plan-delete-action.tsx", "utf8"), /DELETE_PLAN_CONFIRM|ARCHIVE_PLAN_CONFIRM/);
  });
});

describe("4 — active preset chip shows the effective split", () => {
  it("falsify: parent chip label is always the nominal id", () => {
    const parent = execFileSync(
      "git",
      ["show", `${PARENT}:components/plan/plan-budget-controls.tsx`],
      { encoding: "utf8" },
    );
    assert.match(parent, /preset\.id\.replaceAll\("-", "\/"\)/);
    assert.doesNotMatch(parent, /presetChipCopy/);
  });

  it("Google off labels the active 70/20/10 chip 70/30; inactive chips stay nominal", () => {
    const preset = PLAN_BUDGET_PRESETS.find((row) => row.id === "70-20-10");
    assert.ok(preset);
    const selected = { meta: true, tiktok: true, google: false };
    const active = presetChipCopy(preset, selected, true);
    const inactive = presetChipCopy(preset, selected, false);
    assert.equal(active.label, "70/30");
    assert.equal(active.title, "70/20/10");
    assert.equal(inactive.label, "70/20/10");
    assert.equal(inactive.title, "70/20/10");
    const allOn = presetChipCopy(preset, { meta: true, tiktok: true, google: true }, true);
    assert.equal(allOn.label, "70/20/10");
  });
});
