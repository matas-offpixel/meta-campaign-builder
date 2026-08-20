import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";

export const TIKTOK_TEXT_SAVE_DEBOUNCE_MS = 500;

/** Text fields must never disable themselves mid-word while a PATCH is in flight. */
export function tikTokTextFieldDisabledWhileSaving(saving: boolean): false {
  void saving;
  return false;
}

export function applyTikTokCampaignSetupPatch(
  latest: TikTokCampaignDraft,
  patch: Partial<TikTokCampaignDraft["campaignSetup"]>,
): TikTokCampaignDraft {
  return {
    ...latest,
    campaignSetup: {
      ...latest.campaignSetup,
      ...patch,
    },
  };
}

export function createDebouncedCallback(
  run: () => void,
  delayMs = TIKTOK_TEXT_SAVE_DEBOUNCE_MS,
): {
  schedule: () => void;
  flush: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      run();
    },
    cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
