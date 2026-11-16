/**
 * G frames: the genre key (docs/design-record/2026-11-16-genre-key.html,
 * frames G1–G4). Fixture only; the words come from lib/learning/genre/*,
 * so the frames show what the code writes.
 *
 * The counts, families and the 63 % are the record's own examples, which
 * it marks as invented: on 16 Nov 2026 no event has a confirmed genre
 * (migration 253 is new), so a real G4 today would read "no shows have a
 * genre yet". "Puzzle" is the record's client in the G3 fallback line.
 *
 * G1: the event form's Genre field, Not set, with "Suggested: Techno, from the genre tags".
 * G2: the list open at 393, Techno chosen.
 * G3: the Lab writer's genre-sourced shape line and the plan line.
 * G4: the learning-refresh report's operator status line.
 */

import type { GenreFamilyKey, GenreSuggestion } from "../../lib/learning/genre/families.ts";
import { genreStatusLines } from "../../lib/learning/genre/status-lines.ts";
import { genreFallbackLine, genrePlanLine } from "../../lib/learning/genre/wording.ts";

export const GENRE_FRAME_IDS = ["G1", "G2", "G3", "G4"] as const;
export type GenreFrameId = (typeof GENRE_FRAME_IDS)[number];

export const G1_FIELD: { value: GenreFamilyKey | null; suggestion: GenreSuggestion; openList: boolean } = {
  value: null,
  suggestion: { key: "techno", source: "tags" },
  openList: false,
};

export const G2_FIELD: { value: GenreFamilyKey | null; suggestion: GenreSuggestion; openList: boolean } = {
  value: "techno",
  suggestion: { key: "techno", source: "tags" },
  openList: true,
};

export const G3_LINES = [
  { finding: "Name the act first and give the date in the body.", source: genreFallbackLine("Puzzle", 9, "house_tech", 3) },
  { finding: `Plan · ${genrePlanLine(6, "melodic_prog", 2)}`, source: null },
];

export const G4_LINES = genreStatusLines({
  job: "copy_features",
  families: [{ family: "house_tech", shows: 9, clients: 3 }],
  beats: 0.63,
  on: [],
});
