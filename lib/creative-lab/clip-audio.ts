const listeners = new Set<(id: string) => void>();

/** Tell every other player on the page that this one is the audible one. */
export function notifyAudible(id: string) {
  for (const hear of listeners) hear(id);
}

export function subscribeAudible(hear: (id: string) => void): () => void {
  listeners.add(hear);
  return () => {
    listeners.delete(hear);
  };
}

/**
 * Hide the control only when the clip row already records that the file has
 * no audio. A missing flag is not a probe, and it is not a reason to hide.
 */
export function showSoundToggle(hasAudio: boolean | null | undefined): boolean {
  return hasAudio !== false;
}

/** The label is the action. Muted offers Unmute. */
export function soundAction(audible: boolean): "Mute" | "Unmute" {
  return audible ? "Mute" : "Unmute";
}
