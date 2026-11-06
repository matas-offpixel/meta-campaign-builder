/**
 * The lineup is event_artists. A save writes those rows, then copies
 * the names into creative_lab_event_facts so the caption checks keep
 * reading the same arrays. Clearance stays on the client's Lab row.
 */

import type { ServiceRoleDb } from "./load.ts";

type Row = Record<string, unknown>;

export type LineupSlot = { artistId: string; name: string; isHeadliner: boolean };

export type LibrarySuggestion = {
  id: string;
  name: string;
  spotifyId: string | null;
  imageUrl: string | null;
  added: boolean;
};

export type SpotifySuggestion = {
  spotifyId: string;
  name: string;
  imageUrl: string | null;
  genres: string[];
  instagramHandle: string | null;
  tiktokHandle: string | null;
  musicbrainzId: string | null;
  profileJson?: Record<string, unknown>;
  added: boolean;
};

export const P26_BDAY_LINEUP = [
  { name: "Enzo Siragusa", headliner: true },
  { name: "Luke Dean", headliner: true },
  { name: "Reeshy", headliner: true },
  { name: "Phill de Janeiro", headliner: false },
  { name: "Benji King", headliner: false },
] as const;

function text(row: Row | null | undefined, key: string): string {
  return String(row?.[key] ?? "").trim();
}

export function artistKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Names in billing order. Headliners are the starred names, in that same order. */
export function lineupFacts(slots: readonly LineupSlot[]): { lineup: string[]; headliners: string[] } {
  const lineup = slots.map((slot) => slot.name.trim()).filter(Boolean);
  const headliners = slots.filter((slot) => slot.isHeadliner).map((slot) => slot.name.trim()).filter(Boolean);
  return { lineup, headliners };
}

export function tagSuggestions(args: {
  query: string;
  library: readonly { id: string; name: string; spotifyId: string | null; imageUrl: string | null }[];
  spotify: readonly Omit<SpotifySuggestion, "added">[];
  onLineupIds: ReadonlySet<string>;
}): { library: LibrarySuggestion[]; spotify: SpotifySuggestion[] } {
  const query = artistKey(args.query);
  const library = args.library
    .filter((row) => !query || artistKey(row.name).includes(query) || (row.spotifyId ?? "").toLowerCase().includes(query))
    .map((row) => ({ ...row, added: args.onLineupIds.has(row.id) }));
  const knownSpotify = new Set(args.library.map((row) => row.spotifyId).filter((id): id is string => Boolean(id)));
  const onLineupSpotify = new Set(
    args.library.filter((row) => args.onLineupIds.has(row.id) && row.spotifyId).map((row) => row.spotifyId as string),
  );
  const spotify = args.spotify
    .filter((row) => row.spotifyId && !knownSpotify.has(row.spotifyId))
    .map((row) => ({ ...row, added: onLineupSpotify.has(row.spotifyId) }));
  return { library, spotify };
}

export function allowedDatesFromEvent(
  event: { presale_at?: string | null; general_sale_at?: string | null },
  stored: readonly string[] | null | undefined,
): string[] {
  const sale = [event.presale_at, event.general_sale_at]
    .map((day) => day?.slice(0, 10) ?? "")
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
  const unique = [...new Set(sale)];
  if (unique.length) return unique;
  return (stored ?? []).map((day) => day.slice(0, 10)).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));
}

/** Event cities when this artist played them, otherwise the cities typed on the Lab row. */
export function playedBefore(eventCities: readonly string[], playedCities: readonly string[]): string[] {
  const fromEvents = eventCities.map((city) => city.trim()).filter(Boolean);
  if (fromEvents.length) return [...new Set(fromEvents)];
  return playedCities.map((city) => city.trim()).filter(Boolean);
}

export function clearedOn(at: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }).format(new Date(at));
}

export function labNextStep(args: {
  lineupCount: number;
  unclearedWithClips: boolean;
  captionsWaiting: boolean;
  roundReady: boolean;
  runningRound: number | null;
  clipCount: number;
}): { text: string; target: "lab-lineup" | "lab-clips" | "lab-captions" | "lab-round" } {
  if (args.unclearedWithClips) return { text: "Clear the artists whose clips you would run.", target: "lab-lineup" };
  if (args.captionsWaiting) return { text: "Approve a caption.", target: "lab-captions" };
  if (args.roundReady) return { text: "Propose the round.", target: "lab-round" };
  if (args.runningRound != null) return { text: `Round ${args.runningRound} is running.`, target: "lab-round" };
  if (args.lineupCount === 0) return { text: "Add the lineup.", target: "lab-lineup" };
  if (args.clipCount === 0) return { text: "Add a clip.", target: "lab-clips" };
  return { text: "Add a clip.", target: "lab-clips" };
}

export type BackfillPlan = {
  eventId: string;
  createArtists: string[];
  rows: { name: string; billingOrder: number; isHeadliner: boolean; artistId: string | null; create: boolean }[];
  links: { labArtistId: string; name: string }[];
};

/** What the one-off script would write. It does not write. */
export function planLineupBackfill(args: {
  eventId: string;
  names: readonly { name: string; headliner: boolean }[];
  artists: readonly { id: string; name: string }[];
  labArtists: readonly { id: string; name: string }[];
}): BackfillPlan {
  const library = new Map(args.artists.map((row) => [artistKey(row.name), row.id]));
  const rows = args.names.map((slot, index) => {
    const artistId = library.get(artistKey(slot.name)) ?? null;
    return {
      name: slot.name,
      billingOrder: index + 1,
      isHeadliner: slot.headliner,
      artistId,
      create: artistId == null,
    };
  });
  const links = args.labArtists
    .filter((row) => args.names.some((slot) => artistKey(slot.name) === artistKey(row.name)))
    .map((row) => ({ labArtistId: row.id, name: row.name }));
  return {
    eventId: args.eventId,
    createArtists: rows.filter((row) => row.create).map((row) => row.name),
    rows,
    links,
  };
}

