/**
 * The Retargeting campaign shots (docs/design-record/2026-11-17-retargeting-campaign.html),
 * RA (PR B), RB and RD (PR A) at 1280 and 393. RC comes with PR C. The
 * runner opens /frames/retargeting/{id}. Listed through
 * event-config-shots.mjs while run.mjs sits in open PRs.
 */

export const RETARGETING_SHOTS = ["RA", "RB", "RD"].flatMap((frame) => [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `retargeting/${frame}`, width, lab: false, before: null })));
