import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  classifyPlanEvent,
  defaultPlanEventId,
  planEventPickerRows,
  renderedPlanEventKey,
  sortPlanEvents,
  visiblePlanEvents,
  type PlanEventOption,
} from "../event-picker.ts";

const TODAY = "2026-08-26";

function event(partial: Partial<PlanEventOption> & { id: string; name: string }): PlanEventOption {
  return {
    clientName: "Off Pixel",
    venueName: null,
    eventDate: null,
    eventCode: null,
    kind: "event",
    ...partial,
  };
}

describe("plan event picker labels", () => {
  it("never renders two identical rows when names collide", () => {
    const rows = planEventPickerRows([
      event({
        id: "11111111-1111-4111-8111-111111111111",
        name: "England - Last 8",
        venueName: "Manchester",
        eventDate: "2026-09-01",
        eventCode: "ENG-L8",
      }),
      event({
        id: "22222222-2222-4222-8222-222222222222",
        name: "England - Last 8",
        venueName: "Leeds",
        eventDate: "2026-09-08",
        eventCode: "ENG-L8",
      }),
      event({
        id: "33333333-3333-4333-8333-333333333333",
        name: "England - Last 8",
        venueName: "Manchester",
        eventDate: "2026-09-01",
        eventCode: "ENG-L8",
      }),
      event({
        id: "44444444-4444-4444-8444-444444444444",
        name: "England - Last 8",
        venueName: "Manchester",
        eventDate: "2026-09-01",
        eventCode: "ENG-L8",
      }),
    ]);
    const keys = rows.map(renderedPlanEventKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.match(rows[0].sublabel, /Off Pixel · Manchester · 1 Sep 2026/);
    assert.match(rows[1].sublabel, /Leeds/);
    assert.match(rows[2].sublabel, /ENG-L8|33333333/);
    assert.match(rows[3].sublabel, /44444444/);
  });
});

describe("plan event picker filter and sort", () => {
  const fixture: PlanEventOption[] = [
    event({ id: "past-old", name: "Old", eventDate: "2026-07-01" }),
    event({ id: "past-recent", name: "Recent past", eventDate: "2026-08-20" }),
    event({ id: "undated", name: "Brand", eventDate: null, kind: "brand_campaign" }),
    event({ id: "later", name: "Later", eventDate: "2026-10-01" }),
    event({ id: "soon", name: "Soon", eventDate: "2026-09-01" }),
    event({ id: "today", name: "Today", eventDate: TODAY }),
  ];

  it("hides past events by default and keeps undated + today-or-later", () => {
    const visible = visiblePlanEvents(fixture, { today: TODAY, showPast: false });
    assert.deepEqual(
      visible.map((row) => row.id),
      ["today", "soon", "later", "undated"],
    );
    assert.equal(visible.some((row) => classifyPlanEvent(row, TODAY) === "past"), false);
  });

  it("toggle reveals past events, most recent first, after undated", () => {
    const visible = visiblePlanEvents(fixture, { today: TODAY, showPast: true });
    assert.deepEqual(
      visible.map((row) => row.id),
      ["today", "soon", "later", "undated", "past-recent", "past-old"],
    );
  });

  it("a saved past event_id still resolves when the default filter is on", () => {
    const visible = visiblePlanEvents(fixture, {
      today: TODAY,
      showPast: false,
      selectedId: "past-old",
    });
    assert.ok(visible.some((row) => row.id === "past-old"));
    assert.equal(
      visible.filter((row) => classifyPlanEvent(row, TODAY) === "past").map((row) => row.id).join(),
      "past-old",
    );
    const rows = planEventPickerRows(visible);
    assert.ok(rows.some((row) => row.id === "past-old" && row.label === "Old"));
  });

  it("new-plan default prefers an upcoming event, not the first past row", () => {
    assert.equal(defaultPlanEventId(fixture, { today: TODAY }), "today");
    assert.equal(
      defaultPlanEventId(fixture, { today: TODAY, preferredId: "past-old" }),
      "past-old",
    );
  });

  it("sorts upcoming soonest-first without mutating the input", () => {
    const copy = [...fixture];
    const sorted = sortPlanEvents(fixture, TODAY);
    assert.equal(sorted[0].id, "today");
    assert.deepEqual(fixture.map((row) => row.id), copy.map((row) => row.id));
  });
});

describe("plan event picker wiring vs parent sha", () => {
  it("workspace reuses Combobox and drops the native name-only select", () => {
    const workspace = readFileSync("components/plan/plan-workspace.tsx", "utf8");
    const page = readFileSync("app/(dashboard)/plan/[id]/page.tsx", "utf8");
    assert.match(workspace, /from "@\/components\/ui\/combobox"/);
    assert.match(workspace, /Show past events/);
    assert.doesNotMatch(workspace, /<select[\s\S]*event\.name/);
    assert.match(page, /event_date/);
    assert.match(page, /event_code/);
    assert.match(page, /venue_name/);
    assert.match(page, /client.*name/);
  });
});
