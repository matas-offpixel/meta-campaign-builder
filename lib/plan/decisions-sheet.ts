/**
 * Decisions sheet — pure presentation over `DecisionRowView`.
 *
 * Read surface only. Does not import evaluate.ts / tick-runner.ts /
 * gates.ts / apply.ts. Why-lines and glyphs are derived from fields
 * the row already carries; missing facts (cooldown-until, provenance,
 * delta percent, rule thresholds) are inferred, never invented in the
 * evaluator.
 */

import { MIN_CONVERSION_RESULT_COUNT } from "../optimisation/evaluate-windows.ts";
import { presetVersionLabel } from "../optimisation/presets.ts";
import type { DecisionRowView } from "../optimisation/automation-ui.ts";
import { isVizAction, type VizAction, type VizProvenance } from "../viz/tokens.ts";

export const DECISIONS_RECENT_DAYS = 7;
export const TICK_CADENCE_HOURS = 4;

export const DECISIONS_SHEET_COPY = {
  title: "decisions · last 7d",
  older: "older",
  preset: "preset",
  edit: "edit ↗",
  empty: "◌ no decisions yet",
  driftTip: (kept: string) =>
    `preset changed since launch; campaign keeps ${kept}`,
} as const;

export interface DecisionDayGroup {
  dayKey: string;
  rows: DecisionRowView[];
}

export interface GroupedDecisions {
  recent: DecisionDayGroup[];
  older: DecisionDayGroup[];
}

export function glyphActionFor(action: string): VizAction {
  if (action === "skipped_cooldown") return "skip_recent_touch";
  if (action.startsWith("skip_")) return isVizAction(action) ? action : "skip_dormant";
  if (isVizAction(action)) return action;
  return "maintain";
}

export function isHonestEmptyAction(action: string): boolean {
  return (
    action === "metric_unavailable" ||
    action === "insufficient_conversions" ||
    action === "skip_recent_touch" ||
    action === "skipped_cooldown" ||
    action === "skip_dormant" ||
    action === "skip_no_rules" ||
    action.startsWith("skip_")
  );
}

export function bandDashedFor(action: string): boolean {
  return action === "metric_unavailable";
}

/**
 * Why-cell — the rule's own terms, one line, no verb phrase.
 *
 * Fields not on `DecisionRowView` (and what we do instead):
 * - cooldown until → parse `reasonText` + `decidedAt`
 * - delta percent → budget before/after, else `reasonText` `%`
 * - "above ceiling" / "in band" → `reasonText` / action
 * - `skipped_cooldown` → evaluate writes `skip_recent_touch`
 */
export function whyForDecision(row: DecisionRowView, now: Date = new Date()): string {
  if (row.action === "metric_unavailable") return "no reads yet";
  if (row.action === "insufficient_conversions") {
    const n = row.resultCount ?? parseLeadingCount(row.reasonText) ?? 0;
    return `${n}/${MIN_CONVERSION_RESULT_COUNT} conv · insufficient`;
  }
  if (row.action === "skip_recent_touch" || row.action === "skipped_cooldown") {
    const until = cooldownUntilIso(row);
    return until
      ? `cooldown · until ${compactRelative(until, now, true)}`
      : "cooldown";
  }
  if (row.action === "skip_dormant") return "dormant";
  if (row.action === "skip_no_rules") return "no rules";

  const ceiling = /ceiling/i.test(row.reasonText);
  const delta = deltaLabel(row);
  if (ceiling) {
    if (delta && row.action !== "maintain" && row.action !== "pause") {
      return `${delta} · above ceiling`;
    }
    return "above ceiling";
  }
  if (row.action === "maintain") return "in band";

  const evidence = conversionEvidence(row);
  if (row.action === "scale_up" || row.action === "scale_down") {
    if (delta && evidence) return `${delta} · ${evidence}`;
    if (delta) return delta;
    if (evidence) return evidence;
    return row.action === "scale_up" ? "+0%" : "−0%";
  }
  if (row.action === "pause") return "pause";
  return "in band";
}

export function metricChipText(row: DecisionRowView): string {
  const metric = row.metric || "—";
  const window = row.metricWindow || "24h";
  if (row.action === "metric_unavailable") {
    return `${metric} · — / ${window}`;
  }
  if (
    row.action === "insufficient_conversions" ||
    row.action === "skip_recent_touch" ||
    row.action === "skipped_cooldown" ||
    row.action === "skip_dormant" ||
    row.action === "skip_no_rules"
  ) {
    return "—";
  }
  if (row.metricValue == null) return "—";
  const n = row.resultCount != null ? String(row.resultCount) : "—";
  return `${metric} ${formatMetricValue(row.metricValue)} · ${n} / ${window}`;
}

