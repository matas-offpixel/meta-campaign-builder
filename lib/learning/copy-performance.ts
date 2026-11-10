/**
 * copy_performance (migration 207). DB-only. Reads ad_copy and the
 * learning facts, writes nothing until `writeCopyPerformance`.
 *
 * The same reads feed the artist library job (lib/learning/copy/
 * artist-plan.ts): `loadCopySources` once, then `artistExtractionInputs`
 * for that job and `buildCopyLibrary` for this one, with the names the
 * artist job is about to link passed in as `extraLineups` so the night's
 * templates already use them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeAdAccountId, resolveEventAdAccountId } from "../meta/ad-account.ts";
import type { CodedEvent } from "./ad-facts.ts";
import type { LearningClient, LearningFact } from "./joins.ts";
import type { ExtractionEvent, ExtractionWorld } from "./copy/artist-extraction.ts";
import type { ExistingArtist, ExistingLink } from "./copy/artist-plan.ts";
import { normaliseCopy, voiceOf, type CopyDictionaries, type Voice } from "./copy/normalise.ts";
import { nameOnlyTemplateCount, scoreTemplates, type CopyField, type CopyPerformanceRow, type CopyStage, type ScoreAd } from "./copy/score.ts";
import { eventForCopyAd, rollAd, showOf, type NamedShow, type ShowEvent } from "./copy/shows.ts";

type Db = Pick<SupabaseClient, "from">;

export type EventRow = {
  id: string;
  name: string | null;
  event_code: string | null;
  event_date: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_key: string | null;
  status: string | null;
  client_id: string | null;
  meta_ad_account_id: string | null;
};

type CopyRow = {
  meta_ad_id: string;
  bodies: string[] | null;
  titles: string[] | null;
  effective_object_story_id: string | null;
  fetched_at: string | null;
};

type MembershipRow = { id: string; event_id: string; artist_id: string; billing_order: number | null };
type LabFactRow = { event_id: string; lineup: string[] | null; headliners: string[] | null };
type ClientPageRow = { id: string; default_page_ids: string[] | null; meta_ad_account_id: string | null };
type DraftPageRow = { client_id: string | null; meta_page_id: string | null };

/** Every table the copy jobs read, read once. */
export type CopySources = {
  copies: CopyRow[];
  events: EventRow[];
  artists: ExistingArtist[];
  memberships: MembershipRow[];
  labFacts: LabFactRow[];
  clientPages: ClientPageRow[];
  draftPages: DraftPageRow[];
};

export type CopyLibrary = {
  ads: ScoreAd[];
  /** Name-only templates left out of copy_performance. */
  droppedNameOnly: number;
};

const PAGE = 1000;

