/**
 * Pure date / palette helpers shared across dashboard surfaces.
 *
 * Two kinds of date strings flow through the dashboard:
 *  - "yyyy-mm-dd" date-only values (e.g. events.event_date)
 *  - full ISO timestamps (e.g. events.event_start_at, announcement_at)
 *
 * Date-only strings are parsed as local midnight to avoid TZ drift
 * (otherwise "2026-04-19" would render as "18 Apr" west of UTC).
 * Full ISO strings are parsed as-is.
 *
 * Keep this file dependency-free and pure — no React, no Supabase,
 * no Date.now() at module scope.
 */

import type { EventWithClient } from "@/lib/db/events";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFlexible(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = DATE_ONLY_RE.test(iso) ? new Date(iso + "T00:00:00") : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse a "yyyy-mm-dd" date-only string. Returns null for any other shape. */
export function parseDateOnly(iso: string | null | undefined): Date | null {
  if (!iso || !DATE_ONLY_RE.test(iso)) return null;
  return parseFlexible(iso);
}

/** Parse a full ISO timestamp. Returns null when missing or invalid. */
export function parseTs(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Long date — "1 May 2026". Accepts date-only or full ISO. */
export function fmtDate(iso: string | null | undefined): string {
  const d = parseFlexible(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Short date — "1 May". Accepts date-only or full ISO. */
export function fmtShort(iso: string | null | undefined): string {
  const d = parseFlexible(iso);
  if (!d) return "—";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Date + time — "1 May 2026, 19:30". Accepts date-only or full ISO. */
export function fmtDateTime(iso: string | null | undefined): string {
  const d = parseFlexible(iso);
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Long date from an in-memory Date instance. */
export function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Local-midnight Date for the current calendar day. */
export function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Whole days between two dates (b - a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Friendly relative label vs today: "Today" / "Tomorrow" /
 * "In N days" (within a week) / "Yesterday" / falls back to fmtDay.
 */
export function fmtRelative(eventDate: Date): string {
  const diff = daysBetween(today(), eventDate);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff > 1 && diff <= 7) return `In ${diff} days`;
  if (diff === -1) return "Yesterday";
  return fmtDay(eventDate);
}

// ─── Milestone palette ───────────────────────────────────────────────────────
//
// Shared across the calendar, event detail page, and any future timeline
// surface. Keep label + colour together so a new milestone kind only needs
// to be added in one place.

export type MilestoneKind = "announcement" | "presale" | "general-sale" | "event";

export const MILESTONE_KINDS: MilestoneKind[] = [
  "announcement",
  "presale",
  "general-sale",
  "event",
];

export const MILESTONE_LABEL: Record<MilestoneKind, string> = {
  announcement: "Announce",
  presale: "Presale",
  "general-sale": "Gen sale",
  event: "Event",
};

export const MILESTONE_COLOR: Record<MilestoneKind, string> = {
  announcement: "bg-sky-500",
  presale: "bg-amber-500",
  "general-sale": "bg-violet-500",
  event: "bg-foreground",
};

// ─── Next milestone ──────────────────────────────────────────────────────────

/**
 * Resolve the soonest upcoming milestone for an event.
 *
 * Pure: `now` is required so the helper has no implicit time dependency.
 * Callers in client components should source `now` via
 * `useState(() => new Date())` to satisfy the React 19 purity rule.
 *
 * Skips milestones whose calendar day is strictly before `now`'s calendar
 * day (so a milestone falling earlier today still counts as future).
 * Returns `null` when every milestone is missing or in the past.
 */
export function nextMilestone(
  event: EventWithClient,
  now: Date,
): {
  kind: MilestoneKind;
  label: string;
  at: Date;
  daysAway: number;
} | null {
  const sources: Array<{ kind: MilestoneKind; iso: string | null }> = [
    { kind: "announcement", iso: event.announcement_at },
    { kind: "presale", iso: event.presale_at },
    { kind: "general-sale", iso: event.general_sale_at },
    // Prefer the precise start time when present; fall back to the
    // date-only event_date (parsed as local midnight by parseFlexible).
    { kind: "event", iso: event.event_start_at ?? event.event_date },
  ];

  const todayMidnight = midnightOf(now);

  const candidates = sources
    .map((s) => ({ kind: s.kind, at: parseFlexible(s.iso) }))
    .filter((c): c is { kind: MilestoneKind; at: Date } => c.at != null)
    .map((c) => ({
      kind: c.kind,
      at: c.at,
      daysAway: daysBetween(todayMidnight, midnightOf(c.at)),
    }))
    .filter((c) => c.daysAway >= 0)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  const next = candidates[0];
  if (!next) return null;
  return {
    kind: next.kind,
    label: MILESTONE_LABEL[next.kind],
    at: next.at,
    daysAway: next.daysAway,
  };
}

/** Local-midnight copy of a Date. Pure — does not mutate the input. */
export function midnightOf(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ─── Milestone-kind URL parsing ──────────────────────────────────────────────

/**
 * Parse a `?kinds=` searchParam value (string, string[] from Next, or
 * undefined) into either the literal "all" sentinel or a validated
 * subset of MILESTONE_KINDS.
 *
 * Returns "all" for: missing param, empty value, the literal "all", or
 * any input that yields zero valid kinds after whitelisting. Unknown
 * tokens are silently dropped — the URL stays a soft suggestion, never
 * an error path.
 */
export function parseMilestoneKinds(
  value: string | string[] | undefined,
): MilestoneKind[] | "all" {
  if (!value) return "all";
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || v === "all") return "all";
  const requested = v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const validSet = new Set<string>(MILESTONE_KINDS);
  const valid = requested.filter((s): s is MilestoneKind => validSet.has(s));
  return valid.length === 0 ? "all" : valid;
}

// ─── Calendar URL parsing ────────────────────────────────────────────────────

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Parse `?m=YYYY-MM` into a local-midnight Date pinned to day 1 of that
 * month. Returns null on missing or malformed input — callers should
 * fall back to the current month.
 */
export function parseMonth(value: string | string[] | undefined): Date | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !MONTH_RE.test(v)) return null;
  const [year, month] = v.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as `YYYY-MM` for the `?m=` param. */
export function fmtMonthParam(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export type CalendarView = "month" | "agenda";

const CALENDAR_VIEWS: CalendarView[] = ["month", "agenda"];

/**
 * Parse `?view=` into a CalendarView, defaulting to "month" for missing
 * or unknown values.
 */
export function parseCalendarView(
  value: string | string[] | undefined,
): CalendarView {
  const v = Array.isArray(value) ? value[0] : value;
  return CALENDAR_VIEWS.includes(v as CalendarView)
    ? (v as CalendarView)
    : "month";
}
