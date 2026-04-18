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