async function loadPage<T>(db: Db, table: string, columns: string, order: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).order(order, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export async function loadCopySources(db: Db): Promise<CopySources> {
  const [copies, events, artists, memberships, labFacts, clientPages, draftPages] = await Promise.all([
    loadPage<CopyRow>(db, "ad_copy", "meta_ad_id, bodies, titles, effective_object_story_id, fetched_at", "meta_ad_id"),
    loadPage<EventRow>(db, "events", "id, name, event_code, event_date, venue_name, venue_city, venue_key, status, client_id, meta_ad_account_id", "id"),
    loadPage<ExistingArtist>(db, "artists", "id, name, spotify_id", "id"),
    loadPage<MembershipRow>(db, "event_artists", "id, event_id, artist_id, billing_order", "id"),
    loadPage<LabFactRow>(db, "creative_lab_event_facts", "event_id, lineup, headliners", "event_id"),
    loadPage<ClientPageRow>(db, "clients", "id, default_page_ids, meta_ad_account_id", "id"),
    loadPublishedPromoterPages(db),
  ]);
  return { copies, events, artists: artists.filter((artist) => artist.name?.trim()), memberships, labFacts, clientPages, draftPages };
}

export function existingLinks(sources: CopySources): ExistingLink[] {
  return sources.memberships.map((row) => ({ event_id: row.event_id, artist_id: row.artist_id }));
}

/** event id → linked artist names in billing order. */
export function linkedLineups(sources: CopySources): Map<string, string[]> {
  const artistName = new Map(sources.artists.map((artist) => [artist.id, artist.name.trim()]));
  const lineupByEvent = new Map<string, string[]>();
  const ordered = [...sources.memberships].sort((a, b) => (a.billing_order ?? 0) - (b.billing_order ?? 0));
  for (const row of ordered) {
    const name = artistName.get(row.artist_id);
    if (!name) continue;
    const list = lineupByEvent.get(row.event_id) ?? [];
    if (!list.some((have) => have.toLowerCase() === name.toLowerCase())) list.push(name);
    lineupByEvent.set(row.event_id, list);
  }
  return lineupByEvent;
}

export type PlacedAd = {
  metaAdId: string;
  stage: CopyStage;
  eventId: string;
  /** Client of the ledger, used when the event has none. */
  ledgerClientId: string;
  spend: number;
  results: number;
};

/** One row per ad × stage, on the one event the ad counts toward. */
export function placeCopyAds(sources: CopySources, facts: readonly LearningFact[]): PlacedAd[] {
  const eventOf = new Map(sources.events.map((event) => [event.id, event]));
  const clientAccount = new Map(sources.clientPages.map((row) => [row.id, row.meta_ad_account_id]));
  const codedEvents: CodedEvent[] = sources.events
    .filter((event) => event.event_code?.trim())
    .map((event) => ({
      eventId: event.id,
      clientId: event.client_id,
      eventCode: event.event_code!.trim(),
      adAccountId: normalizeAdAccountId(
        resolveEventAdAccountId(event, event.client_id ? clientAccount.get(event.client_id) : null),
      ),
    }));
  const namedShows: NamedShow[] = sources.events
    .filter((event) => event.status !== "cancelled" && event.event_date && event.name?.trim())
    .map((event) => ({ eventId: event.id, clientId: event.client_id, name: event.name!.trim() }));
  const rolled = new Map<string, { stage: CopyStage; clientId: string; parts: { eventId: string; spend: number; results: number }[] }>();
  for (const fact of facts) {
    if (fact.stage !== "registration" && fact.stage !== "ticket_sale") continue;
    if (!fact.clientId || !fact.eventId) continue;
    const placed = eventForCopyAd(
      fact.row,
      { clientId: fact.clientId, eventId: fact.eventId, eventName: eventOf.get(fact.eventId)?.name },
      codedEvents,
      namedShows,
    );
    const stage: CopyStage = fact.stage;
    const key = `${fact.row.meta_ad_id}|${stage}`;
    const have = rolled.get(key) ?? { stage, clientId: placed.clientId, parts: [] };
    have.clientId = placed.clientId;
    have.parts.push({ eventId: placed.eventId, spend: fact.spendGbp, results: fact.result ?? 0 });
    rolled.set(key, have);
  }
  const out: PlacedAd[] = [];
  for (const [key, { stage, clientId, parts }] of rolled) {
    const chosen = rollAd(parts);
    if (!chosen) continue;
    out.push({ metaAdId: key.slice(0, key.lastIndexOf("|")), stage, eventId: chosen.eventId, ledgerClientId: clientId, spend: chosen.spend, results: chosen.results });
  }
  return out;
}

function linesOf(texts: readonly string[] | null, field: CopyField, dict: CopyDictionaries): ScoreAd["lines"] {
  const lines: ScoreAd["lines"] = [];
  const seen = new Set<string>();
  for (const text of texts ?? []) {
    const normalised = normaliseCopy(text, dict);
    if (!normalised || seen.has(`${field}|${normalised.key}`)) continue;
    seen.add(`${field}|${normalised.key}`);
    lines.push({ field, key: normalised.key, text: text.trim().slice(0, 500) });
  }
  return lines;
}

export type BuildCopyLibraryOptions = {
  /** Names the artist job is about to link, event id → names. Read as if already in event_artists. */
  extraLineups?: ReadonlyMap<string, readonly string[]>;
};

export function buildCopyLibrary(
  sources: CopySources,
  facts: readonly LearningFact[],
  clients: readonly LearningClient[],
  options: BuildCopyLibraryOptions = {},
): CopyLibrary {
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const verticalOf = new Map(clients.map((client) => [client.id, client.vertical]));
  const promoterPages = new Map<string, string[]>();
  for (const row of sources.clientPages) promoterPages.set(row.id, [...(row.default_page_ids ?? [])]);
  for (const row of sources.draftPages) {
    const page = row.meta_page_id?.trim();
    if (!row.client_id || !page) continue;
    const list = promoterPages.get(row.client_id) ?? [];
    if (!list.includes(page)) list.push(page);
    promoterPages.set(row.client_id, list);
  }
  const lineupByEvent = linkedLineups(sources);
  const globalByKey = new Map(sources.artists.map((artist) => [artist.name.trim().toLowerCase(), artist.name.trim()]));
  for (const [eventId, names] of options.extraLineups ?? []) {
    const list = lineupByEvent.get(eventId) ?? [];
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      if (!globalByKey.has(trimmed.toLowerCase())) globalByKey.set(trimmed.toLowerCase(), trimmed);
      if (!list.some((have) => have.toLowerCase() === trimmed.toLowerCase())) list.push(trimmed);
    }
    lineupByEvent.set(eventId, list);
  }
  const typedLineup = new Map(sources.labFacts.map((row) => [row.event_id, (row.lineup ?? []).map((name) => name.trim()).filter(Boolean)]));
  const eventOf = new Map(sources.events.map((event) => [event.id, event]));

  const globalArtists = [...globalByKey.values()];
  const globalVenues = sources.events.map((event) => event.venue_name?.trim() ?? "").filter(Boolean);
  const globalCities = sources.events.map((event) => event.venue_city?.trim() ?? "").filter(Boolean);
  const globalEvents = sources.events.map((event) => event.name?.trim() ?? "").filter(Boolean);
  const globalPromoters = [...clientName.values()];

  const shows = showOf(sources.events.map(showEvent));
  const copyOf = new Map(sources.copies.map((row) => [row.meta_ad_id, row]));

  const ads: ScoreAd[] = [];
  for (const placed of placeCopyAds(sources, facts)) {
    const showId = shows.get(placed.eventId);
    if (!showId) continue;
    const copy = copyOf.get(placed.metaAdId);
    const event = eventOf.get(placed.eventId);
    if (!event) continue;
    const clientId = event.client_id ?? placed.ledgerClientId;
    const lineup = lineupByEvent.get(event.id) ?? [];
    const names = lineup.length ? lineup : typedLineup.get(event.id) ?? [];
    const dict: CopyDictionaries = {
      lineup: names,
      venueName: event.venue_name,
      venueCity: event.venue_city,
      eventName: event.name,
      clientName: clientName.get(clientId) ?? null,
      globalArtists,
      globalVenues,
      globalCities,
      globalEvents,
      globalPromoters,
    };
    const voice: { voice: Voice; pageId: string | null } = voiceOf(copy?.effective_object_story_id, promoterPages.get(clientId) ?? []);
    const lines = copy ? [...linesOf(copy.bodies, "body", dict), ...linesOf(copy.titles, "title", dict)] : [];
    ads.push({
      metaAdId: placed.metaAdId,
      eventId: placed.eventId,
      showId,
      eventCode: event.event_code,
      eventName: event.name,
      eventDate: event.event_date,
      venue: event.venue_name,
      pageId: voice.pageId,
      clientId,
      vertical: verticalOf.get(clientId)?.trim() || null,
      stage: placed.stage,
      voice: voice.voice,
      spend: placed.spend,
      results: placed.results,
      lines,
    });
  }
  return { ads, droppedNameOnly: nameOnlyTemplateCount(ads) };
}

