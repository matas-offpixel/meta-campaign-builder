import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { migrateDraft } from "../../autosave.ts";
import { createDefaultDraft } from "../../campaign-defaults.ts";
import {
  applyEventEndDate,
  scheduleEndInputValue,
  scheduleEndNote,
} from "../event-end-date.ts";

describe("event end date", () => {
  it("Attach event → endDate derived, endDateSource event; typing a date → operator; changing event → derived date updates only when source is event", () => {
    const attached = applyEventEndDate({
      endDate: "",
      previousEventDate: null,
      nextEventDate: "2026-10-24",
    });
    assert.equal(attached.endDate, "2026-10-24T23:59");
    assert.equal(attached.endDateSource, "event");

    const typed = { endDate: "2026-11-01T18:00", endDateSource: "operator" as const };
    const kept = applyEventEndDate({
      ...typed,
      previousEventDate: "2026-10-24",
      nextEventDate: "2026-11-28",
    });
    assert.deepEqual(kept, typed);

    const moved = applyEventEndDate({
      endDate: "2026-10-24T23:59",
      endDateSource: "event",
      previousEventDate: "2026-10-24",
      nextEventDate: "2026-11-28",
    });
    assert.equal(moved.endDate, "2026-11-28T23:59");
    assert.equal(moved.endDateSource, "event");
  });

  it("migrateDraft: existing date not equal to event end → operator; equal → event", () => {
    const typed = createDefaultDraft();
    typed.budgetSchedule.endDate = "2026-11-01T18:00";
    const operator = migrateDraft(
      JSON.parse(JSON.stringify(typed)) as Record<string, unknown>,
      "2026-10-24",
    );
    assert.equal(operator.budgetSchedule.endDate, "2026-11-01T18:00");
    assert.equal(operator.budgetSchedule.endDateSource, "operator");

    const derived = createDefaultDraft();
    derived.budgetSchedule.endDate = "2026-10-24T23:59";
    const event = migrateDraft(
      JSON.parse(JSON.stringify(derived)) as Record<string, unknown>,
      "2026-10-24",
    );
    assert.equal(event.budgetSchedule.endDate, "2026-10-24T23:59");
    assert.equal(event.budgetSchedule.endDateSource, "event");
  });

  it("Schedule card with eventId null shows the no-event note; with an event, End Date is pre-filled on first render", () => {
    assert.equal(scheduleEndNote(null), "No event attached — set one on the Campaign step");
    assert.equal(scheduleEndNote(""), "No event attached — set one on the Campaign step");
    assert.equal(scheduleEndNote("evt-1"), null);
    assert.equal(scheduleEndInputValue("", undefined, "2026-10-24"), "2026-10-24T23:59");
    const card = readFileSync(
      new URL("../../../components/steps/budget-schedule.tsx", import.meta.url),
      "utf8",
    );
    assert.match(card, /scheduleEndNote\(eventId\)/);
    assert.match(card, /scheduleEndInputValue/);
    assert.match(card, /selectedEvent/);
  });
});
