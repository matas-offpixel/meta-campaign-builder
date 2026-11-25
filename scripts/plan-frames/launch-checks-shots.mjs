/**
 * Launch checks shots (docs/design-record/2026-11-24-campaign-creator-replicate.html,
 * RC3): RC-C (the composite), RC-C-clean, RC-C2 (page_other_client), RC-C-venue (ops' rulings 3 and 4), and #1362's RC-H, RC-I and RC-I-kept (the live ads' page), at 1280 and 393. The runner
 * opens /frames/launch-checks/{id}. Listed through event-config-shots.mjs
 * while run.mjs sits in open PRs. Baselines come from a frames:update run once the record has passed.
 */

export const LAUNCH_CHECKS_SHOTS = ["RC-C", "RC-C-clean", "RC-C2", "RC-C-venue", "RC-H", "RC-I", "RC-I-kept"].flatMap((frame) =>
  [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `launch-checks/${frame}`, width, lab: false, before: null })),
);
