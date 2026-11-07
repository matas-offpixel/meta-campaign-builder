/**
 * Creative Lab card frames (CL series), shot at 1280 and 393.
 * scripts/plan-frames/lab-shots.mjs holds the same ids for the runner;
 * lib/plan/__tests__/lab-frames.test.ts keeps the two lists equal.
 */

export const LAB_FRAME_IDS = ["CL1", "CL2", "CL3", "CL4", "CL5", "CL6", "CL7", "CL8", "CL9", "CL10"] as const;

export type LabFrameId = (typeof LAB_FRAME_IDS)[number];

export const LAB_FRAME_WIDTHS = [1280, 393] as const;
