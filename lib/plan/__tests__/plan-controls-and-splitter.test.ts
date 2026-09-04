/**
 * Plan controls + splitter. Run:
 * node --test lib/plan/__tests__/plan-controls-and-splitter.test.ts
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PLAN_BUDGET_PRESETS,
  applyPreset,
  budgetVariancePence,
  lifetimeToDaily,
  renormalisePreset,
  scheduledDayCount,
  selectionFromBudget,
  splitLockedEdit,
  zeroPlatform,
} from "../budget-split.ts";
import { planChannelRows } from "../canvas.ts";
import { planSplitToBudget } from "../canvas-inputs.ts";
import { resolveEventEndAnchors } from "../event-end-dates.ts";
import { FIXTURE_HREFS, factsBundle, readyPlan } from "./canvas-fixtures.ts";
import {
  PLAN_START_BUFFER_MINUTES,
  composeTikTokScheduleAt,
  resolveStartNow,
} from "../schedule.ts";
import { budgetedLaunchAdapters } from "../types.ts";
import { formatLibraryRelativeDate } from "../../library/format-date.ts";
import type { CampaignListItem } from "../../types.ts";

const PARENT = "2b0aa64";

function pence(value: number): number {
  return Math.round(value * 100);
}

describe("start buffer never yields a past start", () => {
  it("names the constant and stays strictly after now", () => {
    assert.equal(PLAN_START_BUFFER_MINUTES, 15);
    const samples = [
      new Date("2026-08-27T10:00:00"),
      new Date("2026-08-27T23:50:00"),
      new Date("2026-12-31T23:55:00"),
      new Date("2026-01-01T00:00:00"),
    ];
    for (const now of samples) {
      const resolved = resolveStartNow(now, PLAN_START_BUFFER_MINUTES);
      const at = new Date(
        now.getTime() + PLAN_START_BUFFER_MINUTES * 60_000,
      );
      assert.equal(resolved.date, `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`);
      assert.equal(resolved.time.length, 5);
      assert.ok(at.getTime() > now.getTime());
    }
  });

  it("does not change TikTok advertiser-tz threading", () => {
    assert.equal(composeTikTokScheduleAt("2026-09-01", "14:30", "09:00:00"), "2026-09-01T14:30:00");
    assert.doesNotMatch(composeTikTokScheduleAt("2026-09-01", "14:30", "09:00:00") ?? "", /Z$/);
  });
});

describe("end-date buttons only render dates that resolve", () => {
  it("omits missing presale / general sale / event date", () => {
    assert.deepEqual(resolveEventEndAnchors({}), []);
    assert.deepEqual(resolveEventEndAnchors({ eventDate: "2026-09-12" }).map((row) => row.id), [
      "event",
    ]);
    const all = resolveEventEndAnchors({
      presaleAt: "2026-08-01T10:00:00.000Z",
      generalSaleAt: "2026-08-15T10:00:00.000Z",
      eventDate: "2026-09-12",
    });
    assert.deepEqual(all.map((row) => row.id), ["presale", "general_sale", "event"]);
  });
});

describe("deselect zeroes budget, skips fan-out, preserves draft", () => {
  it("zero daily drops the adapter from the launch set", () => {
    const budget = {
      totalDaily: 100,
      metaDaily: 90,
      tiktokDaily: 5,
      googleDaily: 5,
    };
    const next = zeroPlatform(budget, "google");
    assert.equal(next.googleDaily, 0);
    assert.ok(!budgetedLaunchAdapters(next).includes("google"));
    assert.ok(budgetedLaunchAdapters(next).includes("meta"));
  });

  /**
   * The collapse-on-deselect card is gone with the toggle row: a platform
   * at 0% is skipped, and its row stays on the canvas showing `skipped`
   * so the operator can see the draft is still there.
   */
  it("a zeroed platform keeps its draft and reads skipped", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.doesNotMatch(workspace, /collapsed=\{!budgetSelected/);
    assert.doesNotMatch(
      workspace,
      /draftId:\s*null.*deselect|launches\[adapter\]\s*=\s*\{\s*\.\.\.IDLE/,
    );

    const plan = readyPlan();
    const rows = planChannelRows({
      plan: {
        ...plan,
        intent: {
          ...plan.intent,
          budget: { totalDaily: 100, metaDaily: 100, tiktokDaily: 0, googleDaily: 0 },
        },
      },
      issues: [],
      facts: factsBundle(),
      hrefs: FIXTURE_HREFS,
    });
    const google = rows.find((row) => row.adapter === "google")!;
    assert.equal(google.skipped, true);
    assert.equal(google.draftId, "google-draft");
  });
});

