import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveEventVariables,
  substituteTemplateVariables,
} from "../event-variables.ts";

const fixtureEvent = {
  name: "Summer Showcase",
  event_date: "2026-07-15",
  event_start_at: "2026-07-15T19:00:00.000Z",
  event_timezone: "Europe/London",
  ticket_url: "https://tickets.example.com/e1",
  presale_at: "2026-06-01T10:00:00.000Z",
  general_sale_at: "2026-06-05T10:00:00.000Z",
  venue_name: "Royal Hall",
  venue_city: "London",
};

test("resolveEventVariables maps fixture fields", () => {
  const now = new Date("2026-05-01T12:00:00.000Z");
  const v = resolveEventVariables(fixtureEvent, {
    artistHeadliners: ["DJ A", "DJ B"],
    now,
  });
  assert.equal(v.event_name, "Summer Showcase");
  assert.equal(v.ticket_url, "https://tickets.example.com/e1");
  assert.equal(v.venue_name, "Royal Hall");
  assert.equal(v.city, "London");
  assert.equal(v.artist_headliners, "DJ A, DJ B");
  assert.match(v.event_date_short, /Jul/);
  assert.equal(v.days_to_presale !== "", true);
});

test("missing presale/general sale uses already-on-sale semantics for days_to_presale", () => {
  const v = resolveEventVariables(
    {
      ...fixtureEvent,
      presale_at: null,
      general_sale_at: null,
    },
    { now: new Date("2026-05-01T12:00:00.000Z") },
  );
  assert.equal(v.days_to_presale, "0");
});

test("substituteTemplateVariables replaces tokens", () => {
  const md = "Hi {{event_name}} — [tix]({{ticket_url}})";
  const out = substituteTemplateVariables(md, {
    event_name: "Show",
    ticket_url: "https://x.test",
  });
  assert.match(out, /Hi Show/);
  assert.match(out, /https:\/\/x\.test/);
});
