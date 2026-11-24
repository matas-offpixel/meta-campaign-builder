/**
 * Launch checks shots (docs/design-record/2026-11-24-campaign-creator-replicate.html,
 * RC3): RC-C (the composite) and RC-C-clean, at 1280 and 393. The runner
 * opens /frames/launch-checks/{id}. Listed through event-config-shots.mjs
 * while run.mjs sits in open PRs. No baselines until design passes.
 */

export const LAUNCH_CHECKS_SHOTS = ["RC-C", "RC-C-clean"].flatMap((frame) =>
  [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `launch-checks/${frame}`, width, lab: false, before: null })),
);
