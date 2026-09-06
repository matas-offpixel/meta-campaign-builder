/**
 * Canon §3 frames plus J0 (the #906 pre-load skeleton).
 * L3 and J2 also render at 768.
 */

export const CANON_FRAME_IDS = [
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
  "L6",
  "A1",
  "A2",
  "A4",
  "A6",
  "A8",
  "A9",
  "A10",
  "A11",
  "A13",
  "A14",
  "A15",
  "J1",
  "J2",
  "J3",
  "J5",
  "J7",
  "J8",
  "J9",
  "J12",
  "J14",
  "J18",
  "J19",
  "J22",
  "E1",
  "E2",
  "E3",
  "E6",
] as const;

export const EXTRA_FRAME_IDS = ["J0"] as const;

export const FRAME_IDS = [...CANON_FRAME_IDS, ...EXTRA_FRAME_IDS] as const;

export const NARROW_FRAME_IDS = ["L3", "J2"] as const;

export type CanonFrameId = (typeof CANON_FRAME_IDS)[number];
export type ExtraFrameId = (typeof EXTRA_FRAME_IDS)[number];
export type FrameId = (typeof FRAME_IDS)[number];
export type NarrowFrameId = (typeof NARROW_FRAME_IDS)[number];

export const FRAME_SHOTS: readonly { id: string; width: 1176 | 768 }[] = [
  ...FRAME_IDS.map((id) => ({ id, width: 1176 as const })),
  ...NARROW_FRAME_IDS.map((id) => ({ id: `${id}-768`, width: 768 as const })),
];
