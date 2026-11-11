/**
 * Who owns a filed piece (D2, 2026-11-11-creative-lab-drive-owner-type) and
 * what their owner folder is called today (D1, D5).
 *
 * The owner is the footage's owner (creative_lab_clips.owner, migration 226),
 * read once at filing: an artist clip (T1, a UGC caption, quote mode, a
 * triple-fit — every render references its one clip) belongs to that artist;
 * a promoter clip belongs to the promoter, even when it features artists
 * (W8). A clip from before 226 with an artist_id counts as the artist's.
 *
 * An artist's folder is named exactly as the Lab lineup names them — the
 * library artist's name, the same string as 02 Source / Artist clips /
 * {artist} — else the Lab row's own name. The key is the Lab artist id
 * (creative_lab_artists.id), so a rename renames, never re-files.
 */

import { rowById, type DriveDb, type RowOf } from "./db.ts";
import { loadLineupArtists } from "./lineup.ts";
import { ownerFolderName, promoterOwner, type DriveOwner } from "./tree.ts";

export type ClipOwnerFields = Pick<RowOf<"creative_lab_clips">, "owner" | "artist_id">;

/** artist or promoter, from the clip (W1 / migration 226). */
export function clipOwnerKind(clip: ClipOwnerFields): "artist" | "promoter" {
  if (clip.owner === "promoter") return "promoter";
  if (clip.owner === "artist") return "artist";
  return clip.artist_id ? "artist" : "promoter";
}

/** The lineup string for a Lab artist: its library artist's name, else its own. */
export async function labArtistFolderName(db: DriveDb, labArtist: Pick<RowOf<"creative_lab_artists">, "name" | "artist_id">): Promise<string> {
  if (labArtist.artist_id) {
    const library = await rowById(db, "artists", labArtist.artist_id);
    if (library?.name) return library.name;
  }
  return labArtist.name;
}

export type ResolvedOwner = { owner: DriveOwner; labArtist: RowOf<"creative_lab_artists"> | null };

/**
 * The owner of a render on this clip. The promoter's folder is the client's
 * name, or "{Client} (promoter)" when a lineup artist has that name exactly.
 */
export async function resolveClipOwner(
  db: DriveDb,
  clip: ClipOwnerFields,
  event: Pick<RowOf<"events">, "id">,
  client: Pick<RowOf<"clients">, "name">,
): Promise<ResolvedOwner | null> {
  if (clipOwnerKind(clip) === "artist") {
    const labArtist = await rowById(db, "creative_lab_artists", clip.artist_id);
    if (!labArtist) return null;
    return { owner: { kind: "artist", artistId: labArtist.id, name: await labArtistFolderName(db, labArtist) }, labArtist };
  }
  const lineup = (await loadLineupArtists(db, event.id)).map((artist) => artist.name);
  return { owner: promoterOwner(client.name, lineup), labArtist: null };
}

/** Names by key for renameOwnerFolders: the Lab artist's lineup name today, and the promoter's. */
export async function ownerNameResolver(
  db: DriveDb,
  event: Pick<RowOf<"events">, "id">,
  client: Pick<RowOf<"clients">, "name">,
): Promise<(owner: { kind: "artist"; artistId: string } | { kind: "promoter" }) => Promise<string | null>> {
  const lineup = (await loadLineupArtists(db, event.id)).map((artist) => artist.name);
  const promoterName = ownerFolderName(promoterOwner(client.name, lineup));
  const artistNames = new Map<string, string | null>();
  return async (owner) => {
    if (owner.kind === "promoter") return promoterName;
    if (!artistNames.has(owner.artistId)) {
      const labArtist = await rowById(db, "creative_lab_artists", owner.artistId);
      artistNames.set(owner.artistId, labArtist ? await labArtistFolderName(db, labArtist) : null);
    }
    return artistNames.get(owner.artistId) ?? null;
  };
}
