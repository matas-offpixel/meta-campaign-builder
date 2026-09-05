/**
 * Zones B, C and D — the three things the operator actually adjusts.
 *
 * Window (B), budget split (C) and target (D). Everything else on the
 * canvas is a fact or a badge, so everything else is elsewhere.
 */

import type { PlanTargetUnit } from "../types.ts";
import type { AssetStripItem } from "../viz/asset-strip.ts";
import type { SplitBarPreset, SplitBarSegment } from "../viz/split-bar.ts";
import type { WindowMoment } from "../viz/window-bar.ts";
import type { VizPlatform, VizProvenance } from "../viz/tokens.ts";
import type { RoutingMatrixRow } from "./asset-routing.ts";
import {
  allocateByWeights,
  emptySelection,
  PLAN_BUDGET_PRESETS,
  nominalPresetLabel,
  type PlanBudgetPlatform,
} from "./budget-split.ts";
import { presentEventTimestamp } from "./event-end-dates.ts";
import { localDateTimeParts, resolveStartNow } from "./schedule.ts";
import { defaultUnitForObjective, targetUnitSpec } from "./target-unit.ts";
import type { CampaignObjective } from "../types.ts";
import type { CampaignPlanBudgetSplit } from "./types.ts";

// ── Zone B · window ────────────────────────────────────────────────────

export interface PlanWindowEvent {
  eventDate?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
}

function parseMoment(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The moments are facts of the event, not inputs (§2 zone B). `now` is
 * always first so the bar has a left edge even for an event with no
 * dates at all.
 */
export function planWindowMoments(
  event: PlanWindowEvent | null | undefined,
  now: Date = new Date(),
): WindowMoment[] {
  const moments: WindowMoment[] = [{ id: "now", label: "now", at: now }];
  const presale = parseMoment(event?.presaleAt);
  if (presale) moments.push({ id: "presale", label: "presale", at: presale });
  const general = parseMoment(event?.generalSaleAt);
  if (general) moments.push({ id: "gen-sale", label: "gen sale", at: general });
  const show = parseMoment(event?.eventDate);
  if (show) moments.push({ id: "show", label: "show", at: show });
  return moments.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface PlanWindowDates {
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
}

/**
 * Default start = now (through `resolveStartNow`, so the 15-minute
 * buffer semantics survive the datetime fields being deleted); default
 * end = the show. An event with no date leaves end null rather than
 * inventing one.
 */
export function planDefaultWindow(
  event: PlanWindowEvent | null | undefined,
  now: Date = new Date(),
): PlanWindowDates {
  const start = resolveStartNow(now);
  const show = presentEventTimestamp(event?.eventDate);
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: show,
    endTime: show ? "23:59" : null,
  };
}

/** Stored date+time → the `Date` the two `WindowBar` handles sit on. */
export function planWindowHandles(
  dates: PlanWindowDates,
  event: PlanWindowEvent | null | undefined,
  now: Date = new Date(),
): { start: Date; end: Date } {
  const fallback = planDefaultWindow(event, now);
  const start =
    parseMoment(composeLocal(dates.startDate, dates.startTime)) ??
    parseMoment(composeLocal(fallback.startDate, fallback.startTime)) ??
    now;
  const end =
    parseMoment(composeLocal(dates.endDate, dates.endTime)) ??
    parseMoment(composeLocal(fallback.endDate, fallback.endTime)) ??
    new Date(start.getTime() + 7 * 86_400_000);
  return { start, end: end > start ? end : new Date(start.getTime() + 3_600_000) };
}

const DAY_MS = 86_400_000;

export type PlanWindowValidity = {
  ok: boolean;
  reason: "set start and end" | null;
};

/**
 * Stored window only — never invents or rewrites dates.
 * end > start + 1 day; start not more than a day before creation;
 * end ≤ show. Missing or unparseable dates fail the same way.
 */
export function planWindowValidity(
  dates: PlanWindowDates,
  event: PlanWindowEvent | null | undefined,
  opts: { now?: Date; createdAt?: Date | string | null } = {},
): PlanWindowValidity {
  const now = opts.now ?? new Date();
  const start = parseMoment(composeLocal(dates.startDate, dates.startTime));
  const end = parseMoment(composeLocal(dates.endDate, dates.endTime));
  const fail: PlanWindowValidity = { ok: false, reason: "set start and end" };
  if (!start || !end) return fail;
  if (end.getTime() <= start.getTime() + DAY_MS) return fail;
  const created =
    opts.createdAt instanceof Date
      ? (Number.isNaN(opts.createdAt.getTime()) ? null : opts.createdAt)
      : parseMoment(opts.createdAt ?? null);
  const creation = created ?? now;
  if (start.getTime() < creation.getTime() - DAY_MS) return fail;
  const show = parseShowLatest(event?.eventDate);
  if (show && end.getTime() > show.getTime()) return fail;
  return { ok: true, reason: null };
}

/** Date-only show days count as the end of that day, so 23:59 on the show is valid. */
function parseShowLatest(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return parseMoment(`${trimmed}T23:59:00`);
  }
  return parseMoment(trimmed);
}

