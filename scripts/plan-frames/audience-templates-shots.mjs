/**
 * RC-E shots: the Audience templates tab (docs/design-record/
 * 2026-11-24-campaign-creator-replicate.html, RC5), at 1280 and 393 as the
 * record draws it. Ids match scripts/plan-frames/audience-templates-fixtures.ts.
 * The runner opens /frames/{frame}: the nested route
 * app/(dev)/frames/audience-templates/[id]. Registered in run.mjs's FRAME_SHOTS.
 */

export const AUDIENCE_TEMPLATE_SHOT_WIDTHS = { "RC-E": [1280, 393] };

export const AUDIENCE_TEMPLATE_SHOTS = Object.entries(AUDIENCE_TEMPLATE_SHOT_WIDTHS).flatMap(([frame, widths]) =>
  widths.map((width) => ({
    id: `${frame}-${width}`,
    frame: `audience-templates/${frame}`,
    width,
    lab: false,
    before: null,
  })),
);

/** The overflow guard opens these at 320–430 px. */
export const AUDIENCE_TEMPLATE_OVERFLOW_FRAMES = Object.keys(AUDIENCE_TEMPLATE_SHOT_WIDTHS).map((frame) => `audience-templates/${frame}`);
