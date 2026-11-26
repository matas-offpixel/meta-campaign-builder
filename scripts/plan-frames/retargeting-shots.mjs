/**
 * The Retargeting shots at 1280 and 393: RD (docs/design-record/2026-11-17-retargeting-campaign.html,
 * the not-proposed states, which stand), TW-A to TW-D
 * (docs/design-record/2026-11-26-retargeting-two-campaigns.html), and the
 * funnel's RF-B and RF-C (docs/design-record/2026-11-26-retargeting-funnel.html,
 * RF5 and RF6 stand). RF-D is the campaign creator's. The runner opens
 * /frames/retargeting/{id}. Listed through event-config-shots.mjs while
 * run.mjs sits in open PRs.
 */

export const RETARGETING_SHOTS = ["RD", "TW-A", "TW-B", "TW-C", "TW-D", "RF-B", "RF-C"].flatMap((frame) => [1280, 393].map((width) => ({ id: `${frame}-${width}`, frame: `retargeting/${frame}`, width, lab: false, before: null })));