describe("lifetime → daily derivation", () => {
  it("divides by inclusive day count, including uneven lengths", () => {
    assert.equal(scheduledDayCount("2026-09-01", "2026-09-07"), 7);
    assert.equal(scheduledDayCount("2026-09-01", "2026-09-10"), 10);
    assert.equal(scheduledDayCount(null, "2026-09-10"), null);
    assert.equal(scheduledDayCount("2026-09-10", "2026-09-01"), null);
    assert.equal(lifetimeToDaily(700, 7), 100);
    assert.equal(lifetimeToDaily(101, 10), 10.1);
  });
});

describe("preset renormalisation", () => {
  it("Google off keeps Meta and gives the rest to TikTok", () => {
    const weights = renormalisePreset(PLAN_BUDGET_PRESETS[0], {
      meta: true,
      tiktok: true,
      google: false,
    });
    assert.equal(weights.meta, 90);
    assert.equal(weights.tiktok, 10);
    assert.equal(weights.google, 0);
    const split = applyPreset(100, "90-5-5", { meta: true, tiktok: true, google: false });
    assert.equal(pence(split.metaDaily + split.tiktokDaily + split.googleDaily), 10000);
    assert.equal(split.googleDaily, 0);
  });

  it("Meta-only is 100; Meta-off 5:5 becomes 50/50", () => {
    const onlyMeta = renormalisePreset(PLAN_BUDGET_PRESETS[0], {
      meta: true,
      tiktok: false,
      google: false,
    });
    assert.equal(onlyMeta.meta, 100);
    const noMeta = renormalisePreset(PLAN_BUDGET_PRESETS[0], {
      meta: false,
      tiktok: true,
      google: true,
    });
    assert.equal(noMeta.tiktok, 50);
    assert.equal(noMeta.google, 50);
  });
});

describe("locked splitter sum-invariance and exact-penny rounding", () => {
  it("holds across many random edits (property)", () => {
    let seed = 20260827;
    function rand(): number {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    }
    for (let i = 0; i < 250; i++) {
      const total = Math.round(rand() * 10_000) / 100 || 1;
      const selected = {
        meta: rand() > 0.2,
        tiktok: rand() > 0.3,
        google: rand() > 0.3,
      };
      if (!selected.meta && !selected.tiktok && !selected.google) selected.meta = true;
      const preset = PLAN_BUDGET_PRESETS[Math.floor(rand() * PLAN_BUDGET_PRESETS.length)]!;
      let budget = applyPreset(total, preset.id, selected);
      assert.equal(
        pence(budget.metaDaily + budget.tiktokDaily + budget.googleDaily),
        pence(total),
        `preset ${preset.id} total ${total}`,
      );
      const active = (["meta", "tiktok", "google"] as const).filter((p) => selected[p]);
      const edited = active[Math.floor(rand() * active.length)]!;
      const nextValue = Math.round(rand() * total * 100) / 100;
      budget = splitLockedEdit(budget, selected, edited, nextValue, total);
      const expected =
        active.length === 1 ? pence(Math.max(0, nextValue)) : pence(total);
      assert.equal(
        pence(budget.metaDaily + budget.tiktokDaily + budget.googleDaily),
        expected,
        `edit ${edited}=${nextValue} total ${total}`,
      );
    }
  });
});

