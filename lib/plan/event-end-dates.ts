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

function dateFromIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateTimeParts(parsed).date;
}

export function resolveEventEndAnchors(event: EventEndDateSource | null | undefined): EventEndAnchor[] {
  if (!event) return [];
  const anchors: EventEndAnchor[] = [];
  const presale = dateFromIso(event.presaleAt);
  if (presale) anchors.push({ id: "presale", label: "Presale", date: presale });
  const general = dateFromIso(event.generalSaleAt);
  if (general) anchors.push({ id: "general_sale", label: "General sale", date: general });
  const eventDate = dateFromIso(event.eventDate);
  if (eventDate) anchors.push({ id: "event", label: "Event date", date: eventDate });
  return anchors;
}
