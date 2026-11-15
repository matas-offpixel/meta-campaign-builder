/**
 * HE5 creative frames at /frames/creative/{id}, from the IRW0001 fixture
 * (lib/dashboard/creative-section-fixture.ts). CR1 internal, CR1S share.
 * Widths live in creative-section-shots.mjs.
 */
export const CREATIVE_FRAME_IDS = ["CR1", "CR1S"] as const;

export type CreativeFrameId = (typeof CREATIVE_FRAME_IDS)[number];

export const CREATIVE_FRAMES: Record<CreativeFrameId, { surface: "internal" | "share" }> = {
  CR1: { surface: "internal" },
  CR1S: { surface: "share" },
};
