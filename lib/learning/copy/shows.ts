/**
 * events_n counts real shows, not event rows.
 *
 * One ad belongs to one event. The bracketed code in the campaign name
 * is that event when it matches exactly one show: a draft can be linked
 * to a different event than the campaign it launched. With no code, a
 * campaign that names exactly one other show counts toward that show
 * (the Worakls campaign is linked to Colyn). Otherwise the ad stays on
 * the event its days spent the most on.
 *
 * A show is a non-cancelled event with a date. Two events on the same
 * date at the same venue (venue_key or venue_name) are one show. An
 * event with no date, such as an always-on brand campaign, is not a show.
 */

import { resolveAdContext, type AdFactRow, type CodedEvent } from "../ad-facts.ts";

export type ShowEvent = {
  id: string;
  date: string | null;
  venueName: string | null;
  venueKey: string | null;
  status: string | null;
};

export type AdEventPart = { eventId: string; spend: number; results: number };

export type NamedShow = { eventId: string; clientId: string | null; name: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseIn(campaign: string, name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 4) return false;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}])`, "iu");
  return pattern.test(campaign);
}

/** A campaign word that is the show's name plus one inserted letter: Woraklis / Worakls. */
function oneLetterLonger(word: string, name: string): boolean {
  if (word.length !== name.length + 1) return false;
  let skip = 0;
  let nameAt = 0;
  for (let wordAt = 0; wordAt < word.length && nameAt < name.length; wordAt++) {
    if (word[wordAt] === name[nameAt]) nameAt++;
    else skip++;
  }
  return nameAt === name.length && skip <= 1;
}

function typoIn(campaign: string, name: string): boolean {
  const trimmed = name.trim().toLowerCase();
  if (trimmed.length < 5) return false;
  const words = campaign.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.some((word) => oneLetterLonger(word, trimmed));
}

function showNamedInCampaign(campaign: string, shows: readonly NamedShow[], ledgerEventId: string): NamedShow | null {
  const others = shows.filter((show) => show.eventId !== ledgerEventId && show.name.trim().length >= 4);
  const phrase = others.filter((show) => phraseIn(campaign, show.name));
  if (phrase.length === 1) return phrase[0]!;
  if (phrase.length > 1) return null;
  const typos = others.filter((show) => typoIn(campaign, show.name));
  return typos.length === 1 ? typos[0]! : null;
}

function norm(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function sameVenue(a: ShowEvent, b: ShowEvent): boolean {
  const keyA = norm(a.venueKey);
  const keyB = norm(b.venueKey);
  const nameA = norm(a.venueName);
  const nameB = norm(b.venueName);
  if (keyA && keyB && keyA === keyB) return true;
  if (nameA && nameB && nameA === nameB) return true;
  if (keyA && nameB && keyA === nameB) return true;
  if (keyB && nameA && keyB === nameA) return true;
  return false;
}

/** event id → show id. Cancelled events and events with no date are absent. */
export function showOf(events: readonly ShowEvent[]): Map<string, string> {
  const real = events.filter((event) => event.status !== "cancelled" && Boolean(event.date));
  const parent = new Map(real.map((event) => [event.id, event.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = id;
    while (cursor !== root) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  };
  const byDate = new Map<string, ShowEvent[]>();
  for (const event of real) {
    const list = byDate.get(event.date!) ?? [];
    list.push(event);
    byDate.set(event.date!, list);
  }
  for (const group of byDate.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (sameVenue(group[i]!, group[j]!)) union(group[i]!.id, group[j]!.id);
      }
    }
  }
  return new Map(real.map((event) => [event.id, find(event.id)]));
}

/**
 * The show an ad counts toward. A unique [EVENT_CODE] in the campaign
 * name wins over the ledger, which follows the draft's event link.
 */
export function eventForCopyAd(
  row: AdFactRow,
  ledger: { clientId: string; eventId: string; eventName?: string | null },
  codedEvents: readonly CodedEvent[],
  namedShows: readonly NamedShow[] = [],
): { clientId: string; eventId: string } {
  const coded = resolveAdContext(row, { launchedAds: new Map(), launchedAdSets: new Map(), codedEvents });
  if (coded.eventId) return { clientId: coded.clientId ?? ledger.clientId, eventId: coded.eventId };
  const campaign = row.campaign_name ?? "";
  const ledgerNamed = ledger.eventName ? phraseIn(campaign, ledger.eventName) || typoIn(campaign, ledger.eventName) : false;
  if (!ledgerNamed) {
    const named = showNamedInCampaign(campaign, namedShows, ledger.eventId);
    if (named) return { clientId: named.clientId ?? ledger.clientId, eventId: named.eventId };
  }
  return { clientId: ledger.clientId, eventId: ledger.eventId };
}

/** The event an ad counts toward. Every day of spend is included in the total. */
export function rollAd(parts: readonly AdEventPart[]): { eventId: string; spend: number; results: number } | null {
  if (!parts.length) return null;
  const byEvent = new Map<string, { spend: number; results: number }>();
  for (const part of parts) {
    const have = byEvent.get(part.eventId) ?? { spend: 0, results: 0 };
    have.spend += part.spend;
    have.results += part.results;
    byEvent.set(part.eventId, have);
  }
  const [eventId] = [...byEvent.entries()].sort(
    (a, b) => b[1].spend - a[1].spend || b[1].results - a[1].results || a[0].localeCompare(b[0]),
  )[0]!;
  let spend = 0;
  let results = 0;
  for (const part of parts) {
    spend += part.spend;
    results += part.results;
  }
  return { eventId, spend, results };
}
