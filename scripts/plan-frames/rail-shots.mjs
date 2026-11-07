/**
 * The IR shots the runner takes, at the widths the record sets. The ids
 * and widths match scripts/plan-frames/rail-ids.ts; a unit test keeps
 * them equal. IR0 is the DOM guard the runner runs after the shots.
 */

export const RAIL_FRAME_WIDTHS = {
  IR1: [1280],
  IR2: [1280, 393],
  IR3: [1280],
  IR4: [1280, 393],
  IR5: [1280, 393],
  IR6: [1280],
  IR7: [393],
  IR8: [1280, 393],
};

export const RAIL_GUARD_PATHS = ["/admin/fixture-client", "/share/report/fixture-token", "/l/fixture-client/fixture-event"];

export const RAIL_SHOTS = Object.entries(RAIL_FRAME_WIDTHS).flatMap(([frame, widths]) =>
  widths.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: true, before: null })),
);
