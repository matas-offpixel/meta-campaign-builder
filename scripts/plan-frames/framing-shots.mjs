/**
 * AF shots: the Lab's artist framing (docs/design-record/2026-11-17-overlay-templates-17.html).
 * Each frame at its format's own width, 1080 (4:5 1080 × 1350, 1:1 1080 × 1080,
 * 9:16 1080 × 1920); the shot is the frame element, so its size is the format's.
 * Ids match scripts/plan-frames/framing-ids.ts; the runner opens
 * /frames/lab-framing/{id} (app/(dev)/frames/lab-framing/[id]). Registered in
 * run.mjs's FRAME_SHOTS. No baselines are committed until design passes.
 */

export const FRAMING_FRAME_IDS = ["AF-A-before", "AF-A-after", "AF-B-before", "AF-B-after", "AF-C-before", "AF-C-after"];

export const FRAMING_SHOTS = FRAMING_FRAME_IDS.map((frame) => ({
  id: `${frame}-1080`,
  frame: `lab-framing/${frame}`,
  width: 1080,
  lab: false,
  before: null,
}));
