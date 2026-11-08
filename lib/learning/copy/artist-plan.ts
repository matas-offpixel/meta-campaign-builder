/**
 * From candidates to rows. The plan is what `--apply` and the nightly
 * job would write: library artists (one per name, Spotify id when it
 * confirmed) and event_artists links with a source. Nothing here reads
 * or writes a database; writeArtistPlan does the writes.
 *
 * A Lab lineup name or a name already in the library is linked as is.
 * Any other candidate is linked only when Spotify confirms it (an exact
 * name; no follower test). Several exact Spotify names confirm the act
 * but the row gets spotify_id null and the hits as candidates for the
 * Lab to pick. The copy's own casing is kept ("MiNNA", "D.O.D") unless
 * the copy only shouts it ("GROOVE ARMADA"), then Spotify's. With no
 * confirmer the candidate stays unconfirmed and nothing is written for
 * it, unless `assumeConfirmed` (dry runs only) counts a copy-backed one
 * as a yes to show the ceiling; a name only a campaign name carries is
 * never assumed. An "X & Y" Spotify does not know is tried as X and
 * Y. A Lab-written row is never changed; a Spotify id already set is
 * never replaced.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ArtistConfirmer, ArtistHit } from "./artist-confirm.ts";
import {
  compoundParts,
  extractArtists,
  nameKey,
  primarySource,
  type ArtistSource,
  type Candidate,
  type ExtractionEvent,
  type ExtractionWorld,
  type Rejected,
} from "./artist-extraction.ts";

export type ExistingArtist = { id: string; name: string; spotify_id: string | null };
export type ExistingLink = { event_id: string; artist_id: string };

export type AcceptedVia = "lineup" | "known" | "spotify" | "assumed";

export type PlannedArtist = {
  name: string;
  /** Library row to reuse; null means insert. */
  existingId: string | null;
  /** The one exact Spotify artist. Null when none or several. */
  spotify: ArtistHit | null;
  /** Several exact Spotify names: written as profile_jsonb.spotify_candidates for the Lab to pick. */
  candidates: ArtistHit[];
  via: AcceptedVia;
};

export type PlannedLink = {
  eventId: string;
  name: string;
  source: ArtistSource;
  isHeadliner: boolean;
  via: AcceptedVia;
  ads: number;
};

export type EventReport = {
  eventId: string;
  eventCode: string | null;
  eventName: string | null;
  ads: number;
  accepted: PlannedLink[];
  /** Candidates Spotify was asked about and said no to. */
  spotifyNo: { name: string; reason: string; ads: number; sources: ArtistSource[] }[];
  /** Candidates that needed Spotify when it was not available or the search budget was spent. */
  unconfirmed: { name: string; ads: number; sources: ArtistSource[] }[];
  rejected: Rejected[];
  alreadyLinked: string[];
};

export type ArtistPlan = {
  artists: PlannedArtist[];
  links: PlannedLink[];
  events: EventReport[];
  /** event id → names that will be on its lineup after the write (existing links plus planned). */
  lineups: Map<string, string[]>;
  searches: number;
  counts: { events: number; candidates: number; confirmed: number; known: number; lineup: number; assumed: number; spotifyNo: number; unconfirmed: number; rejected: number };
  spotify: "configured" | "missing";
};

export type PlanArgs = {
  events: readonly ExtractionEvent[];
  world: ExtractionWorld;
  existing: readonly ExistingArtist[];
  confirm: ArtistConfirmer | null;
  /** Spotify searches this run may spend; the rest stay unconfirmed for the next run. */
  maxSearches: number;
  assumeConfirmed?: boolean;
};

