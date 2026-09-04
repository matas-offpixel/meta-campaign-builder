/**
 * Campaign-creator redesign primitives — named states + Drawer #871 click.
 * Run: node --test lib/viz/__tests__/viz-kit-redesign.test.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { TIKTOK_IMAGE_UNSUPPORTED_REASON } from "../../plan/asset-routing.ts";
import {
  TIKTOK_IMAGE_DISABLED_REASON,
  assetIsUnrouted,
  assetStripState,
  googleRoutingMark,
  routingToggleNext,
  tiktokDisabledReason,
} from "../asset-strip.ts";
import { channelRowView } from "../channel-row.ts";
import {
  drawerOpenClick,
  drawerTabAfterClick,
  drawerView,
  shouldIgnoreOutsidePointer,
} from "../drawer.ts";
import {
  applySplitPreset,
  moveSplitBoundary,
  splitProvenance,
} from "../split-bar.ts";
import {
  VIZ_PROVENANCE_MARK,
  VIZ_PROVENANCE_TOKEN,
  VIZ_STATUSES,
  VIZ_STATUS_TOKEN,
} from "../tokens.ts";
import {
  applyWindowHandle,
  momentGlyph,
  nudgeWindowHandle,
  relativeMomentLabel,
  snapToMoments,
  WINDOW_SNAP_PX,
} from "../window-bar.ts";

describe("StatusDot / VIZ_STATUSES — blocked", () => {
  it("blocked is a status token and is not idle", () => {
    assert.ok(VIZ_STATUSES.includes("blocked"));
    assert.equal(VIZ_STATUS_TOKEN.blocked, "bg-warning/70");
    assert.notEqual(VIZ_STATUS_TOKEN.blocked, VIZ_STATUS_TOKEN.idle);
    assert.notEqual(VIZ_STATUS_TOKEN.blocked, VIZ_STATUS_TOKEN.paused);
  });

  it("StatusDot still reads the shared label map", () => {
    const source = readFileSync("components/viz/status-dot.tsx", "utf8");
    assert.match(source, /VIZ_STATUS_LABEL\[status\]/);
  });
});

describe("ProvenanceBadge / derived", () => {
  it("derived mark is ⌁ and never reuses modelled", () => {
    assert.equal(VIZ_PROVENANCE_MARK.derived, "⌁");
    assert.equal(VIZ_PROVENANCE_MARK.modelled, "mod");
    assert.notEqual(VIZ_PROVENANCE_MARK.derived, VIZ_PROVENANCE_MARK.modelled);
    assert.match(VIZ_PROVENANCE_TOKEN.derived, /violet/);
    assert.match(VIZ_PROVENANCE_TOKEN.modelled, /violet/);
    assert.notEqual(VIZ_PROVENANCE_TOKEN.derived, VIZ_PROVENANCE_TOKEN.modelled);
  });
});

describe("MetricChip sizes", () => {
  it("exposes sm md lg and lg is tabular-nums + big", () => {
    const source = readFileSync("components/viz/metric-chip.tsx", "utf8");
    assert.match(source, /size\?: /);
    assert.match(source, /sm:/);
    assert.match(source, /md:/);
    assert.match(source, /lg:/);
    assert.match(source, /text-2xl/);
    assert.match(source, /tabular-nums/);
  });
});

describe("BlockerBadge anchor", () => {
  it("anchor click path calls onOpenAnchor; href stays for routes", () => {
    const source = readFileSync("components/viz/blocker-badge.tsx", "utf8");
    assert.match(source, /onOpenAnchor/);
    assert.match(source, /row\.anchor/);
    assert.match(source, /href=\{row\.href\}/);
    const blockers = readFileSync("lib/viz/blockers.ts", "utf8");
    assert.match(blockers, /anchor\?:/);
    assert.match(blockers, /drawer:/);
    assert.match(blockers, /section:/);
  });
});

describe("SplitBar — preset / manual + linked adjustment", () => {
  const platforms = ["meta", "tiktok", "google"] as const;
  const presets = [
    { label: "80·15·5", pct: [80, 15, 5] },
    { label: "90·5·5", pct: [90, 5, 5] },
  ];

  it("preset state when segments match a preset", () => {
    const segments = applySplitPreset([...platforms], [80, 15, 5]);
    assert.equal(splitProvenance(segments, presets, [...platforms]), "derived");
  });

  it("manual state when the operator moves a boundary", () => {
    const start = applySplitPreset([...platforms], [80, 15, 5]);
    const moved = moveSplitBoundary(start, 0, 5);
    assert.equal(splitProvenance(moved, presets, [...platforms]), "manual entry");
    const sum = moved.reduce((total, segment) => total + segment.pct, 0);
    assert.ok(Math.abs(sum - 100) < 0.02, `sum ${sum}`);
  });

  it("arrow 1pt keeps the linked remainder on the other platforms", () => {
    const start = applySplitPreset([...platforms], [80, 15, 5]);
    const moved = moveSplitBoundary(start, 0, 1);
    const meta = moved.find((s) => s.platform === "meta")!.pct;
    assert.ok(Math.abs(meta - 81) < 0.02);
    const rest = moved.filter((s) => s.platform !== "meta");
    const restSum = rest.reduce((total, segment) => total + segment.pct, 0);
    assert.ok(Math.abs(restSum - 19) < 0.02);
  });

  it("composes FunnelBarSegments — does not copy the track", () => {
    const source = readFileSync("components/viz/split-bar.tsx", "utf8");
    assert.match(source, /FunnelBarSegments/);
    assert.doesNotMatch(source, /VIZ_PLATFORM_BAR/);
  });
});

describe("ChannelRow named states", () => {
  const facts = [
    { n: 12, noun: "audiences" },
    { n: 3, noun: "creatives" },
  ];

  it("waiting — ○ waiting for f, no derived badge", () => {
    const view = channelRowView({ status: "idle", facts, waiting: true, derived: true });
    assert.equal(view.state, "waiting");
    assert.equal(view.waitingText, "waiting for f");
    assert.equal(view.showDerived, false);
    assert.equal(view.showFactsText, false);
  });

  it("ready — facts as nouns, optional derived before them", () => {
    const view = channelRowView({ status: "ready", facts, derived: true });
    assert.equal(view.state, "ready");
    assert.equal(view.showDerived, true);
    assert.equal(view.factsText, "12 audiences · 3 creatives");
    assert.equal(view.showResume, false);
  });

  it("blocked", () => {
    const view = channelRowView({ status: "ready", facts, blocked: true });
    assert.equal(view.state, "blocked");
  });

  it("paused — resume slot", () => {
    const view = channelRowView({ status: "paused", facts });
    assert.equal(view.state, "paused");
    assert.equal(view.showResume, true);
  });

  it("live — facts slot yields to MetricChips", () => {
    const view = channelRowView({ status: "live", facts });
    assert.equal(view.state, "live");
    assert.equal(view.showLiveFacts, true);
    assert.equal(view.showFactsText, false);
  });
});

describe("WindowBar named states + snap / keyboard", () => {
  const now = new Date("2026-08-27T12:00:00Z");
  const presale = new Date("2026-08-29T09:00:00Z");
  const show = new Date("2026-11-13T20:00:00Z");
  const moments = [
    { id: "now", label: "now", at: now },
    { id: "presale", label: "presale", at: presale },
    { id: "show", label: "show", at: show },
  ];

  it("moment glyphs", () => {
    assert.equal(momentGlyph("now"), "●");
    assert.equal(momentGlyph("presale"), "○");
    assert.equal(momentGlyph("gen sale"), "○");
    assert.equal(momentGlyph("show"), "◆");
  });

  it("relative time is tabular-ready (in 2d)", () => {
    assert.equal(relativeMomentLabel(presale, now), "in 2d");
    assert.equal(relativeMomentLabel(now, presale), "2d ago");
  });

  it("snaps within 8px and reports clamped", () => {
    const from = now.getTime();
    const to = show.getTime();
    const trackPx = 800;
    const near = new Date(presale.getTime() + 3 * ((to - from) / trackPx));
    const snapped = snapToMoments(near, moments, from, to, trackPx);
    assert.equal(snapped.clamped, true);
    assert.equal(snapped.momentId, "presale");
    assert.equal(WINDOW_SNAP_PX, 8);
  });

  it("does not snap outside 8px — default", () => {
    const from = now.getTime();
    const to = show.getTime();
    const far = new Date(presale.getTime() + 40 * ((to - from) / 800));
    const snapped = snapToMoments(far, moments, from, to, 800);
    assert.equal(snapped.clamped, false);
  });

  it("arrow = 1h, shift+arrow = 1d", () => {
    const start = new Date("2026-08-27T12:00:00Z");
    const end = new Date("2026-11-13T20:00:00Z");
    const hour = nudgeWindowHandle("start", { start, end }, 1, false);
    assert.equal(hour.start.getTime() - start.getTime(), 3_600_000);
    const day = nudgeWindowHandle("start", { start, end }, 1, true);
    assert.equal(day.start.getTime() - start.getTime(), 86_400_000);
  });

  it("min clamp keeps start from moving earlier", () => {
    const start = new Date("2026-08-27T12:00:00Z");
    const end = new Date("2026-11-13T20:00:00Z");
    const next = applyWindowHandle(
      "start",
      new Date("2026-08-01T00:00:00Z"),
      { start, end },
      start,
    );
    assert.equal(next.start.getTime(), start.getTime());
  });
});

describe("AssetStrip named states", () => {
  const video = { id: "v1", label: "clip", aspect: "9:16", mediaKind: "video" as const };
  const image = { id: "i1", label: "still", aspect: "4:5", mediaKind: "image" as const };

  it("empty — + only", () => {
    assert.equal(assetStripState([], {}), "empty");
  });

  it("routed — a glyph is lit", () => {
    assert.equal(assetStripState([video], { v1: ["meta", "tiktok"] }), "routed");
  });

  it("unrouted — no glyph lit is a blocker", () => {
    assert.equal(assetIsUnrouted(video, []), true);
    assert.equal(assetStripState([video], { v1: [] }), "unrouted");
  });

  it("Google is always the not-instrumented dash, never a cross", () => {
    assert.equal(googleRoutingMark(), "—");
    const source = readFileSync("components/viz/asset-strip.tsx", "utf8");
    assert.match(source, /not instrumented/);
    assert.match(source, /border-dashed/);
    assert.doesNotMatch(source, /✗|✕|cross/);
    assert.equal(routingToggleNext(["meta"], "google", true).includes("google"), false);
  });

  it("TikTok image-disabled reason matches the launcher copy", () => {
    assert.equal(TIKTOK_IMAGE_DISABLED_REASON, TIKTOK_IMAGE_UNSUPPORTED_REASON);
    assert.equal(tiktokDisabledReason(image), TIKTOK_IMAGE_UNSUPPORTED_REASON);
    assert.equal(tiktokDisabledReason(video), undefined);
  });
});

describe("Drawer — #871 reachable after a real click", () => {
  const tabs = [
    { id: "audiences", label: "audiences" },
    { id: "creatives", label: "creatives" },
  ];

  it("same-tick closer (the #871 bug) leaves Done and tabs unreachable", () => {
    const bug = drawerOpenClick({ subscribeSameTick: true, target: "trigger" });
    assert.equal(bug.open, false);
    assert.equal(bug.doneReachable, false);
    assert.equal(bug.tabContentReachable, false);
  });

  it("deferred closer: click trigger → tab content and Done are REACHABLE", () => {
    const opened = drawerOpenClick({ subscribeSameTick: false, target: "trigger" });
    assert.equal(opened.open, true);
    assert.equal(opened.doneReachable, true);
    assert.equal(opened.tabContentReachable, true);

    const view = drawerView({
      open: true,
      platform: "meta",
      tabs,
      activeTab: "audiences",
      status: "ready",
      hasTemplate: true,
    });
    assert.equal(view.showDone, true);
    assert.equal(view.doneReachable, true);
    assert.equal(view.tabContentReachable, true);
    assert.equal(view.showTemplate, true);
    assert.equal(drawerTabAfterClick(tabs, "creatives"), "creatives");
  });

  it("outside-click exempts trigger and sheet", () => {
    assert.equal(shouldIgnoreOutsidePointer({ trigger: true, sheet: false }), true);
    assert.equal(shouldIgnoreOutsidePointer({ trigger: false, sheet: true }), true);
    assert.equal(shouldIgnoreOutsidePointer({ trigger: false, sheet: false }), false);
  });

  it("component portals, defers pointerdown, traps focus, Done is in the tree", () => {
    const source = readFileSync("components/viz/drawer.tsx", "utf8");
    assert.match(source, /createPortal/);
    assert.match(source, /document\.body/);
    assert.match(source, /setTimeout/);
    assert.match(source, /pointerdown/);
    assert.match(source, /triggerRef/);
    assert.match(source, /Escape/);
    /**
     * PR 4 made the label a prop so `/campaign/[id]` can read
     * "Campaign Library" — closing a page-variant drawer goes somewhere,
     * where closing a sheet goes back to the canvas behind it. The
     * default is still Done, which is what this guards.
     */
    assert.match(source, /doneLabel = "Done"/);
    assert.match(source, />\s*\{doneLabel\}\s*</);
    assert.match(source, /max-md:inset-0/);
    assert.match(source, /onLoadTemplate/);
    assert.match(source, /#871/);
  });
});

