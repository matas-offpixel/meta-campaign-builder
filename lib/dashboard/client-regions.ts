/** Venue buckets for World Cup and other events routed by geography. */
export type GeographicRegionKey = "scotland" | "england_london" | "england_uk";

/**
 * Dashboard region tabs: three geographic buckets plus club football and
 * Off/Pixel own campaigns. Grouping is computed at render from event_code +
 * venue metadata — DB rows are unchanged.
 */
export type ClientRegionKey =
  | GeographicRegionKey
  | "club_football"
  | "op_own";

export const GEOGRAPHIC_REGION_ORDER: GeographicRegionKey[] = [
  "scotland",
  "england_london",
  "england_uk",
];

export const CLIENT_REGION_ORDER: ClientRegionKey[] = [
  ...GEOGRAPHIC_REGION_ORDER,
  "club_football",
  "op_own",
];

export const CLIENT_REGION_LABELS: Record<ClientRegionKey, string> = {
  scotland: "Scotland",
  england_london: "England — London",
  england_uk: "England — UK",
  club_football: "Club Football",
  op_own: "Off/Pixel Own",
};

export interface ClientRegionEventLike {
  venue_city?: string | null;
  venue_country?: string | null;
  event_code?: string | null;
}

/** Prefix-based routing for dashboard tabs (locked categories — see reconciliation audit). */
export type EventCodeCategory = "club_football" | "wc26" | "op_own" | "other";

export function categorizeEvent(
  event: Pick<ClientRegionEventLike, "event_code">,
): EventCodeCategory {
  const code = (event.event_code ?? "").trim().toUpperCase();
  if (code.startsWith("4TF")) return "club_football";
  if (code.startsWith("LEEDS")) return "club_football";
  if (code.startsWith("WC26-")) return "wc26";
  if (code.startsWith("OP-")) return "op_own";
  return "other";
}

export function bucketEventToClientRegion(
  event: ClientRegionEventLike,
): GeographicRegionKey {
  const city = (event.venue_city ?? "").toLowerCase();
  const country = (event.venue_country ?? "").toLowerCase();
  if (city.includes("glasgow") || country.includes("scotland")) {
    return "scotland";
  }
  if (city.includes("london")) {
    return "england_london";
  }
  return "england_uk";
}

/** Assigns each event to exactly one dashboard tab (region row). */
export function assignEventToDashboardTab(
  event: ClientRegionEventLike,
): ClientRegionKey {
  const cat = categorizeEvent(event);
  if (cat === "club_football") return "club_football";
  if (cat === "op_own") return "op_own";
  return bucketEventToClientRegion(event);
}

export function isGeographicRegionKey(
  key: ClientRegionKey,
): key is GeographicRegionKey {
  return (
    key === "scotland" ||
    key === "england_london" ||
    key === "england_uk"
  );
}

export function groupEventsByClientRegion<T extends ClientRegionEventLike>(
  events: readonly T[],
): Map<ClientRegionKey, T[]> {
  const map = new Map<ClientRegionKey, T[]>();
  for (const event of events) {
    const key = assignEventToDashboardTab(event);
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
  }
  return map;
}

export function visibleClientRegions<T>(
  grouped: Map<ClientRegionKey, T[]>,
): ClientRegionKey[] {
  return CLIENT_REGION_ORDER.filter(
    (key) => (grouped.get(key)?.length ?? 0) > 0,
  );
}

export function defaultClientRegion<T>(
  grouped: Map<ClientRegionKey, T[]>,
): ClientRegionKey | null {
  const visible = visibleClientRegions(grouped);
  if (visible.length === 0) return null;
  let best = visible[0];
  let bestCount = grouped.get(best)?.length ?? 0;
  for (const region of visible.slice(1)) {
    const count = grouped.get(region)?.length ?? 0;
    if (count > bestCount) {
      best = region;
      bestCount = count;
    }
  }
  return best;
}

export function parseClientRegionKey(
  value: string | null | undefined,
): ClientRegionKey | null {
  if (
    value === "scotland" ||
    value === "england_london" ||
    value === "england_uk" ||
    value === "club_football" ||
    value === "op_own"
  ) {
    return value;
  }
  if (value === "england-london") return "england_london";
  if (value === "england-uk") return "england_uk";
  if (value === "club-football") return "club_football";
  if (value === "op-own") return "op_own";
  return null;
}
