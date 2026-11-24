import type { CampaignDraft } from "../types.ts";

import { checkLaunchReferences, draftIdentities } from "./check.ts";
import type {
  GuardEvent,
  IdentityOwner,
  IdentityOwnership,
  LaunchGuardResult,
  LiveIdentity,
  VenueDefaults,
} from "./types.ts";
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

/** The draft's event alone (no other shows), for reads that need only its client. */
export async function loadGuardEvent(db: unknown, eventId: string): Promise<GuardEvent | null> {
  const { data, error } = await (db as Db).from("events").select(EVENT_COLUMNS).eq("id", eventId).maybeSingle();
  if (error) throw new Error(`launch-guard: event: ${error.message ?? "read failed"}`);
  return data ? toGuardEvent(data as EventRow, []) : null;
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

// ── page and Instagram owners (page_other_client) ─────────────────────

interface ClientRow {
  id: string;
  name: string | null;
  default_page_ids: string[] | null;
  default_instagram_actor_id: string | null;
  meta_business_id: string | null;
}
interface BmPageRow {
  id: string;
  business_id: string;
  page_id: string;
  page_name: string | null;
  is_owned_by_bm: boolean;
}
interface BmIgRow {
  id: string;
  business_id: string;
  ig_asset_id: string;
  ig_user_id: string | null;
  ig_username: string | null;
  is_owned_by_bm: boolean;
}

const chunks = <T,>(list: readonly T[], size = 100): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Who holds each page and Instagram account (page_other_client, ops' brief
 * of 24 Nov). SELECTs only, paged.
 *
 * Another client holds it when it is in that client's
 * `clients.default_page_ids` / `default_instagram_actor_id`, on a venue of
 * that client's events (`venues.meta_page_id` through `events.venue_id`),
 * or on that client's earlier drafts (`draft_json.settings.metaPageId` /
 * `metaIGAccountId`, the draft being checked left out).
 *
 * This event's client holds it when it is in its own defaults, on its own
 * venues, or anywhere in its own BM in the BM scan (`bm_pages` /
 * `bm_ig_accounts`, owned or shared, the BM mapped by
 * `clients.meta_business_id` or `client_business_managers.client_id`).
 * Its own earlier drafts don't count: on 24 Nov Electric had 16 drafts on
 * IRONWORKS' Ironworks London page and 14 on Puzzle's Instagram, all
 * copies, so its drafts would make the mistake look like its own.
 *
 * An artist's page or handle (`artists.meta_page_id` /
 * `artists.instagram_handle`) never fires.
 */
