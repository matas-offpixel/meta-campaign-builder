/**
 * datetime-local fires `change` per segment (day, month, year, hour,
 * minute). Persist on blur only — the keystroke-PATCH freeze from
 * task #139. Local state holds the typed value so the input is never
 * driven from the draft mid-edit. A write in flight does not disable
 * the field.
 */

export function reviewScheduleFieldDisabled(input: {
  alreadyLaunched: boolean;
  smartPlus: boolean;
}): boolean {
  return input.alreadyLaunched || input.smartPlus;
}

export function shouldPersistReviewSchedule(
  eventType: "change" | "blur",
): boolean {
  return eventType === "blur";
}

export function applyReviewScheduleChange(
  writes: { persist: (value: string) => void },
  eventType: "change" | "blur",
  value: string,
): void {
  if (!shouldPersistReviewSchedule(eventType)) return;
  writes.persist(value);
}