export async function loadCopyLibrary(
  db: Db,
  facts: readonly LearningFact[],
  clients: readonly LearningClient[],
  options: BuildCopyLibraryOptions & { sources?: CopySources } = {},
): Promise<CopyLibrary> {
  const sources = options.sources ?? (await loadCopySources(db));
  return buildCopyLibrary(sources, facts, clients, options);
}

export type ArtistExtractionOptions = {
  /** Only events with an ad whose copy row was written at or after this time. Unset: every event with copy. */
  since?: string;
  /** Only these event codes. */
  eventCodes?: readonly string[];
};

/**
 * One ExtractionEvent per event that has placed ads with copy, for an
 * active client. Campaign and ad-set names come from the ads' insight
 * rows; the lineup and headliners from the Lab facts; `linked` from
 * event_artists.
 */
export function artistExtractionInputs(
  sources: CopySources,
  facts: readonly LearningFact[],
  clients: readonly LearningClient[],
  archivedClientIds: ReadonlySet<string>,
  options: ArtistExtractionOptions = {},
): { events: ExtractionEvent[]; world: ExtractionWorld } {
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const eventOf = new Map(sources.events.map((event) => [event.id, event]));
  const copyOf = new Map(sources.copies.map((row) => [row.meta_ad_id, row]));
  const lineupByEvent = linkedLineups(sources);
  const labByEvent = new Map(sources.labFacts.map((row) => [row.event_id, row]));
  const namesByAd = new Map<string, { campaigns: Set<string>; adSets: Set<string> }>();
  for (const fact of facts) {
    const have = namesByAd.get(fact.row.meta_ad_id) ?? { campaigns: new Set(), adSets: new Set() };
    if (fact.row.campaign_name?.trim()) have.campaigns.add(fact.row.campaign_name.trim());
    if (fact.row.adset_name?.trim()) have.adSets.add(fact.row.adset_name.trim());
    namesByAd.set(fact.row.meta_ad_id, have);
  }
  const perEvent = new Map<string, { ads: Map<string, string[]>; campaigns: Set<string>; adSets: Set<string>; fresh: boolean; clientId: string | null }>();
  for (const placed of placeCopyAds(sources, facts)) {
    const copy = copyOf.get(placed.metaAdId);
    if (!copy) continue;
    const event = eventOf.get(placed.eventId);
    if (!event) continue;
    const clientId = event.client_id ?? placed.ledgerClientId;
    if (archivedClientIds.has(clientId)) continue;
    const have = perEvent.get(placed.eventId) ?? { ads: new Map(), campaigns: new Set(), adSets: new Set(), fresh: false, clientId };
    have.ads.set(placed.metaAdId, [...(copy.bodies ?? []), ...(copy.titles ?? [])].filter((text) => text?.trim()));
    const names = namesByAd.get(placed.metaAdId);
    for (const name of names?.campaigns ?? []) have.campaigns.add(name);
    for (const name of names?.adSets ?? []) have.adSets.add(name);
    if (!options.since || (copy.fetched_at ?? "") >= options.since) have.fresh = true;
    perEvent.set(placed.eventId, have);
  }
  const wanted = options.eventCodes ? new Set(options.eventCodes.map((code) => code.trim().toLowerCase())) : null;
  const events: ExtractionEvent[] = [];
  for (const [eventId, have] of perEvent) {
    if (!have.fresh) continue;
    const event = eventOf.get(eventId)!;
    if (wanted && !wanted.has((event.event_code ?? "").trim().toLowerCase())) continue;
    const lab = labByEvent.get(eventId);
    events.push({
      eventId,
      eventCode: event.event_code,
      eventName: event.name,
      venueName: event.venue_name,
      venueCity: event.venue_city,
      clientName: have.clientId ? clientName.get(have.clientId) ?? null : null,
      campaignNames: [...have.campaigns].sort(),
      adSetNames: [...have.adSets].sort(),
      ads: [...have.ads].map(([metaAdId, texts]) => ({ metaAdId, texts })),
      labLineup: (lab?.lineup ?? []).map((name) => name.trim()).filter(Boolean),
      labHeadliners: (lab?.headliners ?? []).map((name) => name.trim()).filter(Boolean),
      linked: lineupByEvent.get(eventId) ?? [],
    });
  }
  events.sort((a, b) => b.ads.length - a.ads.length || (a.eventCode ?? "").localeCompare(b.eventCode ?? ""));
  const world: ExtractionWorld = {
    venues: [...new Set(sources.events.map((event) => event.venue_name?.trim() ?? "").filter(Boolean))],
    cities: [...new Set(sources.events.map((event) => event.venue_city?.trim() ?? "").filter(Boolean))],
    clients: [...new Set(clients.map((client) => client.name.trim()).filter(Boolean))],
    knownArtists: sources.artists.map((artist) => artist.name.trim()),
  };
  return { events, world };
}

