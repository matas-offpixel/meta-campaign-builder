/**
 * copy_performance (migration 207). DB-only. Reads ad_copy and the
 * learning facts, writes nothing until `writeCopyPerformance`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { LearningClient, LearningFact } from "./joins.ts";
import { normaliseCopy, voiceOf, type CopyDictionaries, type Voice } from "./copy/normalise.ts";
import {
  scoreTemplates,
  type CopyField,
  type CopyPerformanceRow,
  type CopyStage,
  type ScoreAd,
} from "./copy/score.ts";

type Db = Pick<SupabaseClient, "from">;

type EventRow = {
  id: string;
  name: string | null;
  venue_name: string | null;
  venue_city: string | null;
  client_id: string | null;
};

type CopyRow = {
  meta_ad_id: string;
  bodies: string[] | null;
  titles: string[] | null;
  effective_object_story_id: string | null;
};

export type CopyLibrary = {
  ads: ScoreAd[];
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

export async function loadCopyLibrary(db: Db, facts: readonly LearningFact[], clients: readonly LearningClient[]): Promise<CopyLibrary> {
  const [copies, events, artists, memberships, factRows, pageRows] = await Promise.all([
    loadPage<CopyRow>(db, "ad_copy", "meta_ad_id, bodies, titles, effective_object_story_id", "meta_ad_id"),
    loadPage<EventRow>(db, "events", "id, name, venue_name, venue_city, client_id", "id"),
    loadPage<{ id: string; name: string | null; meta_page_id: string | null }>(db, "artists", "id, name, meta_page_id", "id"),
    loadPage<{ event_id: string; artist_id: string; billing_order: number | null }>(db, "event_artists", "id, event_id, artist_id, billing_order", "id"),
    loadPage<{ event_id: string; lineup: string[] | null }>(db, "creative_lab_event_facts", "event_id, lineup", "event_id"),
    loadPage<{ id: string; default_page_ids: string[] | null }>(db, "clients", "id, default_page_ids", "id"),
  ]);

  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const verticalOf = new Map(clients.map((client) => [client.id, client.vertical]));
  const promoterPages = new Map(pageRows.map((row) => [row.id, row.default_page_ids ?? []]));
  const artistName = new Map(artists.filter((artist) => artist.name?.trim()).map((artist) => [artist.id, artist.name!.trim()]));
  const artistPage = new Map(artists.filter((artist) => artist.meta_page_id?.trim()).map((artist) => [artist.id, artist.meta_page_id!.trim()]));
  const artistIdByName = new Map([...artistName.entries()].map(([id, name]) => [name.toLowerCase(), id]));
  const lineupByEvent = new Map<string, string[]>();
  const ordered = [...memberships].sort((a, b) => (a.billing_order ?? 0) - (b.billing_order ?? 0));
  for (const row of ordered) {
    const name = artistName.get(row.artist_id);
    if (!name) continue;
    const list = lineupByEvent.get(row.event_id) ?? [];
    if (!list.some((have) => have.toLowerCase() === name.toLowerCase())) list.push(name);
    lineupByEvent.set(row.event_id, list);
  }
  const typedLineup = new Map(factRows.map((row) => [row.event_id, (row.lineup ?? []).map((name) => name.trim()).filter(Boolean)]));
  const eventOf = new Map(events.map((event) => [event.id, event]));

  const globalArtists = [...artistName.values()];
  const globalVenues = events.map((event) => event.venue_name?.trim() ?? "").filter(Boolean);
  const globalCities = events.map((event) => event.venue_city?.trim() ?? "").filter(Boolean);
  const globalEvents = events.map((event) => event.name?.trim() ?? "").filter(Boolean);
  const globalPromoters = [...clientName.values()];

  const copyOf = new Map(copies.map((row) => [row.meta_ad_id, row]));
  const rolled = new Map<string, { fact: LearningFact; stage: CopyStage; spend: number; results: number }>();
  for (const fact of facts) {
    if (fact.stage !== "registration" && fact.stage !== "ticket_sale") continue;
    if (!fact.clientId || !fact.eventId) continue;
    const stage: CopyStage = fact.stage;
    const key = `${fact.row.meta_ad_id}|${stage}`;
    const have = rolled.get(key) ?? { fact, stage, spend: 0, results: 0 };
    have.spend += fact.spendGbp;
    have.results += fact.result ?? 0;
    rolled.set(key, have);
  }

  const ads: ScoreAd[] = [];
  for (const { fact, stage, spend, results } of rolled.values()) {
    const copy = copyOf.get(fact.row.meta_ad_id);
    const event = eventOf.get(fact.eventId!);
    if (!event) {
      ads.push({
        metaAdId: fact.row.meta_ad_id,
        eventId: fact.eventId!,
        clientId: fact.clientId!,
        vertical: verticalOf.get(fact.clientId!) ?? "music",
        stage,
        voice: "unknown",
        spend,
        results,
        lines: [],
      });
      continue;
    }
    const lineup = lineupByEvent.get(event.id) ?? [];
    const names = lineup.length ? lineup : typedLineup.get(event.id) ?? [];
    const dict: CopyDictionaries = {
      lineup: names,
      venueName: event.venue_name,
      venueCity: event.venue_city,
      eventName: event.name,
      clientName: clientName.get(fact.clientId!) ?? null,
      globalArtists,
      globalVenues,
      globalCities,
      globalEvents,
      globalPromoters,
    };
    const artistPages = names
      .map((name) => artistPage.get(artistIdByName.get(name.toLowerCase()) ?? "") ?? null)
      .filter((id): id is string => Boolean(id));
    const voice: Voice = voiceOf(copy?.effective_object_story_id, promoterPages.get(fact.clientId!) ?? [], artistPages);
    const lines = copy ? [...linesOf(copy.bodies, "body", dict), ...linesOf(copy.titles, "title", dict)] : [];
    ads.push({
      metaAdId: fact.row.meta_ad_id,
      eventId: fact.eventId!,
      clientId: fact.clientId!,
      vertical: verticalOf.get(fact.clientId!) ?? "music",
      stage,
      voice,
      spend,
      results,
      lines,
    });
  }
  return { ads };
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
    const chunk = rows.slice(start, start + 200).map((row) => ({ ...row, updated_at: updatedAt }));
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
