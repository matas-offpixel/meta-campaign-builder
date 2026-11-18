/** Lab framing frames (overlay-templates issue 17): AF-A 4:5, AF-B 1:1, AF-C 9:16 clip, each before and after. */
export const FRAMING_FRAME_IDS = ["AF-A-before", "AF-A-after", "AF-B-before", "AF-B-after", "AF-C-before", "AF-C-after"] as const;
export type FramingFrameId = (typeof FRAMING_FRAME_IDS)[number];
