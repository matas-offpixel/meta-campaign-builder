/** AB shots. Ids match scripts/plan-frames/bank-ids.ts. */

export const BANK_FRAME_IDS = ["AB1", "AB1b", "AB2", "AB3", "AB4", "AB5", "AB6"];
export const BANK_WIDTHS = [1280, 393];

export const BANK_SHOTS = BANK_FRAME_IDS.flatMap((frame) =>
  BANK_WIDTHS.map((width) => ({ id: `${frame}-${width}`, frame, width, lab: false, before: null })),
);
