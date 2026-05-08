export interface ParsedFourthefansSummary {
  externalEventId: string;
  name: string;
  startsAt: string | null;
  url: string | null;
  venue: string | null;
  capacity: number | null;
  status?: string | null;
}

export interface ParsedFourthefansSales {
  ticketsSold: number;
  ticketsAvailable: number | null;
  grossRevenueCents: number | null;
  currency: string | null;
  ticketTiers: ParsedFourthefansTicketTier[];
}

export interface ParsedFourthefansTicketTier {
  tierName: string;
  price: number | null;
  quantitySold: number;
  quantityAvailable: number | null;
}

export function extractFourthefansEventArray(
  payload: unknown,
): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["events", "data", "items", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }
  return [];
}

export function hasMoreFourthefansEvents(
  payload: unknown,
  page: number,
  count: number,
  pageSize: number,
): boolean {
  if (count >= pageSize) return true;
  if (!isRecord(payload)) return false;
  const totalPages = readNumber(payload, ["total_pages", "page_count", "pages"]);
  if (totalPages != null) return page < totalPages;
  const pagination = payload.pagination;
  if (isRecord(pagination)) {
    const hasMoreItems = pagination.has_more_items ?? pagination.has_more;
    if (typeof hasMoreItems === "boolean") return hasMoreItems;
    const pageCount = readNumber(pagination, ["page_count", "total_pages"]);
    if (pageCount != null) return page < pageCount;
  }
  return false;
}

export function readFourthefansEventSummary(
  event: Record<string, unknown>,
): ParsedFourthefansSummary | null {
  const id = readId(event);
  if (!id) return null;
  return {
    externalEventId: id,
    name: readString(event, ["title", "name", "event_title"]) ?? "(untitled)",
    startsAt: readString(event, [
      "event_date",
      "date",
      "start_date",
      "starts_at",
      "start",
    ]),
    url: readString(event, ["url", "link", "permalink"]),
    venue: readVenue(event),
    capacity: readNumber(event, [
      "capacity",
      "event_capacity",
      "tickets_available",
      "total_capacity",
      "quantity_total",
    ]),
    status: readString(event, ["status", "event_status"]),
  };
}

export function readFourthefansEventSales(
  payload: unknown,
): ParsedFourthefansSales {
  const event = unwrapEvent(payload);
  // Try tiers on the unwrapped inner event first. When the API places tier
  // data at the outer envelope level (e.g. `{ event: {...}, ticket_tiers: []}`)
  // but event metadata in a nested object, the unwrapped `event` won't have
  // tiers — fall back to the raw payload in that case.
  let ticketTiers = readTicketTiers(event);
  if (ticketTiers.length === 0 && isRecord(payload) && payload !== event) {
    ticketTiers = readTicketTiers(payload as Record<string, unknown>);
  }
  const tierCapacity = ticketTiers.reduce(
    (sum, tier) =>
      sum + tier.quantitySold + (tier.quantityAvailable ?? 0),
    0,
  );
  const ticketsSold = readNumber(event, [
    "tickets_sold",
    "ticket_sold",
    "sold",
    "sold_count",
    "total_sold",
    "sales",
  ]);
  const capacity = readNumber(event, [
    "capacity",
    "event_capacity",
    "tickets_available",
    "total_capacity",
    "quantity_total",
  ]);
  const revenueMajor = readRevenueMajor(event);
  const currency = readString(event, ["currency", "revenue_currency"]) ?? "GBP";

  return {
    ticketsSold: ticketsSold ?? 0,
    ticketsAvailable:
      capacity != null && capacity > 0 ? capacity : tierCapacity || null,
    grossRevenueCents:
      revenueMajor == null ? null : Math.round(revenueMajor * 100),
    currency,
    ticketTiers,
  };
}

function unwrapEvent(payload: unknown): Record<string, unknown> {
  if (isRecord(payload)) {
    for (const key of ["event", "data"]) {
      const value = payload[key];
      if (isRecord(value)) return value;
    }
    return payload;
  }
  throw new Error("4thefans returned an unexpected event payload.");
}

function readId(event: Record<string, unknown>): string | null {
  const raw = event.id ?? event.event_id ?? event.ID;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

function readString(
  record: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function readVenue(record: Record<string, unknown>): string | null {
  const direct = readString(record, [
    "venue",
    "location",
    "venue_name",
    "event_venue",
    "address",
  ]);
  if (direct) return direct;
  for (const key of ["venue", "location"]) {
    const value = record[key];
    if (isRecord(value)) {
      const nested = readString(value, [
        "name",
        "title",
        "address",
        "address_full",
        "city",
      ]);
      if (nested) return nested;
    }
  }
  return null;
}

function readNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = record[key];
    const parsed = parseNumeric(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function readRevenueMajor(record: Record<string, unknown>): number | null {
  const minor = readNumber(record, [
    "revenue_cents",
    "revenue_pence",
    "gross_revenue_cents",
    "gross_revenue_pence",
  ]);
  if (minor != null) return minor / 100;
  return readNumber(record, [
    "revenue",
    "gross_revenue",
    "total_revenue",
    "sales_value",
  ]);
}

function readTicketTiers(
  event: Record<string, unknown>,
): ParsedFourthefansTicketTier[] {
  // Try every key observed across the book.tickets WordPress plugin family.
  // `tickets` is common on WooCommerce-derived endpoints where the listing
  // returns `{ tickets: [...] }` at either the outer envelope or inner event
  // level. Keep `ticket_tiers` first since that is what the documented v1
  // spec uses; the others are empirically observed fallbacks.
  const rawTiers =
    event.ticket_tiers ??
    event.ticketTiers ??
    event.tiers ??
    event.ticket_types ??
    event.tickets ??
    event.booking_tickets ??
    event.event_tickets;
  if (!Array.isArray(rawTiers)) return [];

  const tiers: ParsedFourthefansTicketTier[] = [];
  for (const rawTier of rawTiers) {
    if (!isRecord(rawTier)) continue;
    const tierName = readString(rawTier, [
      "name",
      "tier_name",
      "ticket_name",
      "title",
      "label",
    ]);
    if (!tierName) continue;
    const quantitySold = readNumber(rawTier, [
      "quantity_sold",
      "tickets_sold",
      "sold",
      "sold_count",
    ]) ?? 0;
    const declaredAllocation = readNumber(rawTier, [
      "quantity_total",
      "allocation",
      "capacity",
      "total",
    ]);
    const remaining = readNumber(rawTier, [
      "quantity_available",
      "available",
      "remaining",
    ]);
    tiers.push({
      tierName,
      price: readNumber(rawTier, ["price", "ticket_price", "amount"]),
      quantitySold,
      quantityAvailable:
        remaining ??
        (declaredAllocation == null
          ? null
          : Math.max(0, declaredAllocation - quantitySold)),
    });
  }
  return tiers;
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[£$€,\s]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