async function rowsOf(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as Row[];
}

export async function saveLabLineup(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; slots: readonly { artistId: string; isHeadliner: boolean }[] },
): Promise<{ lineup: string[]; headliners: string[] }> {
  const artists = await rowsOf(db, "artists", "user_id", args.userId);
  const byId = new Map(artists.map((row) => [text(row, "id"), text(row, "name")]));
  const seen = new Set<string>();
  const slots: LineupSlot[] = [];
  for (const slot of args.slots) {
    const name = byId.get(slot.artistId);
    if (!name || seen.has(slot.artistId)) continue;
    seen.add(slot.artistId);
    slots.push({ artistId: slot.artistId, name, isHeadliner: slot.isHeadliner });
  }
  const facts = lineupFacts(slots);
  const removed = await db.from("event_artists").delete().eq("event_id", args.eventId);
  if (removed.error) throw new Error(removed.error.message);
  if (slots.length) {
    const inserted = await db.from("event_artists").insert(
      slots.map((slot, index) => ({
        user_id: args.userId,
        event_id: args.eventId,
        artist_id: slot.artistId,
        is_headliner: slot.isHeadliner,
        billing_order: index + 1,
      })),
    );
    if (inserted.error) throw new Error(inserted.error.message);
  }
  const existing = await db.from("creative_lab_event_facts").select("*").eq("event_id", args.eventId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const allowed = (existing.data as Row | null)?.allowed_dates;
  const saved = await db.from("creative_lab_event_facts").upsert(
    {
      user_id: args.userId,
      event_id: args.eventId,
      lineup: facts.lineup,
      headliners: facts.headliners,
      allowed_dates: Array.isArray(allowed) ? allowed : [],
    },
    { onConflict: "event_id" },
  );
  if (saved.error) throw new Error(saved.error.message);
  return facts;
}

export type SpotifyPick = {
  name: string;
  spotifyId: string;
  imageUrl: string | null;
  genres: string[];
  instagramHandle: string | null;
  tiktokHandle: string | null;
  musicbrainzId: string | null;
  profileJson: Record<string, unknown>;
};

/** A Spotify-only pick becomes a library artist, then a lineup row. No Lab row yet. */
export async function addSpotifyToLineup(
  db: ServiceRoleDb,
  args: { userId: string; eventId: string; pick: SpotifyPick; now?: Date },
): Promise<{ artistId: string }> {
  const name = args.pick.name.trim();
  const spotifyId = args.pick.spotifyId.trim();
  if (!name || !spotifyId) throw new Error("Spotify did not return an artist.");
  const artists = await rowsOf(db, "artists", "user_id", args.userId);
  let artistId = text(artists.find((row) => text(row, "spotify_id") === spotifyId), "id");
  if (!artistId) {
    const inserted = await db
      .from("artists")
      .insert({
        user_id: args.userId,
        name,
        spotify_id: spotifyId,
        profile_image_url: args.pick.imageUrl,
        genres: args.pick.genres,
        instagram_handle: args.pick.instagramHandle,
        tiktok_handle: args.pick.tiktokHandle,
        musicbrainz_id: args.pick.musicbrainzId,
        profile_jsonb: args.pick.profileJson,
        enriched_at: (args.now ?? new Date()).toISOString(),
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not save the artist.");
    artistId = text(inserted.data as Row, "id");
  }
  const roster = await rowsOf(db, "event_artists", "event_id", args.eventId);
  const ordered = roster.slice().sort((a, b) => (Number(a.billing_order) || 0) - (Number(b.billing_order) || 0));
  if (!ordered.some((row) => text(row, "artist_id") === artistId)) {
    await saveLabLineup(db, {
      userId: args.userId,
      eventId: args.eventId,
      slots: [
        ...ordered.map((row) => ({ artistId: text(row, "artist_id"), isHeadliner: row.is_headliner === true })),
        { artistId, isHeadliner: false },
      ],
    });
  }
  return { artistId };
}

/** The client's Lab row for this library artist. A tick on it covers every show. */
export async function labArtistForLibrary(
  db: ServiceRoleDb,
  args: { userId: string; clientId: string; libraryArtistId: string; name: string },
): Promise<string> {
  const rows = await rowsOf(db, "creative_lab_artists", "client_id", args.clientId);
  const linked = rows.find((row) => text(row, "artist_id") === args.libraryArtistId);
  if (linked) return text(linked, "id");
  const byName = rows.find((row) => artistKey(text(row, "name")) === artistKey(args.name));
  if (byName) {
    const updated = await db
      .from("creative_lab_artists")
      .update({ artist_id: args.libraryArtistId })
      .eq("id", text(byName, "id"))
      .eq("user_id", args.userId);
    if (updated.error) throw new Error(updated.error.message);
    return text(byName, "id");
  }
  const inserted = await db
    .from("creative_lab_artists")
    .insert({
      user_id: args.userId,
      client_id: args.clientId,
      name: args.name.trim(),
      artist_id: args.libraryArtistId,
      clip_source: "file",
      played_cities: [],
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) throw new Error(inserted.error?.message || "Could not save the artist.");
  return text(inserted.data as Row, "id");
}
