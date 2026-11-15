/** Client-safe copy for the live ad-set destination control. No server imports. */

export const ADSET_DESTINATION_WRITES_DISABLED_MESSAGE =
  "Setting a website destination on a live ad set is disabled " +
  "(OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED is not true).";

/**
 * Deliberately no learning-phase warning here, unlike the targeting control.
 * Writing `destination_type` on a running ad set left
 * `learning_stage_info.last_sig_edit_ts` unchanged, so Meta did not treat it as
 * a significant edit — verified live 2026-09-30 on ad set 120249993287300453.
 */
