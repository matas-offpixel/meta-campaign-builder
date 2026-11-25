/**
 * lib/artist-library/source-map.ts — where a file came from, and who said so.
 *
 * Data, not code: each entry records a Drive file whose owner someone with
 * the standing to say has confirmed, and the clip it ran as on its show. An
 * ad ran the file when its name is the file's clip identity (match.ts
 * isClipIdentity): one of the artist's names (aliases.ts included) and the
 * clip label, with or without a leading client name and copy suffix, so
 * "Enzo - UGC 1", "Puzzle - Enzo UGC 1" and "Enzo - UGC 1 – Copy" are all
 * UGC 1. The backfill reads it like any other source (backfill.ts). An entry with
 * owner "artist" makes the footage the artist's, so it's shareable. Its ads
 * keep their own show and client, so their results stay tied to that show.
 * A file missing from this map keeps the rule's default: an ad the client
 * ran that nothing traces to the artist stays with the client.
 *
 * Add an entry only with the confirmation's who and when. Ids come from a
 * read-only listing of the folder, never from a name.
 */
import type { OwnerKind } from "./rights.ts";

export interface SourceEntry {
  /** artists.id */
  artistId: string;
  /** The Drive file (Off / Pixel shared drive). */
  driveFileId: string;
  /** Its name in Drive, as listed. */
  name: string;
  kind: "clip" | "static";
  /** The Drive folder it sits in, for whoever checks. */
  folderId: string;
  ownerKind: Extract<OwnerKind, "artist">;
  /** Where the footage came from. */
  source: string;
  confirmedBy: string;
  /** YYYY-MM-DD */
  confirmedOn: string;
  /** The show it ran on (event code) and its clip label there ("UGC 1"). */
  ranAs: { eventCode: string; clip: string };
}

const ENZO_SIRAGUSA = "e93a9b7b-76a7-4e7d-816a-354f90666bff";
const ENZO_UGC_FOLDER = "15jNO3RDUyUgx3hYP4u18-Br2_2cRHL-v";
const enzoUgc = (n: 1 | 2 | 3 | 4, driveFileId: string): SourceEntry => ({
  artistId: ENZO_SIRAGUSA,
  driveFileId,
  name: `Enzo Siragusa - UGC ${n}.mp4`,
  kind: "clip",
  folderId: ENZO_UGC_FOLDER,
  ownerKind: "artist",
  source: "Enzo's Instagram",
  confirmedBy: "Matas",
  confirmedOn: "2026-11-25",
  ranAs: { eventCode: "P26-BDAY", clip: `UGC ${n}` },
});

/**
 * 25 Nov 2026, Matas: Enzo Siragusa - UGC 1–4 (folder "Enzo", 22 Oct) are
 * from Enzo's Instagram, so they're his, like Raw 1–4. Later the same day
 * (the matching brief): "Puzzle - Enzo UGC 1" is UGC 1 too, so the map
 * matches on the clip, not the exact ad names.
 */
export const SOURCE_MAP: readonly SourceEntry[] = [
  enzoUgc(1, "1MsagfopHgyufwVIjdQsgPsl7_PqGc0-J"),
  enzoUgc(2, "1T7hTh0TBKeGsRlBxJScQTVKo9M6hZZzj"),
  enzoUgc(3, "1bCzrj6FkkVO_9WtKYpOwUrr3OymJK00N"),
  enzoUgc(4, "1pUXmvEDvphH6G9zhJirtm2utP8FgDDLf"),
];

/** The Drive files the map makes shareable for an artist: a re-apply never removes a row of one. */
export function sourceMapShareableFiles(sources: readonly SourceEntry[], artistId: string): Set<string> {
  return new Set(sources.filter((e) => e.artistId === artistId && e.ownerKind === "artist").map((e) => e.driveFileId));
}
