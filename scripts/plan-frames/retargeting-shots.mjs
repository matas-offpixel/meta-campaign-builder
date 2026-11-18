/**
 * The Retargeting campaign shots (docs/design-record/2026-11-17-retargeting-campaign.html),
 * RA, RB and RD at 1280 and 393 (each PR judged on its own lines). RC comes later. The
 * runner opens /frames/retargeting/{id}. Listed through
 * event-config-shots.mjs while run.mjs sits in open PRs.
 */

export const RETARGETING_SHOTS = ["RA", "RB", "RD", "RE", "RG"].flatMap((frame) => [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `retargeting/${frame}`, width, lab: false, before: null })));
