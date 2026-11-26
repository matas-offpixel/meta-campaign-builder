/**
 * The Retargeting shots at 1280 and 393: RD (docs/design-record/2026-11-17-retargeting-campaign.html,
 * the not-proposed states, which stand) and the funnel's RF-A, RF-B, RF-C and
 * RF-E (docs/design-record/2026-11-26-retargeting-funnel.html), which re-rule
 * RA, RB, RE and RG. RF-D is the campaign creator's. The runner opens
 * /frames/retargeting/{id}. Listed through event-config-shots.mjs while
 * run.mjs sits in open PRs.
 */

export const RETARGETING_SHOTS = ["RD", "RF-A", "RF-B", "RF-C", "RF-E"].flatMap((frame) => [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `retargeting/${frame}`, width, lab: false, before: null })));