export async function planArtistLibrary(args: PlanArgs): Promise<ArtistPlan> {
  const existingByKey = new Map(args.existing.map((row) => [nameKey(row.name), row]));
  const artists = new Map<string, PlannedArtist>();
  const links: PlannedLink[] = [];
  const events: EventReport[] = [];
  const lineups = new Map<string, string[]>();
  let searches = 0;
  const counts = { events: 0, candidates: 0, confirmed: 0, known: 0, lineup: 0, assumed: 0, spotifyNo: 0, unconfirmed: 0, rejected: 0 };
  const verdicts = new Map<string, { kind: "yes"; hit: ArtistHit | null; exact: ArtistHit[] } | { kind: "no"; reason: string } | { kind: "unavailable" }>();

  const ask = async (name: string) => {
    const key = nameKey(name);
    const have = verdicts.get(key);
    if (have) return have;
    if (!args.confirm || searches >= args.maxSearches) return { kind: "unavailable" as const };
    searches += 1;
    const answer = await args.confirm(name);
    const verdict = answer.kind === "yes" ? answer : answer.kind === "no" ? { kind: "no" as const, reason: answer.reason } : { kind: "unavailable" as const };
    verdicts.set(key, verdict);
    return verdict;
  };

  const plan = (eventId: string, candidate: Candidate, via: AcceptedVia, hit: ArtistHit | null, name = candidate.name, exact: ArtistHit[] = []): PlannedLink => {
    const key = nameKey(name);
    const existing = existingByKey.get(key) ?? null;
    const stored = existing?.name ?? storedCasing(name, hit ?? exact[0] ?? null);
    const have = artists.get(key);
    if (!have) {
      artists.set(key, {
        name: stored,
        existingId: existing?.id ?? null,
        spotify: existing?.spotify_id ? null : hit,
        candidates: existing?.spotify_id || hit ? [] : exact,
        via,
      });
    } else if (!have.spotify && hit && !existing?.spotify_id) {
      have.spotify = hit;
      have.candidates = [];
    }
    const link: PlannedLink = { eventId, name: stored, source: primarySource(candidate), isHeadliner: candidate.isHeadliner, via, ads: candidate.ads };
    links.push(link);
    const list = lineups.get(eventId) ?? [];
    if (!list.some((item) => nameKey(item) === key)) list.push(stored);
    lineups.set(eventId, list);
    return link;
  };

  for (const event of args.events) {
    counts.events += 1;
    const extraction = extractArtists(event, args.world);
    lineups.set(event.eventId, [...event.linked]);
    const report: EventReport = {
      eventId: event.eventId,
      eventCode: event.eventCode,
      eventName: event.eventName,
      ads: event.ads.length,
      accepted: [],
      spotifyNo: [],
      unconfirmed: [],
      rejected: extraction.rejected,
      alreadyLinked: extraction.alreadyLinked,
    };
    counts.rejected += extraction.rejected.length;
    for (const candidate of extraction.candidates) {
      counts.candidates += 1;
      if (candidate.sources.includes("lineup")) {
        counts.lineup += 1;
        report.accepted.push(plan(event.eventId, candidate, "lineup", null));
        continue;
      }
      if (candidate.known) {
        counts.known += 1;
        report.accepted.push(plan(event.eventId, candidate, "known", null));
        continue;
      }
      const verdict = await ask(candidate.name);
      if (verdict.kind === "yes") {
        counts.confirmed += 1;
        report.accepted.push(plan(event.eventId, candidate, "spotify", verdict.hit, candidate.name, verdict.exact));
        continue;
      }
      if (verdict.kind === "no") {
        let anyPart = false;
        for (const part of compoundParts(candidate.name)) {
          const partVerdict = await ask(part);
          if (partVerdict.kind === "yes") {
            anyPart = true;
            counts.confirmed += 1;
            report.accepted.push(plan(event.eventId, { ...candidate, isHeadliner: false }, "spotify", partVerdict.hit, part, partVerdict.exact));
          }
        }
        if (!anyPart) {
          counts.spotifyNo += 1;
          report.spotifyNo.push({ name: candidate.name, reason: verdict.reason, ads: candidate.ads, sources: candidate.sources });
        }
        continue;
      }
      if (args.assumeConfirmed && candidate.ads > 0) {
        counts.assumed += 1;
        report.accepted.push(plan(event.eventId, candidate, "assumed", null));
        continue;
      }
      counts.unconfirmed += 1;
      report.unconfirmed.push({ name: candidate.name, ads: candidate.ads, sources: candidate.sources });
    }
    events.push(report);
  }
  return {
    artists: [...artists.values()],
    links,
    events,
    lineups,
    searches,
    counts,
    spotify: args.confirm ? "configured" : "missing",
  };
}

function allCaps(value: string): boolean {
  return value === value.toUpperCase() && value !== value.toLowerCase();
}

/** The copy's casing, unless the copy only shouts the name and Spotify does not. */
export function storedCasing(copyName: string, spotify: { name: string } | null): string {
  const copy = copyName.trim();
  const theirs = spotify?.name.trim() ?? "";
  if (!theirs || theirs.toLowerCase() !== copy.toLowerCase()) return copy;
  return allCaps(copy) && !allCaps(theirs) ? theirs : copy;
}

type Db = Pick<SupabaseClient, "from">;

