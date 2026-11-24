/**
 * Campaign creator, part 4 shots (docs/design-record/2026-11-24-campaign-creator-replicate.html):
 * RC-A, RC-B, RC-B-notset, RC-F and RC-F-sheet at 1280 and 393. The runner
 * opens /frames/campaign-tree/{id}. Listed through event-config-shots.mjs
 * while run.mjs sits in open PRs.
 */

export const CAMPAIGN_TREE_SHOTS = ["RC-A", "RC-B", "RC-B-notset", "RC-F", "RC-F-sheet"].flatMap((frame) =>
  [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `campaign-tree/${frame}`, width, lab: false, before: null })),
);
