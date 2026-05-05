import type { TicketTierBreakdown } from "../types.ts";

interface EventbriteTicketClass {
  name?: string | null;
  display_name?: string | null;
  cost?: {
    value?: number | null;
    major_value?: string | number | null;
  } | null;
  capacity?: number | null;
  quantity_total?: number | null;
  quantity_sold?: number | null;
}

export function parseEventbriteTiers(rawPayload: unknown): TicketTierBreakdown[] {
  if (!rawPayload || typeof rawPayload !== "object") return [];
  const classes = (rawPayload as { ticket_classes?: unknown }).ticket_classes;
  if (!Array.isArray(classes)) return [];

  const tiers: TicketTierBreakdown[] = [];
  for (const cls of classes) {
    if (!cls || typeof cls !== "object") continue;
    const row = cls as EventbriteTicketClass;
    const quantitySold = nonNegativeInteger(row.quantity_sold);
    const quantityTotal =
      nonNegativeInteger(row.quantity_total) ?? nonNegativeInteger(row.capacity);
    tiers.push({
      tierName: row.name?.trim() || row.display_name?.trim() || "Unknown Tier",
      price: eventbriteMajorValue(row.cost),
      quantitySold: quantitySold ?? 0,
      // `replaceEventTicketTiers` accepts remaining inventory and stores
      // allocation as sold + remaining. Eventbrite exposes allocation
      // directly, so normalize here to preserve the DB contract.
      quantityAvailable:
        quantityTotal == null
          ? null
          : Math.max(0, quantityTotal - (quantitySold ?? 0)),
    });
  }
  return tiers;
}

function nonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.trunc(value));
}

function eventbriteMajorValue(
  cost: EventbriteTicketClass["cost"],
): number | null {
  const major = cost?.major_value;
  if (typeof major === "number" && Number.isFinite(major)) return major;
  if (typeof major === "string" && major.trim()) {
    const parsed = Number(major);
    if (Number.isFinite(parsed)) return parsed;
  }
  const minor = cost?.value;
  return typeof minor === "number" && Number.isFinite(minor) ? minor / 100 : null;
}
