/**
 * EC shots: the event page's Dashboard panel (D9, HD2), at 1280 and 393.
 * Ids match scripts/plan-frames/event-config-fixtures.ts. The runner opens
 * /frames/{frame}, so the frame is "event-config/EC1": the nested route
 * app/(dev)/frames/event-config/[id], because app/(dev)/frames/[id]/page.tsx
 * sits in an open Cursor PR.
 * Registered in run.mjs's FRAME_SHOTS. No baselines are committed until
 * design passes.
 */

export const EVENT_CONFIG_FRAME_IDS = ["EC1", "EC2", "EC3", "EC4", "EC5", "EC6", "EC7"];
export const EVENT_CONFIG_WIDTHS = [1280, 393];

export const EVENT_CONFIG_SHOTS = EVENT_CONFIG_FRAME_IDS.flatMap((frame) =>
  EVENT_CONFIG_WIDTHS.map((width) => ({
    id: `${frame}-${width}`,
    frame: `event-config/${frame}`,
    width,
    lab: false,
    before: null,
  })),
);
