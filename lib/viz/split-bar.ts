/**
 * SplitBar maths. Drag / keyboard edits reuse plan budget-split
 * linked adjustment (`splitLockedEdit`) so a moved boundary
 * renormalises to 100 without inventing a second rule.
 */

import {
  PLAN_BUDGET_PLATFORMS,
  splitLockedEdit,
  type PlanBudgetPlatform,
} from "../plan/budget-split.ts";
import type { VizPlatform } from "./tokens.ts";

export type SplitBarSegment = { platform: VizPlatform; pct: number };

export type SplitBarPreset = { label: string; pct: number[] };

export function asBudgetPlatform(platform: VizPlatform): PlanBudgetPlatform {
  return platform;
}

export function segmentsToBudget(segments: SplitBarSegment[]) {
  const budget = { totalDaily: 100, metaDaily: 0, tiktokDaily: 0, googleDaily: 0 };
  for (const segment of segments) {
    if (segment.platform === "meta") budget.metaDaily = segment.pct;
    if (segment.platform === "tiktok") budget.tiktokDaily = segment.pct;
    if (segment.platform === "google") budget.googleDaily = segment.pct;
  }
  return budget;
}

export function budgetToSegments(budget: {
  metaDaily: number;
  tiktokDaily: number;
  googleDaily: number;
}): SplitBarSegment[] {
  return PLAN_BUDGET_PLATFORMS.map((platform) => ({
    platform,
    pct:
      platform === "meta"
        ? budget.metaDaily
        : platform === "tiktok"
          ? budget.tiktokDaily
          : budget.googleDaily,
  })).filter((segment) => segment.pct > 0);
}

/**
 * Move the boundary after `boundaryIndex` by `deltaPct` points.
 * The left segment is the edited platform; remaining share is
 * split across the other selected platforms in their current ratio
 * (`splitLockedEdit`).
 */
export function moveSplitBoundary(
  segments: SplitBarSegment[],
  boundaryIndex: number,
  deltaPct: number,
): SplitBarSegment[] {
  const left = segments[boundaryIndex];
  if (!left) return segments;
  const selected = {
    meta: segments.some((s) => s.platform === "meta"),
    tiktok: segments.some((s) => s.platform === "tiktok"),
    google: segments.some((s) => s.platform === "google"),
  };
  const next = splitLockedEdit(
    segmentsToBudget(segments),
    selected,
    asBudgetPlatform(left.platform),
    left.pct + deltaPct,
    100,
  );
  return budgetToSegments(next);
}

export function applySplitPreset(
  platforms: VizPlatform[],
  pct: number[],
): SplitBarSegment[] {
  return platforms.map((platform, index) => ({
    platform,
    pct: pct[index] ?? 0,
  })).filter((segment) => segment.pct > 0);
}

export function splitMatchesPreset(
  segments: SplitBarSegment[],
  preset: SplitBarPreset,
  platforms: VizPlatform[],
): boolean {
  return platforms.every((platform, index) => {
    const found = segments.find((segment) => segment.platform === platform);
    return Math.round(found?.pct ?? 0) === Math.round(preset.pct[index] ?? 0);
  });
}

export function splitProvenance(
  segments: SplitBarSegment[],
  presets: SplitBarPreset[] | undefined,
  platforms: VizPlatform[],
): "derived" | "manual entry" {
  if (!presets?.length) return "manual entry";
  return presets.some((preset) => splitMatchesPreset(segments, preset, platforms))
    ? "derived"
    : "manual entry";
}

export function boundaryCount(segments: SplitBarSegment[]): number {
  return Math.max(0, segments.length - 1);
}
