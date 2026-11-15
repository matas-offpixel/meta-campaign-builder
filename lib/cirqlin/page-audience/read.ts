/**
 * lib/cirqlin/page-audience/read.ts
 *
 * Server read helpers for HE2's CIRQLIN page audience (migration 247): the
 * latest stored row for each show's linked page, and for the umbrella page
 * apart. A render never calls CIRQLIN.
 *
 * A show's page is its events.cirqlin_page_id today, so a page re-linked to
 * another show moves with the link. The umbrella (events.is_umbrella, the
 * nx-loves-aw26 page on NX26-GLOBAL) is never in `shows` and nothing here
 * sums across rows: the umbrella's signups are its own, never added to the
 * shows'.
 *
 * Before migration 247 is applied, every read is empty, not an error.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadAllPaged } from "../../db/paged-read.ts";
import type { PageAudienceCity } from "./client.ts";

type Db = Pick<SupabaseClient, "from">;

export const PAGE_AUDIENCE_TABLE = "cirqlin_page_audience";

export const PAGE_AUDIENCE_COLUMNS =
  "page_id,fetch_day,event_id,is_umbrella,signups,geo_cities,geo_everywhere_else,geo_couldnt_tell,consent_marketing,channels_offered,community_joined,community_link_clicks,community_code_shared,whatsapp_with_phone,partner_opt_in,daily_timezone,signups_check,signups_stored,signups_stored_at,fetched_at";

export interface StoredPageAudienceRow {
  page_id: string;
  fetch_day: string;
  event_id: string | null;
  is_umbrella: boolean;
  signups: number;
  geo_cities: PageAudienceCity[];
  geo_everywhere_else: number;
  geo_couldnt_tell: number;
  consent_marketing: number;
  channels_offered: string[];
  community_joined: number;
  community_link_clicks: number;
  community_code_shared: boolean;
  whatsapp_with_phone: number;
  partner_opt_in: number;
  daily_timezone: string;
  signups_check: "ok" | "mismatch" | "unchecked";
  signups_stored: number | null;
  signups_stored_at: string | null;
  fetched_at: string;
}

/** What a panel reads: one page's all-time audience as of `fetchDay`. */
export interface PageAudienceFigures {
  eventId: string;
  pageId: string;
  isUmbrella: boolean;
  /** UTC day of the fetch; the figures are all time up to then. */
  fetchDay: string;
  fetchedAt: string;
  signups: number;
  geography: {
    /** Cities with 10 or more signups, most first. */
    cities: PageAudienceCity[];
    everywhereElse: number;
    couldntTell: number;
  };
  consentMarketing: number;
  channelsOffered: string[];
  communityJoined: number;
  communityLinkClicks: number;
  /** The page's WhatsApp invite code also appears on another page. */
  communityCodeShared: boolean;
  whatsappWithPhone: number;
  partnerOptIn: number;
  dailyTimezone: string;
  /** The smoke test against the stored /signups page total. Never corrected. */
  signupsCheck: { status: "ok" | "mismatch" | "unchecked"; stored: number | null; storedAt: string | null };
}

export interface PageAudienceView {
  /** Show event id → its page's latest row. Never the umbrella. */
  shows: Map<string, PageAudienceFigures>;
  /** Umbrella event id → its page's latest row, kept apart. */
  umbrellas: Map<string, PageAudienceFigures>;
}