export async function loadIdentityOwnership(
  db: unknown,
  input: { event: GuardEvent; pageIds: readonly string[]; igIds: readonly string[]; excludeDraftId?: string | null },
): Promise<IdentityOwnership | null> {
  const client = db as Db;
  const { event } = input;
  const pageIds = [...new Set(input.pageIds.filter(Boolean))];
  const igIds = [...new Set(input.igIds.filter(Boolean))];
  if (pageIds.length === 0 && igIds.length === 0) return null;

  const clients = await pageAll<ClientRow>(
    () => client.from("clients").select("id, name, default_page_ids, default_instagram_actor_id, meta_business_id").order("id"),
    "clients",
  );

  // Venues: a venue's page belongs to the clients whose events are at it.
  const venueClaims: Array<{ page_id: string; client_id: string }> = [];
  for (const chunk of chunks(pageIds)) {
    const venues = await pageAll<{ id: string; meta_page_id: string | null }>(
      () => client.from("venues").select("id, meta_page_id").in("meta_page_id", chunk).order("id"),
      "venues",
    );
    for (const ids of chunks(venues.map((venue) => venue.id))) {
      const events = await pageAll<{ id: string; venue_id: string | null; client_id: string | null }>(
        () => client.from("events").select("id, venue_id, client_id").in("venue_id", ids).order("id"),
        "events by venue",
      );
      for (const row of events) {
        const page = venues.find((venue) => venue.id === row.venue_id)?.meta_page_id;
        if (page && row.client_id) venueClaims.push({ page_id: page, client_id: row.client_id });
      }
    }
  }

  // Earlier drafts, by the page / Instagram in their settings.
  const draftClaims: DraftClaim[] = [];
  const draftCols = "id, client_id, page:draft_json->settings->>metaPageId, ig:draft_json->settings->>metaIGAccountId";
  for (const [column, ids] of [
    ["draft_json->settings->>metaPageId", pageIds],
    ["draft_json->settings->>metaIGAccountId", igIds],
  ] as const) {
    for (const chunk of chunks(ids)) {
      const rows = await pageAll<{ id: string; client_id: string | null; page: string | null; ig: string | null }>(
        () => client.from("campaign_drafts").select(draftCols).in(column, chunk).order("id"),
        "campaign_drafts",
      );
      for (const row of rows) {
        if (row.id === input.excludeDraftId || !row.client_id) continue;
        draftClaims.push({ client_id: row.client_id, page_id: row.page, ig_id: row.ig });
      }
    }
  }

  const bmPages: BmPageRow[] = [];
  for (const chunk of chunks(pageIds)) {
    bmPages.push(
      ...(await pageAll<BmPageRow>(
        () => client.from("bm_pages").select("id, business_id, page_id, page_name, is_owned_by_bm").in("page_id", chunk).order("id"),
        "bm_pages",
      )),
    );
  }
  const bmIgs = new Map<string, BmIgRow>();
  for (const column of ["ig_user_id", "ig_asset_id"]) {
    for (const chunk of chunks(igIds)) {
      const rows = await pageAll<BmIgRow>(
        () =>
          client
            .from("bm_ig_accounts")
            .select("id, business_id, ig_asset_id, ig_user_id, ig_username, is_owned_by_bm")
            .in(column, chunk)
            .order("id"),
        "bm_ig_accounts",
      );
      for (const row of rows) bmIgs.set(row.id, row);
    }
  }
  const businessIds = [...new Set([...bmPages.map((row) => row.business_id), ...[...bmIgs.values()].map((row) => row.business_id)])];
  const bms: Array<{ id: string; business_id: string; client_id: string | null }> = [];
  for (const chunk of chunks(businessIds)) {
    bms.push(
      ...(await pageAll<{ id: string; business_id: string; client_id: string | null }>(
        () => client.from("client_business_managers").select("id, business_id, client_id").in("business_id", chunk).order("id"),
        "client_business_managers",
      )),
    );
  }
  const handles = [...new Set([...bmIgs.values()].map((row) => row.ig_username?.trim()).filter(Boolean) as string[])];
  const handleVariants = handles.flatMap((h) => [h, `@${h}`, h.toLowerCase(), `@${h.toLowerCase()}`]);
  const artistRows: Array<{ id: string; meta_page_id: string | null; instagram_handle: string | null }> = [];
  for (const chunk of chunks(pageIds)) {
    artistRows.push(
      ...(await pageAll<{ id: string; meta_page_id: string | null; instagram_handle: string | null }>(
        () => client.from("artists").select("id, meta_page_id, instagram_handle").in("meta_page_id", chunk).order("id"),
        "artists",
      )),
    );
  }
  for (const chunk of chunks(handleVariants)) {
    artistRows.push(
      ...(await pageAll<{ id: string; meta_page_id: string | null; instagram_handle: string | null }>(
        () => client.from("artists").select("id, meta_page_id, instagram_handle").in("instagram_handle", chunk).order("id"),
        "artists",
      )),
    );
  }
  return identityOwnershipFrom({
    event,
    pageIds,
    igIds,
    clients,
    venueClaims,
    draftClaims,
    bmPages,
    bmIgs: [...bmIgs.values()],
    bms,
    artistRows,
  });
}

/** The draft's own page and Instagram ids, and their owners. */
export async function loadDraftIdentityOwnership(
  db: unknown,
  draft: CampaignDraft,
  event: GuardEvent,
): Promise<IdentityOwnership | null> {
  const { pages, instagram } = draftIdentities(draft);
  return loadIdentityOwnership(db, { event, pageIds: [...pages.keys()], igIds: [...instagram.keys()], excludeDraftId: draft.id });
}

export interface DraftClaim {
  client_id: string;
  page_id: string | null;
  ig_id: string | null;
}

