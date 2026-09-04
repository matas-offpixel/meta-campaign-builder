/**
 * Visual language invariants — colour tokens, aria copy, blockers, thumbs.
 * Run: node --test lib/viz/__tests__/visual-language.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { shortBlockerLabel, blockerRowFromIssue } from "../blockers.ts";
import { eventInitials, firstHttpUrl, resolveEventArtwork } from "../event-artwork.ts";
import { statusFromLaunchAndBlockers, statusFromLaunchRecord } from "../status.ts";
import {
  bandFromRule,
  zoneKindAtValue,
  zonesFromThresholds,
} from "../threshold-band.ts";
import {
  VIZ_ACTION_LABEL,
  VIZ_ACTIONS,
  VIZ_ACTION_TOKEN,
  VIZ_STATUSES,
  VIZ_STATUS_TOKEN,
} from "../tokens.ts";

describe("semantic state → one colour token", () => {
  it("every VizStatus maps to exactly one bg token", () => {
    const tokens = VIZ_STATUSES.map((status) => VIZ_STATUS_TOKEN[status]);
    assert.equal(tokens.length, VIZ_STATUSES.length);
    for (const token of tokens) {
      assert.match(token, /^bg-/);
    }
    assert.equal(new Set(VIZ_STATUSES).size, VIZ_STATUSES.length);
  });

  it("every VizAction maps to a text token and an aria label", () => {
    for (const action of VIZ_ACTIONS) {
      assert.match(VIZ_ACTION_TOKEN[action], /^text-/);
      assert.ok(VIZ_ACTION_LABEL[action].length > 0);
    }
  });
});

describe("aria-label parity", () => {
  it("StatusDot source exposes VIZ_STATUS_LABEL", () => {
    const source = readFileSync("components/viz/status-dot.tsx", "utf8");
    assert.match(source, /aria-label=\{VIZ_STATUS_LABEL\[status\]\}/);
  });

  it("ActionGlyph source exposes VIZ_ACTION_LABEL", () => {
    const source = readFileSync("components/viz/action-glyph.tsx", "utf8");
    assert.match(source, /aria-label=\{VIZ_ACTION_LABEL\[key\]\}/);
  });

  it("PlatformGlyph source exposes the platform word", () => {
    const source = readFileSync("components/viz/platform-glyph.tsx", "utf8");
    assert.match(source, /aria-label=\{label\}/);
    assert.match(source, /VIZ_PLATFORM_LABEL/);
  });
});

describe("blocker information is preserved", () => {
  it("short label is ≤5 words; full message stays on the row", () => {
    const issue = {
      id: "meta:pixel",
      message: "Connect a Meta pixel on the wizard account step",
      href: "/campaign/abc",
    };
    const row = blockerRowFromIssue(issue);
    assert.equal(shortBlockerLabel(issue.message).split(/\s+/).length, 5);
    assert.equal(row.full, issue.message);
    assert.equal(row.href, "/campaign/abc");
  });

  it("BlockerBadge still renders the full message and jump href", () => {
    const source = readFileSync("components/viz/blocker-badge.tsx", "utf8");
    assert.match(source, /row\.full/);
    assert.match(source, /row\.href/);
    assert.match(source, /ArrowUpRight/);
    assert.match(source, /advisory/);
  });
});

describe("event artwork — existing sources only", () => {
  it("prefers hero, then page content, then d2c, then registry", () => {
    assert.equal(
      resolveEventArtwork({
        heroImages: ["https://cdn.example/hero.jpg"],
        pageContent: { artwork_url: "https://cdn.example/page.jpg" },
        d2cArtworkUrl: "https://cdn.example/d2c.jpg",
      }),
      "https://cdn.example/hero.jpg",
    );
    assert.equal(
      resolveEventArtwork({
        pageContent: { artwork_url: "https://cdn.example/page.jpg" },
        d2cArtworkUrl: "https://cdn.example/d2c.jpg",
      }),
      "https://cdn.example/page.jpg",
    );
    assert.equal(firstHttpUrl("javascript:alert(1)"), null);
    assert.equal(eventInitials("Jamie Jones"), "JJ");
  });

  it("grep-guard: no new Meta thumbnail fetch paths", () => {
    const files = [
      "lib/viz/event-artwork.ts",
      "lib/plan/event-artwork-load.ts",
      "components/viz/event-thumb.tsx",
      "app/(dashboard)/plans/page.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /graph\.facebook|\/thumbnails|fetchThumbnailUrl|ENABLE_META_THUMBNAIL/);
    }
  });
});

describe("threshold band from the rule set", () => {
  it("paints scale-up below the cheap cut and pause above the expensive cut", () => {
    const thresholds = [
      {
        id: "a",
        operator: "below" as const,
        value: 1,
        action: "increase_budget" as const,
        label: "cheap",
      },
      {
        id: "b",
        operator: "above" as const,
        value: 5,
        action: "pause" as const,
        label: "stop",
      },
    ];
    assert.equal(zoneKindAtValue(thresholds, 0.4), "scale_up");
    assert.equal(zoneKindAtValue(thresholds, 3), "maintain");
    assert.equal(zoneKindAtValue(thresholds, 8), "pause");
    const zones = zonesFromThresholds(thresholds);
    assert.ok(zones.some((z) => z.kind === "scale_up"));
    assert.ok(zones.some((z) => z.kind === "pause"));
    const band = bandFromRule({ thresholds }, 0.4);
    assert.ok(band.markerRatio != null && band.markerRatio < 0.5);
  });
});

describe("launch record → status", () => {
  it("idle + draft is ready; live and failed stay honest", () => {
    assert.equal(statusFromLaunchRecord({ status: "idle", draftId: "d1" }), "ready");
    assert.equal(statusFromLaunchRecord({ status: "idle", draftId: null }), "idle");
    assert.equal(statusFromLaunchRecord({ status: "live", draftId: "d1" }), "live");
    assert.equal(statusFromLaunchRecord({ status: "failed", draftId: "d1" }), "failed");
  });

  it("a prepared draft with blockers is blocked, a launched one is not", () => {
    const ready = { status: "idle" as const, draftId: "d1" };
    assert.equal(statusFromLaunchAndBlockers(ready, 0), "ready");
    assert.equal(statusFromLaunchAndBlockers(ready, 2), "blocked");
    assert.equal(statusFromLaunchAndBlockers({ status: "live", draftId: "d1" }, 2), "live");
    assert.equal(statusFromLaunchAndBlockers({ status: "skipped", draftId: "d1" }, 2), "paused");
  });
});

describe("plan surfaces keep grep-guards and demote furniture", () => {
  it("workspace stands the seven canvas zones, not the stepper", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    assert.doesNotMatch(workspace, /Step 1 — Build the Meta campaign/);
    assert.doesNotMatch(workspace, /Launch status/);
    assert.doesNotMatch(workspace, /PipelineStepper/);
    assert.doesNotMatch(workspace, /New from plan/);
    for (const zone of [
      "CanvasHeader",
      "CanvasWindow",
      "CanvasBudget",
      "CanvasTarget",
      "CanvasChannels",
      "CanvasAssets",
      "CanvasLaunch",
    ]) {
      assert.match(workspace, new RegExp(zone), `canvas stands ${zone}`);
    }
  });

  it("decisions list uses glyphs not Applied/Dry run words", () => {
    const list = readFileSync("components/optimisation/automation-decisions-list.tsx", "utf8");
    assert.match(list, /ActionGlyph/);
    assert.match(list, /PlatformGlyph/);
    assert.match(list, /ThresholdBand/);
    assert.match(list, /filled=\{row\.kind === "applied"\}/);
  });
});
