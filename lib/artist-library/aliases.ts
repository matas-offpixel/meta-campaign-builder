/**
 * lib/artist-library/aliases.ts — the names the matcher knows, beyond `artists`.
 *
 * `artists` has no aliases or kind column, and adding one needs a
 * migration, so these live here, like the source map: data, each line with
 * who said so and when.
 *
 *   ALIASES            confirmed other names for an artist. Matched like the
 *                      full name: folded for case, accents and punctuation,
 *                      whole words only ("AT - Static" is Adam Ten; "Static"
 *                      and "Late Entry" aren't). They count for the ad name,
 *                      the ad set name and the headliner rule, except an
 *                      alias marked notForShows (also an ordinary word),
 *                      which never counts in a show's code or name.
 *   PROPOSED_ALIASES   names waiting for a confirmation. The matcher never
 *                      reads this list; a line moves to ALIASES when it is
 *                      confirmed.
 *   BRANDS             `artists` rows that are brands, events, stages or
 *                      genres, not acts. They are never matched as an artist.
 *   AD_NAME_ONLY       `artists` rows that may be ordinary words. Until
 *                      someone says they are acts, they match only as a
 *                      whole word in the ad name: never through an ad set
 *                      name or a show's code or name.
 *   OTHER_ACTS         acts on a bill with no `artists` row. An ad naming one
 *                      is that act's: it is never a show's general ad, so no
 *                      headliner gets it, and with no row it goes to no one.
 *
 * The matcher also takes the Lab's own name for an artist
 * (creative_lab_artists.name) when it differs from the artists row.
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
  /**
   * Set when the alias is also an ordinary word that shows are named with:
   * it still matches ad and ad set names, but never makes a show's
   * headliner from its code or name.
   */
  notForShows?: string;
}

export interface NameMark {
  /** artists.id */
  artistId: string;
  /** The artists row's name, for whoever checks. */
  name: string;
  markedBy: string;
  /** YYYY-MM-DD */
  markedOn: string;
  note: string;
}

export interface OtherAct {
  name: string;
  namedBy: string;
  /** YYYY-MM-DD */
  namedOn: string;
  note: string;
}

const confirmed = (artistId: string, alias: string, note: string): AliasEntry => ({ artistId, alias, confirmedBy: "Matas", confirmedOn: "2026-11-25", note });

export const ALIASES: readonly AliasEntry[] = [
  confirmed(
    "e93a9b7b-76a7-4e7d-816a-354f90666bff",
    "Enzo",
    "Enzo Siragusa. Puzzle's P26-BDAY ads name him \"Enzo - …\" and \"Puzzle - Enzo …\"; the brief folds \"Puzzle - Enzo UGC 1\" into his UGC 1. NX26-ENZO's code names him only through this alias (its name, \"Enzo Siragusa Halloween\", holds the full name).",
  ),
  confirmed("0df6c19d-7274-4145-b7fc-713989ae4a05", "MG", "Mall Grab: confirmed by Matas, 25 Nov."),
  confirmed("29af4515-c858-4a4c-b55b-8ebaede5c15a", "CDW", "Charlotte de Witte: confirmed by Matas, 25 Nov."),
  confirmed("d9278c69-fb15-4ddd-af0e-c8464da022ac", "JJ", "Jamie Jones: confirmed by Matas, 25 Nov."),
  {
    ...confirmed("a4a55d2f-c29f-4575-afa5-e3c8859947df", "AT", "Adam Ten: confirmed by Matas, 25 Nov. AT counts in ad names only, Matas 25 Nov."),
    notForShows: "AT counts in ad names only, Matas 25 Nov: \"at\" is a word in show names, and \"Puzzle at Circuit\" (P26-CIRCUIT) would headline Adam Ten",
  },
  confirmed("66dab67b-91c0-48b4-960a-d28b3e2c8a9f", "EED", "East End Dubs: confirmed by Matas, 25 Nov."),
  confirmed("34f21fc5-2cf9-421b-ae74-908c6853346d", "PB69", "Partiboi69: confirmed by Matas, 25 Nov."),
];

/** Waiting for a confirmation; never read by the matcher. HMD stays unmatched (unknown, Matas 25 Nov). */
export const PROPOSED_ALIASES: readonly Omit<AliasEntry, "confirmedBy" | "confirmedOn">[] = [];

const mark = (artistId: string, name: string, note: string): NameMark => ({ artistId, name, markedBy: "Matas", markedOn: "2026-11-25", note });

export const BRANDS: readonly NameMark[] = [
  mark("c58061b4-4c00-471e-a023-afa456f584e7", "Glitterbox", "a brand or event, not an act"),
  mark("61e0485a-53e5-48e7-b16b-ebc84a397e8f", "Innervisions", "a brand or event, not an act"),
  mark("ea53eb06-7708-4289-8856-2cd35240a180", "Appetite", "a brand or event, not an act"),
  mark("a9f51d14-4109-4248-87c8-7c693704d188", "Hard", "Matas, 25 Nov: Junction 2 stage / genre names"),
  mark("d63f15b5-b206-4043-ad53-02c57a00ea45", "Bridge", "Matas, 25 Nov: Junction 2 stage / genre names"),
  mark("1f2a7d78-2223-42a3-85ce-25a5eabed40c", "Fragrance", "Matas, 25 Nov: Junction 2 stage / genre names"),
];

/** None waiting today: Hard, Bridge and Fragrance were ruled brands (stage / genre names), Matas 25 Nov. */
export const AD_NAME_ONLY: readonly NameMark[] = [];

const named = (name: string): OtherAct => ({ name, namedBy: "Matas", namedOn: "2026-11-25", note: "named by Matas for removal, 25 Nov: another act on NX26-ENZO's bill, not a general ad" });

export const OTHER_ACTS: readonly OtherAct[] = [named("LILI"), named("PACH.")];
