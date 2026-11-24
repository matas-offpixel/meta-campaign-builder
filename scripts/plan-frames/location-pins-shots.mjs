/**
 * Location pin shots (docs/design-record/2026-11-24-campaign-creator-location-pin.html):
 * LP-A (the preset, its pin row, the warning on a search hit), LP-A-hand (a
 * hand-added pin row), LP-B (the form: empty, filled, each error), LP-C (a
 * draft holding Leeds, Kent; after Keep), at 1280 and 393. Ids match
 * scripts/plan-frames/location-pins-fixtures.ts. The runner opens
 * /frames/location-pins/{id}. Listed through event-config-shots.mjs while
 * run.mjs sits in open PRs.
 */

export const LOCATION_PIN_FRAMES = [
  "LP-A",
  "LP-A-hand",
  "LP-B-empty",
  "LP-B",
  "LP-B-name",
  "LP-B-latitude",
  "LP-B-longitude",
  "LP-B-radius",
  "LP-C",
  "LP-C-kept",
];

export const LOCATION_PIN_SHOTS = LOCATION_PIN_FRAMES.flatMap((frame) =>
  [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `location-pins/${frame}`, width, lab: false, before: null })),
);