function showEvent(event: EventRow): ShowEvent {
  return {
    id: event.id,
    date: event.event_date,
    venueName: event.venue_name,
    venueKey: event.venue_key,
    status: event.status,
  };
}

async function loadPublishedPromoterPages(db: Db): Promise<DraftPageRow[]> {
  const rows: DraftPageRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("campaign_drafts")
      .select("client_id, meta_page_id:draft_json->settings->>metaPageId")
      .eq("status", "published")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`campaign_drafts: ${error.message}`);
    const chunk = (data ?? []) as DraftPageRow[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export function computeCopyPerformance(library: CopyLibrary): CopyPerformanceRow[] {
  return scoreTemplates(library.ads);
}

export const COPY_PERFORMANCE_CONFLICT = "template_key,field,stage,voice,scope,scope_id";

export async function writeCopyPerformance(
  db: Db,
  rows: readonly CopyPerformanceRow[],
  updatedAt: string,
): Promise<{ written: number; deleted: number }> {
  if (!rows.length) {
    console.warn("[learning-refresh] copy_performance: no rows, delete skipped");
    return { written: 0, deleted: 0 };
  }
  let written = 0;
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200).map((row) => {
      const { shows, ads_hash, ...stored } = row;
      void ads_hash;
      void shows;
      return { ...stored, updated_at: updatedAt };
    });
    const { error } = await db.from("copy_performance").upsert(chunk, { onConflict: COPY_PERFORMANCE_CONFLICT });
    if (error) throw new Error(`copy_performance upsert: ${error.message} (written ${written})`);
    written += chunk.length;
  }
  const { error, count } = await db.from("copy_performance").delete({ count: "exact" }).lt("updated_at", updatedAt);
  if (error) throw new Error(`copy_performance stale delete: ${error.message}`);
  return { written, deleted: count ?? 0 };
}

export function scopeCounts(rows: readonly CopyPerformanceRow[]): Record<"client" | "vertical" | "all", number> {
  const counts = { client: 0, vertical: 0, all: 0 };
  for (const row of rows) counts[row.scope] += 1;
  return counts;
}
