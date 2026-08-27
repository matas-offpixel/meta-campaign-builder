/**
 * End-date quick buttons resolve from events columns that actually exist.
 * Inventory (2026-08-27):
 *   - events.presale_at (timestamptz)
 *   - events.general_sale_at (timestamptz)
 *   - events.event_date (date)
 * d2c_event_copy and page_events have no sale/event dates.
 * There is no event_ad_plans table.
 */

import { localDateTimeParts } from "./schedule.ts";

export type EventEndAnchorId = "presale" | "general_sale" | "event";

export interface EventEndDateSource {
  eventDate?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
}

export interface EventEndAnchor {
  id: EventEndAnchorId;
  label: string;
  date: string;
}

/**
 * A column is present only when it has a real timestamp/date.
 * Empty, "null", whitespace, and unparseable values are absent.
 * Never fall back to event_date for a missing sale column.
 */
export function presentEventTimestamp(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === "null" || trimmed.toLowerCase() === "undefined") {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateTimeParts(parsed).date;
}

export function eventEndDateSourceFromOption(event: {
  eventDate?: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
} | null | undefined): EventEndDateSource {
  return {
    eventDate: event?.eventDate ?? null,
    presaleAt: event?.presaleAt ?? null,
    generalSaleAt: event?.generalSaleAt ?? null,
  };
}

export function resolveEventEndAnchors(event: EventEndDateSource | null | undefined): EventEndAnchor[] {
  if (!event) return [];
  const anchors: EventEndAnchor[] = [];
  const presale = presentEventTimestamp(event.presaleAt);
  if (presale) anchors.push({ id: "presale", label: "Presale", date: presale });
  const general = presentEventTimestamp(event.generalSaleAt);
  if (general) anchors.push({ id: "general_sale", label: "General sale", date: general });
  const eventDate = presentEventTimestamp(event.eventDate);
  if (eventDate) anchors.push({ id: "event", label: "Event date", date: eventDate });
  return anchors;
}
