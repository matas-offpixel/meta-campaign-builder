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

/**
 * Format a number as £-prefixed GBP with always-two decimals.
 * Used by the marketing-plan computed columns and stat cards so the
 * grid/header/cards stay consistent against the same currency contract.
 */
export function fmtCurrency(n: number): string {
  return n.toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

/**
 * Long date with full weekday name — "19 Apr 2026 · Saturday".
 *
 * Built in two locale calls (rather than one with both `weekday` and
 * `day` set) because Intl in en-GB renders weekday-first ("Saturday 19
 * Apr 2026") when both are requested; we want the date to lead so the
 * column sorts visually like a date column.
 */
export function fmtDayWithWeekday(d: Date): string {
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  return `${date} · ${weekday}`;
}

/** True if `d` falls on Saturday or Sunday. Local-tz Date only. */
export function isWeekend(d: Date): boolean {
  const wd = d.getDay();
  return wd === 0 || wd === 6;
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
 * Days-until-event label for the event-detail header pill.
 *
 * Distinct from fmtRelative because:
 *   - Lowercase forms ("today", "tomorrow", "in 23 days") match a pill
 *     register, not the title-cased one /today/ uses.
 *   - Past dates extend indefinitely as "N days ago", whereas
 *     fmtRelative only handles "Yesterday" then falls back to fmtDay.
 *   - Returns null (rather than "—") when no date is supplied so the
 *     caller can hide the pill entirely.
 *
 * `now` is required so callers can sample it via useState lazy
 * initializer at mount and keep React 19 effect-purity happy.
 */
export function fmtDaysUntilEvent(
  iso: string | null | undefined,
  now: Date,
): { label: string; isPast: boolean } | null {
  const eventDate = parseFlexible(iso);
  if (!eventDate) return null;

  const diff = daysBetween(midnightOf(now), midnightOf(eventDate));
  if (diff === 0) return { label: "today", isPast: false };
  if (diff === 1) return { label: "tomorrow", isPast: false };
  if (diff > 1) return { label: `in ${diff} days`, isPast: false };
  if (diff === -1) return { label: "1 day ago", isPast: true };
  return { label: `${Math.abs(diff)} days ago`, isPast: true };
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

const DATE_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Parse a `?date=YYYY-MM-DD` URL param into a canonical date-only string.
 *
 * Two-pass validation:
 *   1. Regex rejects anything that isn't shaped YYYY-MM-DD with month 01–12
 *      and day 01–31 (catches "2026-13-05", "2026-02-32", etc).
 *   2. Round-trip through `new Date(year, month-1, day)` and re-derive the
 *      day to reject otherwise-shaped-correctly impossible dates like
 *      2026-02-31 (which JS would silently roll forward to 2026-03-03).
 *
 * Returns the original string when valid (canonical form), or null.
 */
export function parseDateParam(
  value: string | string[] | undefined,
): string | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !DATE_PARAM_RE.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  if (
    probe.getFullYear() !== y ||
    probe.getMonth() !== m - 1 ||
    probe.getDate() !== d
  ) {
    return null;
  }
  return v;
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

// ─── Generic URL param validators ────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a UUID URL param. Returns the canonical lowercase form on
 * success, null on missing or malformed input. Used for `?client=`,
 * `?event=`, etc.
 */
export function parseUuid(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !UUID_RE.test(v)) return null;
  return v.toLowerCase();
}

/**
 * Read a `?q=` text-search param: trim, return the literal string or
 * null if empty/missing. Caller is responsible for any DB-side escaping;
 * the recommended pattern for substring search is to apply structured
 * filters at the Supabase query level and the q filter in memory after
 * fetch (per-user dataset is bounded by RLS scope).
 */
export function parseQuery(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Read a `?pendingAction=1` boolean toggle. Only the literal "1" counts
 * as truthy — any other value (including "true") is treated as absent
 * to keep the URL contract narrow.
 */
export function parsePendingAction(
  value: string | string[] | undefined,
): boolean {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "1";
}

// ─── Domain-specific status whitelists ───────────────────────────────────────
//
// These intentionally hard-code the string lists rather than importing
// EVENT_STATUSES / CLIENT_STATUSES from lib/db/* to keep this module
// dependency-free at runtime — same convention as MILESTONE_KINDS above.
// The lists are mirrored against the DB types via the type assertions
// below so a drift in either direction will fail the build.

const EVENT_STATUS_WHITELIST = [
  "upcoming",
  "announced",
  "on_sale",
  "sold_out",
  "completed",
  "cancelled",
] as const;
export type EventStatusParam = (typeof EVENT_STATUS_WHITELIST)[number];

export function parseEventStatus(
  value: string | string[] | undefined,
): EventStatusParam | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  return EVENT_STATUS_WHITELIST.includes(v as EventStatusParam)
    ? (v as EventStatusParam)
    : null;
}

const CLIENT_STATUS_WHITELIST = ["active", "paused", "archived"] as const;
export type ClientStatusParam = (typeof CLIENT_STATUS_WHITELIST)[number];

export function parseClientStatus(
  value: string | string[] | undefined,
): ClientStatusParam | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  return CLIENT_STATUS_WHITELIST.includes(v as ClientStatusParam)
    ? (v as ClientStatusParam)
    : null;
}

// ─── Event-detail tab URL parsing ────────────────────────────────────────────
//
// Kept here (not in event-detail-tabs.tsx) so the server page
// can call parseEventTab without importing from a "use client" module.

export type EventTab =
  | "overview"
  | "plan"
  | "campaigns"
  | "reporting"
  | "activity"
  | "active-creatives";

const VALID_EVENT_TABS: EventTab[] = [
  "overview",
  "plan",
  "campaigns",
  "reporting",
  "activity",
  "active-creatives",
];

/** Parse `?tab=` into a validated EventTab, defaulting to "overview". */
export function parseEventTab(
  value: string | string[] | undefined,
): EventTab {
  const v = Array.isArray(value) ? value[0] : value;
  return VALID_EVENT_TABS.includes(v as EventTab)
    ? (v as EventTab)
    : "overview";
}

// ─── Doors / start-time helpers ──────────────────────────────────────────────
//
// event_start_at is stored as a full ISO timestamp but the form collects
// only the wall-clock time (HH:MM) and combines it with event_date on
// submit. Tz-aware handling is deferred tech debt.

/**
 * Combine a YYYY-MM-DD date and an HH:MM time into an ISO-like string
 * (`YYYY-MM-DDTHH:MM:00`) suitable for a timestamptz column.
 * Returns empty string when either argument is missing.
 */
export function combineDateAndTime(date: string, time: string): string {
  if (!date || !time) return "";
  return `${date}T${time}:00`;
}

/**
 * Extract the HH:MM portion from a stored ISO timestamp or datetime-local
 * string. Returns "" when the input is null/empty or doesn't match.
 */
export function extractTimeFromIso(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/T(\d{2}:\d{2})/);
  return m ? m[1] : "";
}

// ─── Pending-action criteria (shared with /today panel) ──────────────────────
//
// "Pending action" = active event with an imminent milestone (within
// PENDING_HORIZON_DAYS days, today inclusive) and no campaign draft
// linked yet. Centralised here so the /today panel and the /events
// ?pendingAction=1 filter stay in lockstep.

export const PENDING_HORIZON_DAYS = 21;
export const PENDING_ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  "upcoming",
  "announced",
  "on_sale",
]);

export function isPendingAction(
  event: EventWithClient,
  draftMap: Map<string, { id: string; updated_at: string }>,
  now: Date,
): boolean {
  if (!PENDING_ACTIVE_STATUSES.has(event.status)) return false;
  if (draftMap.has(event.id)) return false;
  const ms = nextMilestone(event, now);
  if (!ms) return false;
  return ms.daysAway >= 0 && ms.daysAway <= PENDING_HORIZON_DAYS;
}