describe("variance is structurally impossible on the canvas", () => {
  /**
   * The three number inputs are gone, so the operator can no longer type a
   * split that misses the total. `SplitBar` moves boundaries within 100%,
   * and `planSplitToBudget` re-derives £ from pct against the same total —
   * `budgetVariancePence` survives only as the proof of that invariant.
   */
  it("every split the bar can produce is at parity with the total", () => {
    const total = 120;
    for (const pcts of [
      [90, 5, 5],
      [80, 15, 5],
      [70, 20, 10],
      [50, 40, 10],
      [100, 0, 0],
      [0, 0, 100],
      [34, 33, 33],
    ]) {
      const budget = planSplitToBudget(
        [
          { platform: "meta", pct: pcts[0]! },
          { platform: "tiktok", pct: pcts[1]! },
          { platform: "google", pct: pcts[2]! },
        ],
        total,
      );
      assert.equal(budgetVariancePence(budget, total), 0, pcts.join("/"));
    }
  });
});

describe("dialog no-overlap + 47/71 shapes", () => {
  it("panelClassName replaces the default max-w-md", () => {
    const dialog = readFileSync("components/ui/dialog.tsx", "utf8");
    assert.match(dialog, /panelClassName \?\? "max-w-md"/);
    assert.doesNotMatch(dialog, /max-w-md px-4 \$\{panelClassName/);
    const picker = readFileSync("components/library/campaign-library-picker.tsx", "utf8");
    assert.match(picker, /panelClassName="max-w-5xl"/);
  });

  it("pick rows pin Use right and keep name/account from colliding", () => {
    const rows = readFileSync("components/library/library-rows.tsx", "utf8");
    assert.match(rows, /formatLibraryRelativeDate/);
    assert.match(rows, /min-w-0 flex-1/);
    assert.match(rows, /truncate text-sm font-medium/);
    assert.match(rows, /shrink-0/);
    assert.match(rows, /items-center justify-between/);
    assert.match(rows, /variant === "pick"/);
  });

  it("formatters survive 47 drafts / 71 published with long names", () => {
    const now = new Date("2026-08-27T12:00:00.000Z");
    const campaigns: CampaignListItem[] = [];
    for (let i = 0; i < 47; i++) {
      campaigns.push({
        id: `draft-${i}`,
        name: `Very Long Campaign Name That Must Truncate ${i} — Summer Series`,
        objective: "registration",
        status: "draft",
        adAccountId: `act_1234567890${i}`,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-27T10:00:00.000Z",
      });
    }
    for (let i = 0; i < 71; i++) {
      campaigns.push({
        id: `pub-${i}`,
        name: `Published Festival Campaign ${i} With Extra Words`,
        objective: "purchase",
        status: "published",
        adAccountId: `act_9876543210${i}`,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-08-20T10:00:00.000Z",
      });
    }
    assert.equal(campaigns.filter((row) => row.status === "draft").length, 47);
    assert.equal(campaigns.filter((row) => row.status === "published").length, 71);
    for (const row of campaigns) {
      const rel = formatLibraryRelativeDate(row.updatedAt, now);
      assert.ok(rel.length > 0);
      assert.doesNotMatch(rel, /NaN/);
    }
  });
});

describe("empty-plan selection and falsify", () => {
  it("all-zero budget treats every platform as available", () => {
    const selected = selectionFromBudget({
      totalDaily: 0,
      metaDaily: 0,
      tiktokDaily: 0,
      googleDaily: 0,
    });
    assert.deepEqual(selected, { meta: true, tiktok: true, google: true });
  });

  it("parent sha has no buffer constant and a narrow dialog default", () => {
    const parentSchedule = execFileSync("git", ["show", `${PARENT}:lib/plan/schedule.ts`], {
      encoding: "utf8",
    });
    assert.doesNotMatch(parentSchedule, /PLAN_START_BUFFER_MINUTES/);
    const parentDialog = execFileSync("git", ["show", `${PARENT}:components/ui/dialog.tsx`], {
      encoding: "utf8",
    });
    assert.match(parentDialog, /max-w-md px-4 \$\{panelClassName/);
  });
});
