/** Asset bank frames (AB series), shot at 1280 and 393. */

export const BANK_FRAME_IDS = ["AB1", "AB2", "AB3", "AB4", "AB5"] as const;

export type BankFrameId = (typeof BANK_FRAME_IDS)[number];

export const BANK_FRAME_WIDTHS = [1280, 393] as const;
