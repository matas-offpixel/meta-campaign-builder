/**
 * SNP-A / SNP-B (M3d-b): the Snippet tab's one window on a file with no drop,
 * before (SNPA) and after (SNPB) a press at 30 % of the track, at 1280 and
 * 393. Frames under creative-tests/{id}; listed through event-config-shots.mjs
 * while run.mjs sits in open PRs.
 */

export const SNIPPET_PRESS_SHOTS = ["SNPA", "SNPB"].flatMap((frame) =>
  [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `creative-tests/${frame}`, width, lab: false, before: null })),
);