describe("leaf modules — no wizard / meta imports", () => {
  it("new primitives stay off steps, tiktok-wizard, google-search-wizard, lib/meta", () => {
    const files = [
      "components/viz/drawer.tsx",
      "components/viz/channel-row.tsx",
      "components/viz/window-bar.tsx",
      "components/viz/asset-strip.tsx",
      "components/viz/split-bar.tsx",
      "lib/viz/drawer.ts",
      "lib/viz/channel-row.ts",
      "lib/viz/window-bar.ts",
      "lib/viz/asset-strip.ts",
      "lib/viz/split-bar.ts",
    ];
    const banned = /components\/steps|tiktok-wizard|google-search-wizard|lib\/meta\//;
    for (const file of files) {
      assert.doesNotMatch(readFileSync(file, "utf8"), banned, file);
    }
  });

  it("no standing sentences — InfoTip is optional and default-undefined", () => {
    for (const file of [
      "components/viz/split-bar.tsx",
      "components/viz/window-bar.tsx",
      "components/viz/drawer.tsx",
      "components/viz/channel-row.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /<p[ >]/);
      assert.doesNotMatch(source, /CardDescription/);
    }
    assert.match(readFileSync("components/viz/split-bar.tsx", "utf8"), /tip\?:/);
    assert.match(readFileSync("components/viz/window-bar.tsx", "utf8"), /tip\?:/);
  });
});
