import type { CampaignDraft } from "../types.ts";
import { patchBudgetSchedule } from "./budget-schedule-update.ts";

/**
 * End date derived from the attached event. The stored value stays the
 * datetime-local string the Schedule input already uses.
 */

export type EndDateSource = "event" | "operator";

export const NO_EVENT_END_NOTE = "No event attached — set one on the Campaign step";

export function derivedEventEnd(eventDate: string | null | undefined): string | null {
  const day = (eventDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `${day}T23:59`;
}

/**
 * Empty, or still the previous event's derived end → take the new event.
 * An operator-typed value is left alone. Source `"event"` follows the event.
 */
export function applyEventEndDate(input: {
  endDate: string;
  endDateSource?: EndDateSource;
  previousEventDate: string | null;
  nextEventDate: string | null;
}): { endDate: string; endDateSource?: EndDateSource } {
  const endDate = input.endDate ?? "";
  const source = input.endDateSource;
  const nextEnd = derivedEventEnd(input.nextEventDate);
  const prevEnd = derivedEventEnd(input.previousEventDate);

  if (!endDate.trim()) {
    if (source === "operator") return { endDate, endDateSource: "operator" };
    if (nextEnd) return { endDate: nextEnd, endDateSource: "event" };
    return { endDate, endDateSource: source };
  }
  if (source === "operator") {
    return { endDate, endDateSource: "operator" };
  }
  if (source === "event" && nextEnd && endDate !== nextEnd) {
    return { endDate: nextEnd, endDateSource: "event" };
  }
  if (source !== "event" && prevEnd && endDate === prevEnd && nextEnd && endDate !== nextEnd) {
    return { endDate: nextEnd, endDateSource: "event" };
  }
  if (!source && endDate && nextEnd && endDate === nextEnd) {
    return { endDate, endDateSource: "event" };
  }
  if (!source && endDate) {
    return { endDate, endDateSource: "operator" };
  }
  return { endDate, endDateSource: source };
}

/**
 * Write the event end onto the draft that is current at flush time.
 * Other schedule fields, including location groups, stay as they are.
 */
export function applyEventEndToDraft(
  draft: CampaignDraft,
  input: { previousEventDate: string | null; nextEventDate: string | null },
): CampaignDraft {
  const again = applyEventEndDate({
    endDate: draft.budgetSchedule.endDate ?? "",
    endDateSource: draft.budgetSchedule.endDateSource,
    previousEventDate: input.previousEventDate,
    nextEventDate: input.nextEventDate,
  });
  if (
    again.endDate === (draft.budgetSchedule.endDate ?? "") &&
    again.endDateSource === draft.budgetSchedule.endDateSource
  ) {
    return draft;
  }
  return {
    ...draft,
    budgetSchedule: patchBudgetSchedule(draft.budgetSchedule, {
      endDate: again.endDate,
      ...(again.endDateSource ? { endDateSource: again.endDateSource } : {}),
    }),
  };
}

/** Existing non-empty dates are operator-typed, unless they are the event end. */
export function migrateEndDateSource(
  endDate: string,
  eventDate: string | null | undefined,
): EndDateSource | undefined {
  if (!endDate.trim()) return undefined;
  const derived = derivedEventEnd(eventDate);
  if (derived && endDate === derived) return "event";
  return "operator";
}

/** What the End Date input shows on first render. */
export function scheduleEndInputValue(
  endDate: string,
  endDateSource: EndDateSource | undefined,
  eventDate: string | null | undefined,
): string {
  if (endDate.trim()) return endDate;
  if (endDateSource === "operator") return "";
  return derivedEventEnd(eventDate) ?? "";
}

export function scheduleEndNote(eventId: string | null | undefined): string | null {
  return eventId?.trim() ? null : NO_EVENT_END_NOTE;
}
