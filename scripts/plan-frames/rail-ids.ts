/**
 * Insights rail frames (IR series), docs/design-record/2026-11-07-insights-rail.html.
 * IR0 is a DOM check, not a shot: the rail never mounts on a client
 * surface. scripts/plan-frames/rail-shots.mjs holds the shot list; a unit
 * test keeps the two in step.
 */

export const RAIL_FRAME_IDS = ["IR1", "IR2", "IR3", "IR4", "IR6", "IR7"] as const;

export type RailFrameId = (typeof RAIL_FRAME_IDS)[number];

/** The widths the record sets per frame. */
export const RAIL_FRAME_WIDTHS: Record<RailFrameId, readonly (1280 | 393)[]> = {
  IR1: [1280],
  IR2: [1280, 393],
  IR3: [1280],
  IR4: [1280, 393],
  IR6: [1280],
  IR7: [393],
};

/** Client surfaces the rail must never reach (R3, IR0). */
export const RAIL_GUARD_PATHS = ["/admin/fixture-client", "/share/report/fixture-token", "/l/fixture-client/fixture-event"] as const;
