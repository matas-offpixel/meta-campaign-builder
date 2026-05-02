import { normalizeEventLabel } from "./fuzzy-match.ts";

export interface SearchableTicketingEvent {
  externalEventId: string;
  externalEventName: string;
  externalEventStartsAt: string | null;
  externalEventUrl: string | null;
  externalVenue: string | null;
  externalCapacity: number | null;
  connectionId: string;
  connectionProvider: string;
}

interface ScoredSearchResult {
  event: SearchableTicketingEvent;
  score: number;
}

function startsAtTime(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function searchHaystack(event: SearchableTicketingEvent): string {
  return normalizeEventLabel(
    [
      event.externalEventId,
      event.externalEventName,
      event.externalVenue,
      event.externalEventStartsAt?.slice(0, 10),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function scoreEventSearch(
  event: SearchableTicketingEvent,
  normalizedQuery: string,
  queryTokens: string[],
): number {
  const normalizedId = normalizeEventLabel(event.externalEventId);
  const haystack = searchHaystack(event);
  if (!haystack) return 0;

  let score = 0;
  if (normalizedId === normalizedQuery) score += 1000;
  else if (normalizedId.includes(normalizedQuery)) score += 500;

  if (haystack.includes(normalizedQuery)) score += 200;

  const haystackTokens = haystack.split(" ").filter(Boolean);
  for (const token of queryTokens) {
    if (haystackTokens.includes(token)) score += 30;
    else if (haystackTokens.some((candidate) => candidate.startsWith(token))) {
      score += 15;
    } else if (haystack.includes(token)) {
      score += 5;
    } else {
      return 0;
    }
  }

  return score;
}

export function searchTicketingEvents(
  events: SearchableTicketingEvent[],
  query: string,
  limit = 10,
): SearchableTicketingEvent[] {
  const normalizedQuery = normalizeEventLabel(query);
  if (!normalizedQuery) return [];
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);

  return events
    .map((event): ScoredSearchResult => ({
      event,
      score: scoreEventSearch(event, normalizedQuery, queryTokens),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (
        startsAtTime(b.event.externalEventStartsAt) -
        startsAtTime(a.event.externalEventStartsAt)
      );
    })
    .slice(0, limit)
    .map((result) => result.event);
}
