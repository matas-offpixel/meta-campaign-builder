import type { CampaignDraft } from "../types.ts";
import { patchBudgetSchedule } from "./budget-schedule-update.ts";

/**
 * Schedule dates derived from the attached event. Stored values stay the
 * datetime-local strings the Schedule inputs already use.
 */

export type EndDateSource = "event" | "operator";
export type StartDateSource = "event" | "operator";
export type EndDatePhase = "presale" | "general_sale" | "event";

export interface EventPhaseFields {
  eventDate: string | null;
  presaleAt?: string | null;
  generalSaleAt?: string | null;
}

export const NO_EVENT_END_NOTE = "No event attached — set one on the Campaign step";
export const EVENT_DATE_PASSED_NOTE = "Event date has passed — set an end date";
export const DEFAULT_SCHEDULE_TIMEZONE = "Europe/London";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function derivedEventEnd(eventDate: string | null | undefined): string | null {
  const day = (eventDate ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `${day}T23:59`;
}

function zoneParts(instant: Date, timezone: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    hour: parts.hour === "24" ? "00" : (parts.hour ?? "00"),
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

function formatInZone(instant: Date, timezone: string): string {
  const parts = zoneParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Local datetime-local string → the UTC instant that clock shows in `timezone`. */
function zonedLocalToUtc(local: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const want = Date.UTC(year, month - 1, day, hour, minute);
  let utc = want;
  for (let pass = 0; pass < 2; pass++) {
    const seen = zoneParts(new Date(utc), timezone);
    const seenUtc = Date.UTC(
      Number(seen.year),
      Number(seen.month) - 1,
      Number(seen.day),
      Number(seen.hour),
      Number(seen.minute),
    );
    const delta = want - seenUtc;
    if (delta === 0) return new Date(utc);
    utc += delta;
  }
  return new Date(utc);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Now in the draft timezone, rounded up to the next quarter hour.
 * An exact quarter (seconds and milliseconds both 0) stays put.
 */
export function derivedStart(now: Date, timezone = DEFAULT_SCHEDULE_TIMEZONE): string {
  const parts = zoneParts(now, timezone);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  let total = hour * 60 + minute;
  const exactQuarter = minute % 15 === 0 && second === 0 && now.getMilliseconds() === 0;
  if (!exactQuarter) total = Math.floor(total / 15) * 15 + 15;
  const extraDays = Math.floor(total / (24 * 60));
  const minutes = total % (24 * 60);
  const nextHour = Math.floor(minutes / 60);
  const nextMinute = minutes % 60;
  const date = extraDays === 0
    ? { year, month, day }
    : (() => {
        const shifted = new Date(Date.UTC(year, month - 1, day + extraDays));
        return {
          year: shifted.getUTCFullYear(),
          month: shifted.getUTCMonth() + 1,
          day: shifted.getUTCDate(),
        };
      })();
  return `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(nextHour)}:${pad(nextMinute)}`;
}

function instantOf(iso: string | null | undefined): Date | null {
  if (!iso?.trim()) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** The phase clock as a datetime-local string, including a phase that is already past. */
export function phaseLocal(
  event: EventPhaseFields,
  phase: EndDatePhase,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): string | null {
  if (phase === "event") return derivedEventEnd(event.eventDate);
  const instant = instantOf(phase === "presale" ? event.presaleAt : event.generalSaleAt);
  return instant ? formatInZone(instant, timezone) : null;
}

/**
 * The next key phase strictly after `now`: presale, then general sale,
 * then the event date at end of day. All past → empty end and a null phase.
 */
export function nextCampaignPhaseEnd(
  event: EventPhaseFields,
  now: Date,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): { endDate: string; phase: EndDatePhase | null } {
  const presale = instantOf(event.presaleAt);
  if (presale && presale.getTime() > now.getTime()) {
    return { endDate: formatInZone(presale, timezone), phase: "presale" };
  }
  const general = instantOf(event.generalSaleAt);
  if (general && general.getTime() > now.getTime()) {
    return { endDate: formatInZone(general, timezone), phase: "general_sale" };
  }
  const eventLocal = derivedEventEnd(event.eventDate);
  if (eventLocal) {
    const instant = zonedLocalToUtc(eventLocal, timezone);
    if (instant && instant.getTime() > now.getTime()) {
      return { endDate: eventLocal, phase: "event" };
    }
  }
  return { endDate: "", phase: null };
}

function eventFields(input: {
  nextEventDate: string | null;
  nextPresaleAt?: string | null;
  nextGeneralSaleAt?: string | null;
}): EventPhaseFields {
  return {
    eventDate: input.nextEventDate,
    presaleAt: input.nextPresaleAt,
    generalSaleAt: input.nextGeneralSaleAt,
  };
}

function hasScheduleEvent(event: EventPhaseFields): boolean {
  return Boolean(derivedEventEnd(event.eventDate) || event.presaleAt?.trim() || event.generalSaleAt?.trim());
}

function resolveEnd(input: {
  endDateSource?: EndDateSource;
  endDatePhase?: EndDatePhase | null;
  nextEventDate: string | null;
  nextPresaleAt?: string | null;
  nextGeneralSaleAt?: string | null;
  now?: Date;
  timezone?: string;
}): { endDate: string; phase: EndDatePhase | null } {
  const event = eventFields(input);
  const timezone = input.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const now = input.now ?? new Date();
  if (input.endDateSource === "event" && input.endDatePhase) {
    const pinned = phaseLocal(event, input.endDatePhase, timezone);
    if (pinned) return { endDate: pinned, phase: input.endDatePhase };
  }
  return nextCampaignPhaseEnd(event, now, timezone);
}

/**
 * Empty, or still the previous event's derived end → take the new event.
 * An operator-typed value is left alone. Source `"event"` follows the event.
 * `endDatePhase: null` means the event's phases are all in the past.
 */
export function applyEventEndDate(input: {
  endDate: string;
  endDateSource?: EndDateSource;
  endDatePhase?: EndDatePhase | null;
  previousEventDate: string | null;
  nextEventDate: string | null;
  nextPresaleAt?: string | null;
  nextGeneralSaleAt?: string | null;
  now?: Date;
  timezone?: string;
}): { endDate: string; endDateSource?: EndDateSource; endDatePhase?: EndDatePhase | null } {
  const endDate = input.endDate ?? "";
  const source = input.endDateSource;
  if (source === "operator") return { endDate, endDateSource: "operator" };

  const event = eventFields(input);
  const hasEvent = hasScheduleEvent(event);
  const next = hasEvent ? resolveEnd(input) : { endDate: "", phase: null as EndDatePhase | null };
  const nextEnd = next.endDate || null;
  const prevEnd = derivedEventEnd(input.previousEventDate);

  if (!hasEvent) {
    if (!endDate.trim()) return { endDate, endDateSource: source };
    if (!source && endDate) return { endDate, endDateSource: "operator" };
    return { endDate, endDateSource: source };
  }

  if (!endDate.trim()) {
    if (nextEnd) return { endDate: nextEnd, endDateSource: "event", endDatePhase: next.phase };
    return { endDate: "", endDateSource: "event", endDatePhase: null };
  }
  if (source === "event") {
    return { endDate: nextEnd ?? "", endDateSource: "event", endDatePhase: next.phase };
  }
  if (prevEnd && endDate === prevEnd && nextEnd && endDate !== nextEnd) {
    return { endDate: nextEnd, endDateSource: "event", endDatePhase: next.phase };
  }
  if (nextEnd && endDate === nextEnd) {
    return { endDate, endDateSource: "event", endDatePhase: next.phase };
  }
  if (endDate) return { endDate, endDateSource: "operator" };
  return { endDate, endDateSource: source };
}

/**
 * Write the event schedule onto the draft that is current at flush time.
 * Other schedule fields, including location groups, stay as they are.
 * `refreshStart` moves a non-operator start to the quarter-hour clock.
 */
export function applyEventEndToDraft(
  draft: CampaignDraft,
  input: {
    previousEventDate: string | null;
    nextEventDate: string | null;
    nextPresaleAt?: string | null;
    nextGeneralSaleAt?: string | null;
    now?: Date;
    refreshStart?: boolean;
  },
): CampaignDraft {
  const timezone = draft.budgetSchedule.timezone || DEFAULT_SCHEDULE_TIMEZONE;
  const again = applyEventEndDate({
    endDate: draft.budgetSchedule.endDate ?? "",
    endDateSource: draft.budgetSchedule.endDateSource,
    endDatePhase: draft.budgetSchedule.endDatePhase,
    previousEventDate: input.previousEventDate,
    nextEventDate: input.nextEventDate,
    nextPresaleAt: input.nextPresaleAt,
    nextGeneralSaleAt: input.nextGeneralSaleAt,
    now: input.now,
    timezone,
  });

  let startDate = draft.budgetSchedule.startDate ?? "";
  let startDateSource = draft.budgetSchedule.startDateSource;
  const hasEvent = hasScheduleEvent(eventFields(input));
  if (input.refreshStart && startDateSource !== "operator" && hasEvent) {
    startDate = derivedStart(input.now ?? new Date(), timezone);
    startDateSource = "event";
  }

  const nextPhase = again.endDatePhase === null ? undefined : again.endDatePhase;
  const phaseChanges = again.endDatePhase !== undefined && nextPhase !== draft.budgetSchedule.endDatePhase;
  const endChanges = again.endDate !== (draft.budgetSchedule.endDate ?? "");
  const sourceChanges = Boolean(again.endDateSource) && again.endDateSource !== draft.budgetSchedule.endDateSource;
  const startValueChanges = startDate !== (draft.budgetSchedule.startDate ?? "");
  const startSourceChanges = startDateSource !== draft.budgetSchedule.startDateSource;
  if (!phaseChanges && !endChanges && !sourceChanges && !startValueChanges && !startSourceChanges) {
    return draft;
  }
  return {
    ...draft,
    budgetSchedule: patchBudgetSchedule(draft.budgetSchedule, {
      ...(endChanges ? { endDate: again.endDate } : {}),
      ...(sourceChanges && again.endDateSource ? { endDateSource: again.endDateSource } : {}),
      ...(phaseChanges ? { endDatePhase: nextPhase } : {}),
      ...(startValueChanges ? { startDate } : {}),
      ...(startSourceChanges && startDateSource ? { startDateSource } : {}),
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

/** Midnight on the draft's created day, in the draft timezone. */
export function createdDayMidnight(
  createdAt: string | null | undefined,
  timezone = DEFAULT_SCHEDULE_TIMEZONE,
): string | null {
  if (!createdAt?.trim()) return null;
  const instant = new Date(createdAt);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = zoneParts(instant, timezone);
  return `${parts.year}-${parts.month}-${parts.day}T00:00`;
}

/**
 * The old EventDefaultsApplier wrote the created day's local midnight
 * when start was empty. That start follows the event. Any other
 * non-empty start was typed.
 */
export function migrateStartDateSource(
  startDate: string,
  createdAt: string | null | undefined,
  timezone?: string,
): StartDateSource | undefined {
  if (!startDate.trim()) return undefined;
  const midnight = createdDayMidnight(createdAt, timezone || DEFAULT_SCHEDULE_TIMEZONE);
  if (midnight && startDate === midnight) return "event";
  return "operator";
}

/** What the End Date input shows on first render. */
export function scheduleEndInputValue(
  endDate: string,
  endDateSource: EndDateSource | undefined,
  eventDate: string | null | undefined,
): string {
  if (endDate.trim()) return endDate;
  if (endDateSource === "operator" || endDateSource === "event") return "";
  return derivedEventEnd(eventDate) ?? "";
}

export function scheduleEndNote(eventId: string | null | undefined): string | null {
  return eventId?.trim() ? null : NO_EVENT_END_NOTE;
}

function dayMonth(endDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(endDate)) return null;
  const parsed = new Date(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCDate()} ${MONTHS[parsed.getUTCMonth()]}`;
}

export function phaseScheduleNote(phase: EndDatePhase, endDate: string): string | null {
  const day = dayMonth(endDate);
  if (!day) return null;
  if (phase === "presale") return `Ends at presale (${day})`;
  if (phase === "general_sale") return `Ends at general sale (${day})`;
  return `Ends on event day (${day})`;
}

export function reviewPhaseClause(phase: EndDatePhase, endDate: string | undefined): string | null {
  const day = dayMonth(endDate ?? "");
  if (!day) return null;
  if (phase === "presale") return `ends at presale ${day}`;
  if (phase === "general_sale") return `ends at general sale ${day}`;
  return `ends on event day ${day}`;
}

export function schedulePhaseNote(input: {
  eventId: string | null | undefined;
  endDate: string;
  endDateSource?: EndDateSource;
  endDatePhase?: EndDatePhase | null;
}): string | null {
  if (!input.eventId?.trim()) return null;
  if (input.endDateSource !== "event") return null;
  if (!input.endDate.trim()) return EVENT_DATE_PASSED_NOTE;
  if (!input.endDatePhase) return null;
  return phaseScheduleNote(input.endDatePhase, input.endDate);
}
