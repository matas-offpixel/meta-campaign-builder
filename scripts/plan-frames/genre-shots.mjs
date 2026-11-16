/**
 * G shots: the genre key (docs/design-record/2026-11-16-genre-key.html).
 * Widths as the record draws them: G1 at 1280 and, per its acceptance, 393;
 * G2 at 393; G3 at 1280; G4 at 393. Ids match
 * scripts/plan-frames/genre-fixtures.ts. The runner opens /frames/{frame},
 * so the frame is "genre/G1": the nested route app/(dev)/frames/genre/[id].
 * Registered in run.mjs's FRAME_SHOTS. No baselines are committed until
 * design passes.
 */

export const GENRE_SHOT_WIDTHS = { G1: [1280, 393], G2: [393], G3: [1280], G4: [393] };

export const GENRE_SHOTS = Object.entries(GENRE_SHOT_WIDTHS).flatMap(([frame, widths]) =>
  widths.map((width) => ({
    id: `${frame}-${width}`,
    frame: `genre/${frame}`,
    width,
    lab: false,
    before: null,
  })),
);
