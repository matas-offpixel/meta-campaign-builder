/** Client-safe copy for the live ad-set targeting control. No server imports. */

export const ADSET_TARGETING_WRITES_DISABLED_MESSAGE =
  "Ad set targeting writes are disabled (OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED is not true).";

export const LEARNING_PHASE_WARNING =
  "Changing targeting on a delivering ad set resets its learning phase.";

export type AudienceListDirection = "include" | "exclude";
export type AudienceListAction = "add" | "remove";
