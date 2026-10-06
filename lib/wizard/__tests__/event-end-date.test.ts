import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { migrateDraft } from "../../autosave.ts";
import { createDefaultDraft } from "../../campaign-defaults.ts";
import { describeLaunchBudget } from "../../meta/budget-launch.ts";
import {
  EVENT_DATE_PASSED_NOTE,
  PRESALE_TOO_SOON_NOTE,
  applyEventEndDate,
  applyEventEndToDraft,
  applyImportedCampaignSchedule,
  derivedStart,
  presaleTooSoon,
  scheduleEndInputValue,
  scheduleEndNote,
  schedulePhaseNote,
} from "../event-end-date.ts";

describe("event end date", () => {
  it("Attach event → endDate derived, endDateSource event; typing a date → operator; changing event → derived date updates only when source is event", () => {
    const attached = applyEventEndDate({
      endDate: "",
      previousEventDate: null,
      nextEventDate: "2026-10-24",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    assert.equal(attached.endDate, "2026-10-24T23:59");
    assert.equal(attached.endDateSource, "event");

    const typed = { endDate: "2026-11-01T18:00", endDateSource: "operator" as const };
    const kept = applyEventEndDate({
      ...typed,
      previousEventDate: "2026-10-24",
      nextEventDate: "2026-11-28",
      now: new Date("2026-10-06T12:00:00.000Z"),
    });
    assert.deepEqual(kept, typed);

    const moved = applyEventEndDate({
      endDate: "2026-10-24T23:59",
      endDateSource: "event",
      previousEventDate: "2026-10-24",
      nextEventDate: "2026-11-28",
      now: new Date("2026-10-06T12:00:00.000Z"),
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
    assert.match(card, /Use presale/);
    assert.match(card, /Use general sale/);
    assert.match(card, /Use event date/);
    assert.match(card, /showPhaseMenu = Boolean\(event\) && choices\.some\(\(choice\) => choice\.local\)/);
  });
});

const NOW = new Date("2026-10-06T12:00:00.000Z");

describe("schedule from event phases", () => {
  it("presale in 10d / general sale 20d / event 40d → End = presale; presale past → general sale; both past → event day; all past → empty + note", () => {
    const upcoming = applyEventEndDate({
      endDate: "",
      previousEventDate: null,
      nextEventDate: "2026-11-15",
      nextPresaleAt: "2026-10-16T12:00:00.000Z",
      nextGeneralSaleAt: "2026-10-26T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(upcoming.endDate, "2026-10-16T13:00");
    assert.equal(upcoming.endDateSource, "event");
    assert.equal(upcoming.endDatePhase, "presale");
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: upcoming.endDate,
        endDateSource: upcoming.endDateSource,
        endDatePhase: upcoming.endDatePhase,
      }),
      "Ends at presale (16 Oct)",
    );

    const afterPresale = applyEventEndDate({
      endDate: "",
      previousEventDate: null,
      nextEventDate: "2026-11-15",
      nextPresaleAt: "2026-10-01T12:00:00.000Z",
      nextGeneralSaleAt: "2026-10-26T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(afterPresale.endDate, "2026-10-26T12:00");
    assert.equal(afterPresale.endDatePhase, "general_sale");
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: afterPresale.endDate,
        endDateSource: afterPresale.endDateSource,
        endDatePhase: afterPresale.endDatePhase,
      }),
      "Ends at general sale (26 Oct)",
    );

    const eventDay = applyEventEndDate({
      endDate: "",
      previousEventDate: null,
      nextEventDate: "2026-11-15",
      nextPresaleAt: "2026-09-01T12:00:00.000Z",
      nextGeneralSaleAt: "2026-09-15T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(eventDay.endDate, "2026-11-15T23:59");
    assert.equal(eventDay.endDatePhase, "event");
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: eventDay.endDate,
        endDateSource: eventDay.endDateSource,
        endDatePhase: eventDay.endDatePhase,
      }),
      "Ends on event day (15 Nov)",
    );

    const passed = applyEventEndDate({
      endDate: "",
      previousEventDate: null,
      nextEventDate: "2026-09-01",
      nextPresaleAt: "2026-08-01T12:00:00.000Z",
      nextGeneralSaleAt: "2026-08-15T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(passed.endDate, "");
    assert.equal(passed.endDateSource, "event");
    assert.equal(passed.endDatePhase, null);
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: passed.endDate,
        endDateSource: passed.endDateSource,
        endDatePhase: passed.endDatePhase,
      }),
      EVENT_DATE_PASSED_NOTE,
    );
    assert.equal(
      describeLaunchBudget({
        budgetLevel: "ad_set",
        budgetType: "lifetime",
        budgetAmount: 1700,
        currency: "GBP",
        enabledAdSetCount: 2,
        endDate: "2026-11-14T18:00",
        endDatePhase: "presale",
      }),
      "Ad set level · Lifetime · GBP 1,700 across 2 ad sets · ends at presale 14 Nov",
    );
  });

  it("Start = now rounded to :15 in Europe/London; typed start untouched", () => {
    assert.equal(derivedStart(new Date("2026-10-06T17:07:30.000Z"), "Europe/London"), "2026-10-06T18:15");
    assert.equal(derivedStart(new Date("2026-10-06T17:15:00.000Z"), "Europe/London"), "2026-10-06T18:15");
    assert.equal(derivedStart(new Date("2026-10-06T17:15:01.000Z"), "Europe/London"), "2026-10-06T18:30");

    const draft = createDefaultDraft();
    draft.budgetSchedule.startDate = "2026-10-01T09:00";
    draft.budgetSchedule.startDateSource = "operator";
    draft.budgetSchedule.timezone = "Europe/London";
    const kept = applyEventEndToDraft(draft, {
      previousEventDate: null,
      nextEventDate: "2026-11-15",
      nextPresaleAt: "2026-10-16T12:00:00.000Z",
      now: NOW,
      refreshStart: true,
    });
    assert.equal(kept.budgetSchedule.startDate, "2026-10-01T09:00");
    assert.equal(kept.budgetSchedule.startDateSource, "operator");

    const empty = createDefaultDraft();
    empty.budgetSchedule.timezone = "Europe/London";
    const filled = applyEventEndToDraft(empty, {
      previousEventDate: null,
      nextEventDate: "2026-11-15",
      nextPresaleAt: "2026-10-16T12:00:00.000Z",
      now: new Date("2026-10-06T17:07:30.000Z"),
      refreshStart: true,
    });
    assert.equal(filled.budgetSchedule.startDate, "2026-10-06T18:15");
    assert.equal(filled.budgetSchedule.startDateSource, "event");
    assert.equal(filled.budgetSchedule.endDate, "2026-10-16T13:00");
  });

  it("Pinned phase survives an event change when the new event has that phase", () => {
    const pinned = applyEventEndDate({
      endDate: "2026-10-26T12:00",
      endDateSource: "event",
      endDatePhase: "general_sale",
      previousEventDate: "2026-11-15",
      nextEventDate: "2026-12-20",
      nextPresaleAt: "2026-12-01T12:00:00.000Z",
      nextGeneralSaleAt: "2026-12-10T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(pinned.endDatePhase, "general_sale");
    assert.equal(pinned.endDate, "2026-12-10T12:00");

    const dropped = applyEventEndDate({
      endDate: "2026-10-26T12:00",
      endDateSource: "event",
      endDatePhase: "general_sale",
      previousEventDate: "2026-11-15",
      nextEventDate: "2026-12-20",
      nextPresaleAt: "2026-12-01T12:00:00.000Z",
      nextGeneralSaleAt: null,
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(dropped.endDatePhase, "presale");
    assert.equal(dropped.endDate, "2026-12-01T12:00");
  });

  it("migrateDraft: created-day midnight start → event; any other non-empty start → operator", () => {
    const midnight = createDefaultDraft();
    midnight.createdAt = "2026-10-06T08:00:00.000Z";
    midnight.budgetSchedule.startDate = "2026-10-06T00:00";
    midnight.budgetSchedule.timezone = "Europe/London";
    const event = migrateDraft(JSON.parse(JSON.stringify(midnight)) as Record<string, unknown>);
    assert.equal(event.budgetSchedule.startDateSource, "event");

    const typed = createDefaultDraft();
    typed.createdAt = "2026-10-06T08:00:00.000Z";
    typed.budgetSchedule.startDate = "2026-10-06T09:15";
    typed.budgetSchedule.timezone = "Europe/London";
    const operator = migrateDraft(JSON.parse(JSON.stringify(typed)) as Record<string, unknown>);
    assert.equal(operator.budgetSchedule.startDate, "2026-10-06T09:15");
    assert.equal(operator.budgetSchedule.startDateSource, "operator");
  });

  it("draft end = event day, source event, no phase, presale in future → load leaves it on event day", () => {
    const loaded = applyEventEndToDraft(
      (() => {
        const draft = createDefaultDraft();
        draft.budgetSchedule.timezone = "Europe/London";
        draft.budgetSchedule.endDate = "2026-11-15T23:59";
        draft.budgetSchedule.endDateSource = "event";
        return draft;
      })(),
      {
        previousEventDate: null,
        nextEventDate: "2026-11-15",
        nextPresaleAt: "2026-10-16T12:00:00.000Z",
        nextGeneralSaleAt: "2026-10-26T12:00:00.000Z",
        now: NOW,
        eventChanged: false,
      },
    );
    assert.equal(loaded.budgetSchedule.endDate, "2026-11-15T23:59");
    assert.equal(loaded.budgetSchedule.endDateSource, "event");
    assert.notEqual(loaded.budgetSchedule.endDatePhase, "presale");
  });

  it("pinned phase whose date is now past falls through to the next future phase", () => {
    const fallen = applyEventEndDate({
      endDate: "2026-10-01T13:00",
      endDateSource: "event",
      endDatePhase: "presale",
      previousEventDate: null,
      nextEventDate: "2026-11-15",
      nextPresaleAt: "2026-10-01T12:00:00.000Z",
      nextGeneralSaleAt: "2026-10-26T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(fallen.endDatePhase, "general_sale");
    assert.equal(fallen.endDate, "2026-10-26T12:00");
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: fallen.endDate,
        endDateSource: fallen.endDateSource,
        endDatePhase: fallen.endDatePhase,
      }),
      "Ends at general sale (26 Oct)",
    );

    const none = applyEventEndDate({
      endDate: "2026-09-01T23:59",
      endDateSource: "event",
      endDatePhase: "event",
      previousEventDate: null,
      nextEventDate: "2026-09-01",
      nextPresaleAt: "2026-08-01T12:00:00.000Z",
      nextGeneralSaleAt: "2026-08-15T12:00:00.000Z",
      now: NOW,
      timezone: "Europe/London",
    });
    assert.equal(none.endDate, "");
    assert.equal(none.endDatePhase, null);
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: none.endDate,
        endDateSource: none.endDateSource,
        endDatePhase: none.endDatePhase,
      }),
      EVENT_DATE_PASSED_NOTE,
    );
  });

  it("derived start ≥ derived end (presale within 15 min) → end empty and the presale-too-soon note", () => {
    const now = new Date("2026-10-06T12:07:30.000Z");
    const event = {
      eventDate: "2026-11-15",
      presaleAt: "2026-10-06T12:10:00.000Z",
      generalSaleAt: "2026-10-26T12:00:00.000Z",
    };
    const draft = createDefaultDraft();
    draft.budgetSchedule.timezone = "Europe/London";
    const blocked = applyEventEndToDraft(draft, {
      previousEventDate: null,
      nextEventDate: event.eventDate,
      nextPresaleAt: event.presaleAt,
      nextGeneralSaleAt: event.generalSaleAt,
      now,
      refreshStart: true,
    });
    assert.equal(blocked.budgetSchedule.endDate, "");
    assert.equal(blocked.budgetSchedule.endDateSource, "event");
    assert.equal(
      schedulePhaseNote({
        eventId: "evt-1",
        endDate: blocked.budgetSchedule.endDate,
        endDateSource: blocked.budgetSchedule.endDateSource,
        endDatePhase: blocked.budgetSchedule.endDatePhase,
        presaleTooSoon: presaleTooSoon({
          endDate: blocked.budgetSchedule.endDate,
          endDateSource: blocked.budgetSchedule.endDateSource,
          event,
          now,
          timezone: "Europe/London",
        }),
      }),
      PRESALE_TOO_SOON_NOTE,
    );
  });

  it("import with stop_time → end unchanged, source operator", () => {
    const draft = createDefaultDraft();
    draft.budgetSchedule.startDate = "2026-09-16";
    draft.budgetSchedule.endDate = "2026-09-23";
    const saved = applyImportedCampaignSchedule(
      draft,
      {
        event_date: "2026-11-15",
        presale_at: "2026-10-16T12:00:00.000Z",
        general_sale_at: "2026-10-26T12:00:00.000Z",
      },
      NOW,
    );
    assert.equal(saved.budgetSchedule.endDate, "2026-09-23");
    assert.equal(saved.budgetSchedule.endDateSource, "operator");
    assert.equal(saved.budgetSchedule.startDate, "2026-09-16");
    assert.equal(saved.budgetSchedule.startDateSource, "operator");
  });

  it("the events list and the event-context row include presale_at and general_sale_at", () => {
    const eventsRoute = readFileSync(new URL("../../../app/api/events/route.ts", import.meta.url), "utf8");
    const hook = readFileSync(new URL("../../../lib/hooks/useEvents.ts", import.meta.url), "utf8");
    const context = readFileSync(new URL("../../../app/api/wizard/event-context/route.ts", import.meta.url), "utf8");
    const server = readFileSync(new URL("../../../lib/db/events-server.ts", import.meta.url), "utf8");
    const imported = readFileSync(new URL("../../../lib/meta/import/event.ts", import.meta.url), "utf8");
    assert.match(eventsRoute, /presale_at: e\.presale_at/);
    assert.match(eventsRoute, /general_sale_at: e\.general_sale_at/);
    assert.match(hook, /presale_at: string \| null/);
    assert.match(hook, /general_sale_at: string \| null/);
    assert.match(context, /presale_at and general_sale_at/);
    assert.match(server, /\.from\("events"\)/);
    assert.match(server, /\.select\("\*, client/);
    assert.match(imported, /presale_at, general_sale_at/);
  });
});
