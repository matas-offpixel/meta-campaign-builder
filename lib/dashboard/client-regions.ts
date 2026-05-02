export type ClientRegionKey = "scotland" | "england_london" | "england_uk";

export const CLIENT_REGION_ORDER: ClientRegionKey[] = [
  "scotland",
  "england_london",
  "england_uk",
];

export const CLIENT_REGION_LABELS: Record<ClientRegionKey, string> = {
  scotland: "Scotland",
  england_london: "England — London",
  england_uk: "England — UK",
};

export interface ClientRegionEventLike {
  venue_city?: string | null;
  venue_country?: string | null;
}

export function bucketEventToClientRegion(
  event: ClientRegionEventLike,
): ClientRegionKey {
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

export function groupEventsByClientRegion<T extends ClientRegionEventLike>(
  events: readonly T[],
): Map<ClientRegionKey, T[]> {
  const map = new Map<ClientRegionKey, T[]>();
  for (const event of events) {
    const key = bucketEventToClientRegion(event);
    const list = map.get(key) ?? [];
    list.push(event);
    map.set(key, list);
  }
  return map;
}

export function visibleClientRegions<T>(
  grouped: Map<ClientRegionKey, T[]>,
): ClientRegionKey[] {
  return CLIENT_REGION_ORDER.filter((key) => (grouped.get(key)?.length ?? 0) > 0);
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

export function parseClientRegionKey(value: string | null | undefined): ClientRegionKey | null {
  if (value === "scotland" || value === "england_london" || value === "england_uk") {
    return value;
  }
  if (value === "england-london") return "england_london";
  if (value === "england-uk") return "england_uk";
  return null;
}
