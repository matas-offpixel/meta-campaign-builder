/**
 * lib/dashboard/trend-registrations.ts
 *
 * Daily Trend registrations series — same source, same precedence as
 * the tracker REGS column (Cirqlin per-day → Mailchimp net-new → Meta).
 * The plotted line is a running sum from the signup-window start, so
 * it is Cirqlin's growth curve rather than a Mailchimp carry-forward.
 *
 * Reconstructed Mailchimp rows (`weighted_ramp_pre_snapshot` /
 * `linear_ramp_pre_snapshot`) are not measurements. They are excluded
 * from the series; a caption names the reconstructed range when one
 * exists so a fallback event cannot redraw the same lie.
 */

import {
  cirqlinSignupsForDay,
  hasCirqlinRegs,
} from "../cirqlin/tracker-signups.ts";
import type { CirqlinSnapshotRow } from "../cirqlin/types.ts";
import type { MailchimpSnapshotRow } from "../mailchimp/compute-registrations.ts";
import { netNewMailchimpRegistrationsForDay } from "../mailchimp/tracker-registrations.ts";

import { resolveSignupWindow } from "./signup-window.ts";

export type TrendRegistrationsSource = "cirqlin" | "mailchimp" | "meta";

export const TREND_REGS_PILL: Record<TrendRegistrationsSource, string> = {
  cirqlin: "Cirqlin",
  mailchimp: "Mailchimp",
  meta: "Meta",
};

export function isReconstructedMailchimpSnapshot(
  row: MailchimpSnapshotRow,
): boolean {
  const method = row.raw_json?.method;
  return (
    method === "weighted_ramp_pre_snapshot" ||
    method === "linear_ramp_pre_snapshot"
  );
}

export function measuredMailchimpSnapshots(
  rows: readonly MailchimpSnapshotRow[] | null | undefined,
): MailchimpSnapshotRow[] {
  if (!rows) return [];
  return rows.filter((row) => !isReconstructedMailchimpSnapshot(row));
}

export function reconstructedMailchimpRange(
  rows: readonly MailchimpSnapshotRow[] | null | undefined,
): { from: string; to: string } | null {
  if (!rows) return null;
  const days = rows
    .filter(isReconstructedMailchimpSnapshot)
    .map((row) => row.snapshot_at.slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day))
    .sort();
  if (days.length === 0) return null;
  return { from: days[0]!, to: days[days.length - 1]! };
}

export function trendRegistrationsSource(input: {
  cirqlinSnapshots?: readonly CirqlinSnapshotRow[] | null;
  mailchimpSnapshots?: readonly MailchimpSnapshotRow[] | null;
  isBrandCampaign?: boolean;
}): TrendRegistrationsSource {
  if (hasCirqlinRegs(input.cirqlinSnapshots)) return "cirqlin";
  if (
    !input.isBrandCampaign &&
    measuredMailchimpSnapshots(input.mailchimpSnapshots).length > 0
  ) {
    return "mailchimp";
  }
  return "meta";
}

/**
 * One day's REGS — identical to the tracker column so the chart's
 * increments match the table day for day.
 */
export function trendRegsForDay(input: {
  date: string;
  source: TrendRegistrationsSource;
  cirqlinSnapshots?: readonly CirqlinSnapshotRow[] | null;
  mailchimpSnapshots?: readonly MailchimpSnapshotRow[] | null;
  metaRegs?: number | null;
}): number | null {
  if (input.source === "cirqlin" && input.cirqlinSnapshots) {
    return cirqlinSignupsForDay(input.cirqlinSnapshots, input.date);
  }
  if (input.source === "mailchimp") {
    const measured = measuredMailchimpSnapshots(input.mailchimpSnapshots);
    if (measured.length === 0) return null;
    return netNewMailchimpRegistrationsForDay(measured, input.date);
  }
  return input.metaRegs ?? null;
}

export interface TrendRegistrationsSeries {
  source: TrendRegistrationsSource;
  pillSource: string;
  /** Per-day counts aligned to `dates` — tracker REGS for that day. */
  daily: Array<number | null>;
  /** Running sum from the window start. */
  cumulative: Array<number | null>;
  reconstructedCaption: string | null;
  windowStart: string | null;
}

export function buildTrendRegistrationsSeries(input: {
  dates: readonly string[];
  cirqlinSnapshots?: readonly CirqlinSnapshotRow[] | null;
  mailchimpSnapshots?: readonly MailchimpSnapshotRow[] | null;
  metaByDate?: ReadonlyMap<string, number | null>;
  isBrandCampaign?: boolean;
}): TrendRegistrationsSeries {
  const source = trendRegistrationsSource(input);
  const window =
    source === "cirqlin"
      ? resolveSignupWindow(input.cirqlinSnapshots)
      : { startDay: input.dates[0] ?? null };
  const start = window.startDay;
  const reconstructed = reconstructedMailchimpRange(input.mailchimpSnapshots);
  const reconstructedCaption =
    source === "mailchimp" && reconstructed
      ? `Mailchimp registrations ${fmtRange(reconstructed.from, reconstructed.to)} are reconstructed, not measured.`
      : null;

  const daily: Array<number | null> = [];
  const cumulative: Array<number | null> = [];
  let running = 0;
  let started = false;
  for (const date of input.dates) {
    if (start && date < start) {
      daily.push(null);
      cumulative.push(null);
      continue;
    }
    const value = trendRegsForDay({
      date,
      source,
      cirqlinSnapshots: input.cirqlinSnapshots,
      mailchimpSnapshots: input.mailchimpSnapshots,
      metaRegs: input.metaByDate?.get(date) ?? null,
    });
    daily.push(value);
    if (value != null) {
      running += value;
      started = true;
    }
    cumulative.push(started ? running : null);
  }

  return {
    source,
    pillSource: TREND_REGS_PILL[source],
    daily,
    cumulative,
    reconstructedCaption,
    windowStart: start,
  };
}

function fmtRange(from: string, to: string): string {
  const a = from.slice(8, 10).replace(/^0/, "");
  const b = to.slice(8, 10).replace(/^0/, "");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sept",
    "Oct",
    "Nov",
    "Dec",
  ];
  const fm = months[Number(from.slice(5, 7)) - 1] ?? from;
  const tm = months[Number(to.slice(5, 7)) - 1] ?? to;
  if (from === to) return `${a} ${fm}`;
  return `${a} ${fm} – ${b} ${tm}`;
}

/** Extra YYYY-MM-DD dates to prepend so the curve starts at the window. */
export function extraDaysBefore(
  existing: readonly string[],
  fromDay: string | null,
  untilDay: string | null,
): string[] {
  if (!fromDay || !untilDay || fromDay > untilDay) return [];
  const have = new Set(existing);
  const out: string[] = [];
  const cursor = new Date(`${fromDay}T00:00:00Z`);
  const end = new Date(`${untilDay}T00:00:00Z`);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime())) {
    return [];
  }
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.toISOString().slice(0, 10);
    if (!have.has(day)) out.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