function composeLocal(date: string | null, time: string | null): string | null {
  if (!date) return null;
  return `${date.slice(0, 10)}T${time?.trim() || "00:00"}:00`;
}

/** A dragged handle back to the stored `YYYY-MM-DD` + `HH:MM` pair. */
export function planWindowFromHandles(next: { start: Date; end: Date }): PlanWindowDates {
  const start = localDateTimeParts(next.start);
  const end = localDateTimeParts(next.end);
  return {
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
  };
}

// ── Zone C · budget ────────────────────────────────────────────────────

export const PLAN_SPLIT_PLATFORMS: PlanBudgetPlatform[] = ["meta", "tiktok", "google"];

/** `lib/plan/budget-split.ts` presets, in `SplitBar`'s vocabulary. */
export const PLAN_SPLIT_PRESETS: SplitBarPreset[] = PLAN_BUDGET_PRESETS.map((preset) => ({
  label: nominalPresetLabel(preset.id),
  pct: [preset.meta, preset.tiktok, preset.google],
}));

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

export function planSplitSegments(budget: CampaignPlanBudgetSplit): SplitBarSegment[] {
  const total = budget.metaDaily + budget.tiktokDaily + budget.googleDaily;
  if (total <= 0) {
    return PLAN_SPLIT_PRESETS[1]!.pct.map((value, index) => ({
      platform: PLAN_SPLIT_PLATFORMS[index] as VizPlatform,
      pct: value,
    }));
  }
  return [
    { platform: "meta", pct: pct(budget.metaDaily, total) },
    { platform: "tiktok", pct: pct(budget.tiktokDaily, total) },
    { platform: "google", pct: pct(budget.googleDaily, total) },
  ];
}

/**
 * Segments back to money. A platform dragged to 0% gets £0, which is the
 * off switch — `budgetedLaunchAdapters` already skips it, so there is no
 * separate toggle state to keep in sync.
 */
export function planSplitToBudget(
  segments: SplitBarSegment[],
  total: number,
): CampaignPlanBudgetSplit {
  const weights: Record<PlanBudgetPlatform, number> = { meta: 0, tiktok: 0, google: 0 };
  for (const segment of segments) {
    if (segment.platform === "meta" || segment.platform === "tiktok" || segment.platform === "google") {
      weights[segment.platform] = Math.max(0, segment.pct);
    }
  }
  const selection = {
    meta: weights.meta > 0,
    tiktok: weights.tiktok > 0,
    google: weights.google > 0,
  };
  const anyOn = selection.meta || selection.tiktok || selection.google;
  return allocateByWeights(total, weights, anyOn ? selection : emptySelection(false));
}

/** The `96 · 18 · 6` line under the bar — money, not percent. */
export function planSplitAmountsLine(budget: CampaignPlanBudgetSplit): string {
  return [budget.metaDaily, budget.tiktokDaily, budget.googleDaily]
    .filter((amount) => amount > 0)
    .map((amount) => String(Math.round(amount)))
    .join(" · ");
}

export function planBudgetProvenance(hasUserEdit: boolean): VizProvenance {
  return hasUserEdit ? "manual entry" : "derived";
}