/** The pure half of loadIdentityOwnership, for tests. */
export function identityOwnershipFrom(input: {
  event: GuardEvent;
  pageIds: readonly string[];
  igIds: readonly string[];
  clients: readonly ClientRow[];
  venueClaims?: ReadonlyArray<{ page_id: string; client_id: string }>;
  draftClaims?: readonly DraftClaim[];
  bmPages: readonly BmPageRow[];
  bmIgs: readonly BmIgRow[];
  bms: ReadonlyArray<{ business_id: string; client_id: string | null }>;
  artistRows: ReadonlyArray<{ meta_page_id: string | null; instagram_handle: string | null }>;
}): IdentityOwnership {
  const { event } = input;
  const own = event.clientId;
  const byId = new Map(input.clients.map((row) => [row.id, row]));
  const clientsOfBusiness = (businessId: string): string[] => {
    const ids = new Set<string>();
    for (const row of input.clients) if (row.meta_business_id === businessId) ids.add(row.id);
    for (const row of input.bms) if (row.business_id === businessId && row.client_id) ids.add(row.client_id);
    return [...ids];
  };
  const nameOf = (id: string) => byId.get(id)?.name?.trim() || null;
  const artistPages = new Set(input.artistRows.map((row) => row.meta_page_id).filter(Boolean));
  const artistHandles = new Set(
    input.artistRows.map((row) => row.instagram_handle?.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
  );

  const owner = (
    kind: "page" | "instagram",
    id: string,
    name: string | null,
    stored: readonly string[],
    drafted: readonly string[],
    bmRows: ReadonlyArray<{ business_id: string }>,
    artist: boolean,
  ): IdentityOwner => {
    // Defaults and venues: whoever stores it. Drafts: other clients only.
    const holders = new Set<string>([...stored, ...drafted].filter((clientId) => clientId !== own));
    const ownClient =
      own != null &&
      (stored.includes(own) || bmRows.some((row) => clientsOfBusiness(row.business_id).includes(own)));
    const otherClients = [...holders].map(nameOf).filter((value): value is string => Boolean(value));
    return { kind, id, name, ownClient, otherClients: [...new Set(otherClients)], artist };
  };

  const owners: IdentityOwner[] = [];
  for (const id of input.pageIds) {
    const rows = input.bmPages.filter((row) => row.page_id === id);
    const stored = [
      ...input.clients.filter((row) => (row.default_page_ids ?? []).includes(id)).map((row) => row.id),
      ...(input.venueClaims ?? []).filter((row) => row.page_id === id).map((row) => row.client_id),
    ];
    const drafted = (input.draftClaims ?? []).filter((row) => row.page_id === id).map((row) => row.client_id);
    const name = rows.map((row) => row.page_name?.trim()).find(Boolean) ?? null;
    owners.push(owner("page", id, name, stored, drafted, rows, artistPages.has(id)));
  }
  for (const id of input.igIds) {
    const rows = input.bmIgs.filter((row) => row.ig_user_id === id || row.ig_asset_id === id);
    const stored = input.clients.filter((row) => row.default_instagram_actor_id === id).map((row) => row.id);
    const drafted = (input.draftClaims ?? []).filter((row) => row.ig_id === id).map((row) => row.client_id);
    const handle = rows.map((row) => row.ig_username?.trim()).find(Boolean) ?? null;
    owners.push(owner("instagram", id, handle, stored, drafted, rows, handle != null && artistHandles.has(handle.toLowerCase())));
  }
  return { clientName: own ? nameOf(own) : null, owners };
}

/** Loads and runs the check for a draft. A draft with no event has nothing to check. */
export async function runLaunchGuard(
  db: unknown,
  draft: CampaignDraft,
  live: LiveIdentity | null = null,
): Promise<LaunchGuardResult> {
  const eventId = draft.settings.eventId?.trim();
  if (!eventId) return { checks: [], blockers: 0, warnings: 0, eventCode: null };
  const context = await loadLaunchGuardContext(db, eventId);
  if (!context) return { checks: [], blockers: 0, warnings: 0, eventCode: null };
  const ownership = await loadDraftIdentityOwnership(db, draft, context.event);
  return checkLaunchReferences(draft, context.event, context.venueDefaults, context.otherEvents, ownership, live);
}
