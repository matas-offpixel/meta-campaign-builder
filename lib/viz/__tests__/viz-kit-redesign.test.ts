/**
 * Campaign-creator redesign primitives — named states + Drawer #871 click.
 * Run: node --test lib/viz/__tests__/viz-kit-redesign.test.ts
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  splitBarLegendPlacement,
  splitProvenance,
} from "../split-bar.ts";
import {
  VIZ_INK_HEX,
  VIZ_PLATFORMS,
  VIZ_PLATFORM_BAR,
  VIZ_PLATFORM_FILL,
  VIZ_PLATFORM_INK,
  VIZ_PLATFORM_INK_HEX,
  VIZ_PROVENANCE_MARK,
  VIZ_PROVENANCE_TOKEN,
  VIZ_SAND_HEX,
  VIZ_STATUSES,
  VIZ_STATUS_TOKEN,
  VIZ_TYPE,
  VIZ_TYPE_NUM,
} from "../tokens.ts";
import {
  applyWindowHandle,
  momentGlyph,
  nudgeWindowHandle,
  relativeMomentLabel,
  snapToMoments,
  windowPlaceholders,
  WINDOW_SNAP_PX,
} from "../window-bar.ts";

function walkVizTsx(dir = "components/viz"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkVizTsx(path));
    else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

function lin(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function wcagContrast(a: string, b: string): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

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
  it("derived mark is ⌁ and never reuses modelled; tokens stay monochrome", () => {
    assert.equal(VIZ_PROVENANCE_MARK.derived, "⌁");
    assert.equal(VIZ_PROVENANCE_MARK.modelled, "mod");
    assert.notEqual(VIZ_PROVENANCE_MARK.derived, VIZ_PROVENANCE_MARK.modelled);
    for (const token of Object.values(VIZ_PROVENANCE_TOKEN)) {
      assert.doesNotMatch(token, /sky-|emerald-|amber-|violet-|slate-/);
    }
  });
});

describe("MetricChip sizes", () => {
  it("exposes sm md lg and lg is the display token", () => {
    const source = readFileSync("components/viz/metric-chip.tsx", "utf8");
    assert.match(source, /size\?: /);
    assert.match(source, /sm:/);
    assert.match(source, /md:/);
    assert.match(source, /lg:/);
    assert.match(source, /VIZ_TYPE\.display/);
    assert.match(source, /tabular-nums/);
  });
});

describe("type scale — components/viz uses only named tokens", () => {
  it("forbids raw text-[Npx] / text-sm / text-xs / text-2xl", () => {
    const banned = /text-\[\d+px\]|\btext-(?:xs|sm|2xl)\b/;
    const hits: string[] = [];
    for (const file of walkVizTsx()) {
      if (banned.test(readFileSync(file, "utf8"))) hits.push(file);
    }
    assert.deepEqual(hits, [], hits.join("\n"));
  });

  it("names the four sizes", () => {
    assert.match(VIZ_TYPE.display, /text-\[32px\]/);
    assert.match(VIZ_TYPE.body, /text-\[14px\]/);
    assert.match(VIZ_TYPE.label, /text-\[12px\]/);
    assert.match(VIZ_TYPE.micro, /text-\[10px\]/);
    assert.match(VIZ_TYPE_NUM.body, /tabular-nums/);
  });
});

describe("platform tint contrast", () => {
  it("ink-on-fill ≥ 4.5 and glyph-on-sand ≥ 3.0; fill-vs-sand is recorded", () => {
    const fillVsSand: Record<string, number> = {};
    for (const platform of VIZ_PLATFORMS) {
      const fill = VIZ_PLATFORM_FILL[platform];
      const ink = VIZ_PLATFORM_INK_HEX[platform];
      assert.ok(wcagContrast(VIZ_INK_HEX, fill) >= 4.5, `${platform} ink-on-fill`);
      assert.ok(wcagContrast(ink, VIZ_SAND_HEX) >= 3, `${platform} glyph-on-sand`);
      fillVsSand[platform] = wcagContrast(fill, VIZ_SAND_HEX);
      assert.ok(fillVsSand[platform] > 1, `${platform} fill-vs-sand recorded`);
      assert.match(VIZ_PLATFORM_BAR[platform], new RegExp(fill.replace("#", "\\#")));
      assert.match(VIZ_PLATFORM_INK[platform], new RegExp(ink.replace("#", "\\#")));
    }
    assert.equal(Object.keys(fillVsSand).length, 3);
  });

  it("hex lives in tokens — not in components/viz", () => {
    const hex = /#[0-9a-fA-F]{6}\b/;
    const tokenSource = readFileSync("lib/viz/tokens.ts", "utf8");
    for (const value of [...Object.values(VIZ_PLATFORM_FILL), ...Object.values(VIZ_PLATFORM_INK_HEX)]) {
      assert.match(tokenSource, new RegExp(value.replace("#", "\\#")));
    }
    const hits: string[] = [];
    for (const file of walkVizTsx()) {
      const body = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      if (hex.test(body)) hits.push(file);
    }
    assert.deepEqual(hits, [], hits.join("\n"));
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
    assert.match(source, /splitBarLegendPlacement/);
    assert.match(source, /PresetChip/);
  });

  it("places the legend inside at 12% and outside below", () => {
    assert.equal(splitBarLegendPlacement(12), "inside");
    assert.equal(splitBarLegendPlacement(11.9), "outside");
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
    assert.equal(momentGlyph("now"), "◐");
    assert.equal(momentGlyph("presale"), "⊙");
    assert.equal(momentGlyph("gen sale"), "★");
    assert.equal(momentGlyph("show"), "▲");
  });

  it("missing presale / gen-sale become dashed placeholders, never absent", () => {
    const from = now.getTime();
    const to = show.getTime();
    const onlyNowShow = [
      { id: "now", label: "now", at: now },
      { id: "show", label: "show", at: show },
    ];
    const placeholders = windowPlaceholders(onlyNowShow, from, to);
    assert.deepEqual(
      placeholders.map((row) => row.label),
      ["presale", "gen sale"],
    );
    assert.ok(placeholders.every((row) => row.tip.length > 0));
    assert.ok(placeholders[0]!.ratio > 0 && placeholders[0]!.ratio < 1);
    const source = readFileSync("components/viz/window-bar.tsx", "utf8");
    assert.match(source, /formatVizMoment/);
    assert.match(source, /formatVizRelative/);
    assert.match(source, /placeholder/);
    assert.doesNotMatch(source, /\d{4}-\d{2}-\d{2}T/);
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

  it("a failed thumb is a dashed slot plus the filename, never a broken-image icon", () => {
    const source = readFileSync("components/viz/asset-strip.tsx", "utf8");
    assert.match(source, /onError/);
    assert.match(source, /setBroken\(true\)/);
    assert.match(source, /border-dashed/);
    assert.match(source, /asset\.label/);
    assert.doesNotMatch(source, /broken-image|BrokenImage/);
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
    assert.match(source, /max-lg:inset-0/);
    assert.match(source, /lg:w-\[min\(880px,64vw\)\]/);
    assert.match(source, /bg-black\/40/);
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