export type WriteResult = { artistsCreated: number; spotifyIdsSet: number; links: number; skippedLinks: number };

/**
 * Insert the library rows the plan needs, set a Spotify id where the row
 * has none, and insert the event_artists links. Existing links are kept
 * (so a Lab lineup is never reordered or removed); a link already there
 * is skipped.
 */
export async function writeArtistPlan(
  db: Db,
  plan: ArtistPlan,
  args: { userId: string; now: string; existingLinks: readonly ExistingLink[]; existing: readonly ExistingArtist[] },
): Promise<WriteResult> {
  const idByKey = new Map(args.existing.map((row) => [nameKey(row.name), row.id]));
  let artistsCreated = 0;
  let spotifyIdsSet = 0;
  for (const artist of plan.artists) {
    const key = nameKey(artist.name);
    if (artist.existingId) {
      idByKey.set(key, artist.existingId);
      if (artist.spotify) {
        const { error } = await db
          .from("artists")
          .update({
            spotify_id: artist.spotify.id,
            profile_image_url: artist.spotify.imageUrl,
            genres: artist.spotify.genres,
            popularity_score: artist.spotify.popularity,
            enriched_at: args.now,
          })
          .eq("id", artist.existingId)
          .is("spotify_id", null);
        if (error) throw new Error(`artists update ${artist.name}: ${error.message}`);
        spotifyIdsSet += 1;
      }
      continue;
    }
    const several = !artist.spotify && artist.candidates.length > 1;
    const row: Record<string, unknown> = {
      user_id: args.userId,
      name: artist.name,
      genres: artist.spotify?.genres ?? [],
      profile_jsonb: {
        source: "artist-library-backfill",
        spotify_lookup: artist.spotify ? "one" : several ? "several" : "pending",
        via: artist.via,
        ...(several
          ? { spotify_candidates: artist.candidates.map((hit) => ({ spotifyId: hit.id, name: hit.name, imageUrl: hit.imageUrl, genres: hit.genres })) }
          : {}),
      },
    };
    if (artist.spotify) {
      row.spotify_id = artist.spotify.id;
      row.profile_image_url = artist.spotify.imageUrl;
      row.popularity_score = artist.spotify.popularity;
      row.enriched_at = args.now;
      (row.profile_jsonb as Record<string, unknown>).spotify = {
        id: artist.spotify.id,
        name: artist.spotify.name,
        genres: artist.spotify.genres,
        image_url: artist.spotify.imageUrl,
      };
    }
    const inserted = await db.from("artists").insert(row).select("id").single();
    if (inserted.error || !inserted.data) {
      // The (user_id, name) unique key: another spelling of the same name landed first. Read it back.
      const found = await db.from("artists").select("id").eq("user_id", args.userId).eq("name", artist.name).maybeSingle();
      const id = (found.data as { id?: string } | null)?.id;
      if (!id) throw new Error(`artists insert ${artist.name}: ${inserted.error?.message ?? "no row"}`);
      idByKey.set(key, id);
      continue;
    }
    idByKey.set(key, (inserted.data as { id: string }).id);
    artistsCreated += 1;
  }

  const linked = new Set(args.existingLinks.map((row) => `${row.event_id}|${row.artist_id}`));
  const nextOrder = new Map<string, number>();
  for (const row of args.existingLinks) nextOrder.set(row.event_id, (nextOrder.get(row.event_id) ?? 0) + 1);
  let links = 0;
  let skippedLinks = 0;
  const rows: Record<string, unknown>[] = [];
  for (const link of plan.links) {
    const artistId = idByKey.get(nameKey(link.name));
    if (!artistId) throw new Error(`no artist id for ${link.name}`);
    const pair = `${link.eventId}|${artistId}`;
    if (linked.has(pair)) {
      skippedLinks += 1;
      continue;
    }
    linked.add(pair);
    const order = (nextOrder.get(link.eventId) ?? 0) + 1;
    nextOrder.set(link.eventId, order);
    rows.push({
      user_id: args.userId,
      event_id: link.eventId,
      artist_id: artistId,
      is_headliner: link.isHeadliner,
      billing_order: order,
      source: link.source,
    });
  }
  for (let start = 0; start < rows.length; start += 200) {
    const chunk = rows.slice(start, start + 200);
    const { error } = await db.from("event_artists").insert(chunk);
    if (error) throw new Error(`event_artists insert: ${error.message} (written ${links})`);
    links += chunk.length;
  }
  return { artistsCreated, spotifyIdsSet, links, skippedLinks };
}