/**
 * The row does not carry a provenance column. Platform readings are
 * `plat`; honest empties are `┄` (`not instrumented`).
 */
export function provenanceForDecision(row: DecisionRowView): VizProvenance {
  return isHonestEmptyAction(row.action) ? "not instrumented" : "platform-reported";
}

export function provenanceMarkForDecision(row: DecisionRowView): string {
  return isHonestEmptyAction(row.action) ? "┄" : "plat";
}

export function compactRelative(
  iso: string,
  now: Date = new Date(),
  asFuture = false,
): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return asFuture ? "soon" : "now";
  const deltaMs = then - now.getTime();
  if (asFuture && deltaMs <= 0) return "soon";
  const abs = Math.abs(deltaMs);
  const minutes = Math.round(abs / 60_000);
  if (minutes < 1) return asFuture ? "now" : "now";
  if (minutes < 60) return asFuture ? `in ${minutes}m` : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return asFuture ? `in ${hours}h` : `${hours}h`;
  const days = Math.round(hours / 24);
  return asFuture ? `in ${days}d` : `${days}d`;
}

export function groupDecisions(
  rows: readonly DecisionRowView[],
  now: Date = new Date(),
): GroupedDecisions {
  const sorted = [...rows].sort((a, b) => {
    if (a.decidedAt === b.decidedAt) return 0;
    return a.decidedAt < b.decidedAt ? 1 : -1;
  });
  const cutoff = now.getTime() - DECISIONS_RECENT_DAYS * 86_400_000;
  const recent: DecisionRowView[] = [];
  const older: DecisionRowView[] = [];
  for (const row of sorted) {
    const at = Date.parse(row.decidedAt);
    if (Number.isFinite(at) && at < cutoff) older.push(row);
    else recent.push(row);
  }
  return { recent: bucketByDay(recent), older: bucketByDay(older) };
}

export function emptyDecisionsStatus(
  lastEvaluatedAt: string | null,
  now: Date = new Date(),
): string {
  if (!lastEvaluatedAt) return DECISIONS_SHEET_COPY.empty;
  const started = Date.parse(lastEvaluatedAt);
  if (!Number.isFinite(started)) return DECISIONS_SHEET_COPY.empty;
  const next = new Date(started + TICK_CADENCE_HOURS * 3_600_000).toISOString();
  return `${DECISIONS_SHEET_COPY.empty} · next tick ${compactRelative(next, now, true)}`;
}

export function presetDriftLabel(
  materialisedVersion: number | null | undefined,
  liveVersion: number | null | undefined,
): string | null {
  if (materialisedVersion == null || liveVersion == null) return null;
  if (liveVersion <= materialisedVersion) return null;
  return `${presetVersionLabel(materialisedVersion)} → ${presetVersionLabel(liveVersion)}`;
}

export function cooldownUntilIso(row: Pick<DecisionRowView, "decidedAt" | "reasonText">): string | null {
  const match = row.reasonText.match(
    /Touched ([\d.]+)h ago — inside the ([\d.]+)h cooldown/i,
  );
  if (!match) return null;
  const hoursAgo = Number(match[1]);
  const cooldownHours = Number(match[2]);
  const decided = Date.parse(row.decidedAt);
  if (!Number.isFinite(hoursAgo) || !Number.isFinite(cooldownHours) || !Number.isFinite(decided)) {
    return null;
  }
  return new Date(decided + (cooldownHours - hoursAgo) * 3_600_000).toISOString();
}

function bucketByDay(rows: readonly DecisionRowView[]): DecisionDayGroup[] {
  const buckets = new Map<string, DecisionRowView[]>();
  for (const row of rows) {
    const key = londonDayKey(row.decidedAt);
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([dayKey, grouped]) => ({
    dayKey,
    rows: grouped,
  }));
}

function londonDayKey(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "unknown";
  return new Date(at).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function conversionEvidence(row: DecisionRowView): string | null {
  if (row.resultCount == null) return null;
  return `${row.resultCount} conv ≥ ${MIN_CONVERSION_RESULT_COUNT}`;
}

function deltaLabel(row: DecisionRowView): string | null {
  if (
    row.budgetBeforePence != null &&
    row.budgetAfterPence != null &&
    row.budgetBeforePence > 0
  ) {
    const pct = Math.round(
      ((row.budgetAfterPence - row.budgetBeforePence) / row.budgetBeforePence) * 100,
    );
    if (pct === 0) return null;
    return pct > 0 ? `+${pct}%` : `${pct}%`;
  }
  const match = row.reasonText.match(/([+-]\d+(?:\.\d+)?)%/);
  return match ? `${match[1]}%` : null;
}

function parseLeadingCount(reason: string): number | null {
  const match = reason.match(/(\d+)\s*\/\s*\d+/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function formatMetricValue(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(2)));
}
