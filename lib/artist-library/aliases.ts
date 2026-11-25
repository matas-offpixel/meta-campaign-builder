/**
 * lib/artist-library/aliases.ts — the other names an artist's ads go by.
 *
 * `artists` has no aliases column, and adding one needs a migration, so the
 * recorded aliases live here, like the source map: data, each with who said
 * so and when. The matcher (match.ts) also takes the Lab's own name for an
 * artist (creative_lab_artists.name, which an operator typed for that
 * client) when it differs from the artists row.
 *
 * An alias is matched exactly, folded for case, accents and punctuation. It
 * is never derived: "Enzo" is Enzo Siragusa's only because the line below
 * records it, not because it starts his name. Add an alias only with the
 * confirmation's who and when; a short alias that is also someone else's
 * name would hand that artist's ads over, so check the roster first.
 */

export interface AliasEntry {
  /** artists.id */
  artistId: string;
  alias: string;
  confirmedBy: string;
  /** YYYY-MM-DD */
  confirmedOn: string;
  /** What the confirmation was. */
  note: string;
}

const ENZO_SIRAGUSA = "e93a9b7b-76a7-4e7d-816a-354f90666bff";

export const ALIASES: readonly AliasEntry[] = [
  {
    artistId: ENZO_SIRAGUSA,
    alias: "Enzo",
    confirmedBy: "Matas",
    confirmedOn: "2026-11-25",
    note: "Puzzle's P26-BDAY ads name him \"Enzo - …\" and \"Puzzle - Enzo …\"; the brief folds \"Puzzle - Enzo UGC 1\" into his UGC 1.",
  },
];
