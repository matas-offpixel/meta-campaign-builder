import type { CampaignDraft } from "../types.ts";

import { checkLaunchReferences } from "./check.ts";
import type { GuardEvent, LaunchGuardResult, VenueDefaults } from "./types.ts";
import { loadVenueDefaults } from "./venue-defaults.ts";

/**
 * Reads for the pre-launch check: the draft's event, its venue defaults,
 * and every other show of the same client in the last 12 months with its
 * `event_artists` names. SELECTs only, paged past PostgREST's 1,000-row
 * cap. The client is passed in (server or service role), never imported,
 * so this file stays free of `@/` imports.
 */

const PAGE = 1000;
const EVENT_COLUMNS =
  "id, client_id, event_code, name, venue_name, venue_key, venue_city, signup_url, ticket_url, cirqlin_page_slug, meta_ad_account_id, event_date, created_at";

interface EventRow {
  id: string;
  client_id: string | null;
  event_code: string | null;
  name: string | null;
  venue_name: string | null;
  venue_key: string | null;
  venue_city: string | null;
  signup_url: string | null;
  ticket_url: string | null;
  cirqlin_page_slug: string | null;
  meta_ad_account_id: string | null;
  event_date: string | null;
  created_at: string | null;
}

type Query = {
  select: (cols: string) => Query;
  eq: (col: string, value: string) => Query;
  in: (col: string, values: readonly string[]) => Query;
  or: (filter: string) => Query;
  order: (col: string, opts?: { ascending?: boolean }) => Query;
  range: (from: number, to: number) => Promise<{ data: unknown[] | null; error: { message?: string } | null }>;
  maybeSingle: () => Promise<{ data: unknown; error: { message?: string } | null }>;
};
type Db = { from: (table: string) => Query };

async function pageAll<T>(build: () => Query, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(`launch-guard: ${label}: ${error.message ?? "read failed"}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

function toGuardEvent(row: EventRow, artists: readonly string[]): GuardEvent {
  return {
    id: row.id,
    code: row.event_code,
    name: row.name,
    clientId: row.client_id,
    venueName: row.venue_name,
    venueKey: row.venue_key,
    venueCity: row.venue_city,
    signupUrl: row.signup_url,
    ticketUrl: row.ticket_url,
    cirqlinPageSlug: row.cirqlin_page_slug,
    metaAdAccountId: row.meta_ad_account_id,
    artists,
  };
}

/** `event_artists` → artist names, per event id. */
export async function loadArtistNames(db: unknown, eventIds: readonly string[]): Promise<Map<string, string[]>> {
  const client = db as Db;
  const byEvent = new Map<string, string[]>();
  for (let i = 0; i < eventIds.length; i += 100) {
    const chunk = eventIds.slice(i, i + 100);
    const rows = await pageAll<{ id: string; event_id: string; artists: { name: string | null } | null }>(
      () => client.from("event_artists").select("id, event_id, artists(name)").in("event_id", chunk).order("id"),
      "event_artists",
    );
    for (const row of rows) {
      const name = row.artists?.name?.trim();
      if (!name) continue;
      const list = byEvent.get(row.event_id) ?? [];
      if (!list.includes(name)) list.push(name);
      byEvent.set(row.event_id, list);
    }
  }
  return byEvent;
}

/** The client's shows "in the last 12 months": a show date, else a created date, on or after a year ago. */
export async function loadClientEvents(db: unknown, clientId: string, now: Date): Promise<EventRow[]> {
  const client = db as Db;
  const since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return pageAll<EventRow>(
    () =>
      client
        .from("events")
        .select(EVENT_COLUMNS)
        .eq("client_id", clientId)
        .or(`event_date.gte.${since},and(event_date.is.null,created_at.gte.${since})`)
        .order("id"),
    "events",
  );
}

export interface LaunchGuardContext {
  event: GuardEvent;
  venueDefaults: VenueDefaults;
  otherEvents: GuardEvent[];
}

export async function loadLaunchGuardContext(
  db: unknown,
  eventId: string,
  now: Date = new Date(),
): Promise<LaunchGuardContext | null> {
  const client = db as Db;
  const { data, error } = await client.from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) throw new Error(`launch-guard: event: ${error.message ?? "read failed"}`);
  const row = data as EventRow | null;
  if (!row) return null;
  const others = row.client_id ? (await loadClientEvents(db, row.client_id, now)).filter((e) => e.id !== row.id) : [];
  const artists = await loadArtistNames(db, [row.id, ...others.map((e) => e.id)]);
  const event = toGuardEvent(row, artists.get(row.id) ?? []);
  return {
    event,
    venueDefaults: await loadVenueDefaults(db, event),
    otherEvents: others.map((other) => toGuardEvent(other, artists.get(other.id) ?? [])),
  };
}

/** Loads and runs the check for a draft. A draft with no event has nothing to check. */
export async function runLaunchGuard(db: unknown, draft: CampaignDraft): Promise<LaunchGuardResult> {
  const eventId = draft.settings.eventId?.trim();
  if (!eventId) return { checks: [], blockers: 0, warnings: 0, eventCode: null };
  const context = await loadLaunchGuardContext(db, eventId);
  if (!context) return { checks: [], blockers: 0, warnings: 0, eventCode: null };
  return checkLaunchReferences(draft, context.event, context.venueDefaults, context.otherEvents);
}