export function isMissingPageAudienceTable(message: string | undefined): boolean {
  return !!message && new RegExp(`${PAGE_AUDIENCE_TABLE}.*(does not exist|schema cache)|(does not exist|schema cache).*${PAGE_AUDIENCE_TABLE}`, "i").test(message);
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toFigures(eventId: string, isUmbrella: boolean, row: StoredPageAudienceRow): PageAudienceFigures {
  const cities = Array.isArray(row.geo_cities) ? row.geo_cities : [];
  return {
    eventId,
    pageId: row.page_id,
    isUmbrella,
    fetchDay: row.fetch_day,
    fetchedAt: row.fetched_at,
    signups: num(row.signups),
    geography: {
      cities: [...cities].sort((a, b) => b.signups - a.signups || a.name.localeCompare(b.name)),
      everywhereElse: num(row.geo_everywhere_else),
      couldntTell: num(row.geo_couldnt_tell),
    },
    consentMarketing: num(row.consent_marketing),
    channelsOffered: [...(row.channels_offered ?? [])],
    communityJoined: num(row.community_joined),
    communityLinkClicks: num(row.community_link_clicks),
    communityCodeShared: row.community_code_shared === true,
    whatsappWithPhone: num(row.whatsapp_with_phone),
    partnerOptIn: num(row.partner_opt_in),
    dailyTimezone: row.daily_timezone,
    signupsCheck: {
      status: row.signups_check,
      stored: row.signups_stored == null ? null : num(row.signups_stored),
      storedAt: row.signups_stored_at,
    },
  };
}

type LatestQuery = {
  select(columns: string): LatestQuery;
  eq(column: string, value: unknown): LatestQuery;
  order(column: string, options: { ascending: boolean }): LatestQuery;
  limit(n: number): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
};

/**
 * Each page's newest row (one query per page, newest fetch_day; a limit-1
 * read on the primary key can't be cut by the row cap). A page with no row
 * is absent. Throws on a read error other than the missing table.
 */
export async function latestPageAudienceRows(db: Db, pageIds: Iterable<string>): Promise<Map<string, StoredPageAudienceRow>> {
  const ids = [...new Set([...pageIds].map((id) => id.trim().toLowerCase()).filter(Boolean))].sort();
  const out = new Map<string, StoredPageAudienceRow>();
  const CHUNK = 10;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const results = await Promise.all(
      ids.slice(i, i + CHUNK).map(async (id) => {
        const q = (db.from(PAGE_AUDIENCE_TABLE) as unknown as LatestQuery)
          .select(PAGE_AUDIENCE_COLUMNS)
          .eq("page_id", id)
          .order("fetch_day", { ascending: false });
        const { data, error } = await q.limit(1);
        if (error) {
          if (isMissingPageAudienceTable(error.message)) return null;
          throw new Error(`${PAGE_AUDIENCE_TABLE}: ${error.message}`);
        }
        return (data?.[0] as StoredPageAudienceRow | undefined) ?? null;
      }),
    );
    for (const row of results) if (row) out.set(row.page_id, row);
  }
  return out;
}

type EventLink = { id: string; cirqlin_page_id: string | null; is_umbrella: boolean | null };

function viewOf(events: readonly EventLink[], rows: ReadonlyMap<string, StoredPageAudienceRow>): PageAudienceView {
  const view: PageAudienceView = { shows: new Map(), umbrellas: new Map() };
  for (const e of events) {
    const page = e.cirqlin_page_id?.trim().toLowerCase();
    if (!page) continue;
    const row = rows.get(page);
    if (!row) continue;
    const umbrella = e.is_umbrella === true;
    (umbrella ? view.umbrellas : view.shows).set(e.id, toFigures(e.id, umbrella, row));
  }
  return view;
}

async function viewForEvents(db: Db, events: EventLink[]): Promise<PageAudienceView> {
  const rows = await latestPageAudienceRows(
    db,
    events.map((e) => e.cirqlin_page_id ?? "").filter(Boolean),
  );
  return viewOf(events, rows);
}

const EVENT_COLUMNS = "id,cirqlin_page_id,is_umbrella";

/** The latest page audience for these shows, the umbrella apart. */
export async function pageAudienceForEvents(db: Db, eventIds: readonly string[]): Promise<PageAudienceView> {
  const ids = [...new Set(eventIds)].sort();
  const events: EventLink[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    events.push(...(await loadAllPaged<EventLink>(db, "events", EVENT_COLUMNS, ["id"], (q) => q.in("id", chunk).not("cirqlin_page_id", "is", null))));
  }
  return viewForEvents(db, events);
}

/** One show's page audience, or null. An umbrella event returns its own row. */
export async function pageAudienceForShow(db: Db, eventId: string): Promise<PageAudienceFigures | null> {
  const view = await pageAudienceForEvents(db, [eventId]);
  return view.shows.get(eventId) ?? view.umbrellas.get(eventId) ?? null;
}

/**
 * Every show of the client with a linked page, and its umbrella apart.
 * `umbrella` is the client's umbrella row when it has exactly one, else the
 * first by event id (`umbrellas` holds them all).
 */
export async function pageAudienceForClient(db: Db, clientId: string): Promise<PageAudienceView & { umbrella: PageAudienceFigures | null }> {
  const events = await loadAllPaged<EventLink>(db, "events", EVENT_COLUMNS, ["id"], (q) => q.eq("client_id", clientId).not("cirqlin_page_id", "is", null));
  const view = await viewForEvents(db, events);
  const first = [...view.umbrellas.keys()].sort()[0];
  return { ...view, umbrella: first ? view.umbrellas.get(first)! : null };
}