// ── Zone D · target ────────────────────────────────────────────────────

export const PLAN_TARGET_UNITS: PlanTargetUnit[] = [
  "reg",
  "click",
  "lpv",
  "purchase",
  "view",
];

/**
 * Migration path for the plans that predate `target_unit` (migration
 * 165): they carry an `objectiveIntent` and no unit, and would otherwise
 * all render `— · no unit` even though their objective names a unit
 * perfectly well. `engagement` is the one intent with no unit, which is
 * exactly the state §2 says the objective picker exists for.
 *
 * The inferred unit is never written back — the operator's first tap on
 * the picker is what stores one.
 */
export function planEffectiveTargetUnit(
  unit: PlanTargetUnit | null | undefined,
  objectiveIntent: CampaignObjective | null | undefined,
): { unit: PlanTargetUnit | null; inferred: boolean } {
  if (unit) return { unit, inferred: false };
  const fallback = objectiveIntent ? defaultUnitForObjective(objectiveIntent) : null;
  return { unit: fallback, inferred: fallback != null };
}

export interface PlanTargetChip {
  /** `◎ £1.20 / reg`, or `— · no unit` when the objective has no cost-per. */
  label: string;
  provenance: VizProvenance;
  /** True in the engagement / no-unit state, where the objective is picked directly. */
  needsObjective: boolean;
  /** True when the number shown is the preset's benchmark, not the operator's. */
  seeded: boolean;
}

/**
 * Never an empty field (§2 zone D). A plan with no target renders the
 * preset's benchmark with the seed badge, so the chip always shows a
 * number the operator can react to.
 */
export function planTargetChip(input: {
  value: number | null;
  unit: PlanTargetUnit | null;
  /** The client preset's benchmark for this unit, when the plan has no target. */
  benchmark?: number | null;
  currency?: string;
}): PlanTargetChip {
  const symbol = input.currency ?? "£";
  if (!input.unit) {
    return {
      label: "— · no unit",
      provenance: "not instrumented",
      needsObjective: true,
      seeded: false,
    };
  }
  const spec = targetUnitSpec(input.unit);
  const seeded = input.value == null;
  const amount = input.value ?? input.benchmark ?? null;
  if (amount == null) {
    return {
      label: `◎ — / ${spec.label}`,
      provenance: "not instrumented",
      needsObjective: false,
      seeded: true,
    };
  }
  return {
    label: `◎ ${symbol}${formatTarget(amount)} / ${spec.label}`,
    // A benchmark stands in until the operator types one — it is a seed, not a model.
    provenance: seeded ? "industry seed" : "manual entry",
    needsObjective: false,
    seeded,
  };
}

function formatTarget(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(2);
}

// ── Zone F · assets ───────────────────────────────────────────────────

/**
 * The routing matrix reduced to one line (§2 zone F). Meta is always lit
 * because Meta is where the asset was uploaded; TikTok is the only real
 * toggle; Google takes no assets, so `AssetStrip` renders it dashed
 * rather than as a red cross.
 */
export function assetStripFromMatrix(rows: readonly RoutingMatrixRow[]): {
  assets: AssetStripItem[];
  routing: Record<string, VizPlatform[]>;
  disabledReasons: Record<string, Partial<Record<VizPlatform, string>>>;
} {
  const assets: AssetStripItem[] = [];
  const routing: Record<string, VizPlatform[]> = {};
  const disabledReasons: Record<string, Partial<Record<VizPlatform, string>>> = {};

  for (const row of rows) {
    const id = row.asset.id;
    assets.push({
      id,
      label: row.asset.filename,
      aspect: row.asset.aspectRatio,
      thumbUrl: row.asset.thumbnailUrl,
      mediaKind: row.asset.mediaKind,
    });
    routing[id] = row.tiktok.enabled ? ["meta", "tiktok"] : ["meta"];
    if (row.tiktok.disabled && row.tiktok.disabledReason) {
      disabledReasons[id] = { tiktok: row.tiktok.disabledReason };
    }
  }
  return { assets, routing, disabledReasons };
}
