/**
 * Europe/London moment formatter — Sep not Sept, unpadded day.
 * Run: node --test lib/viz/__tests__/format-moment.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatVizDay,
  formatVizMoment,
  formatVizRelative,
} from "../format-moment.ts";

describe("formatVizMoment", () => {
  it("pins BST September — Sep not Sept, unpadded day", () => {
    assert.equal(formatVizMoment("2026-09-06T22:00:00Z"), "Sun 6 Sep · 23:00");
  });

  it("pins a late-August BST offset", () => {
    assert.equal(formatVizMoment("2026-08-26T21:00:00Z"), "Wed 26 Aug · 22:00");
  });

  it("pins GMT so a hardcoded +1 cannot pass", () => {
    assert.equal(formatVizMoment("2026-01-06T22:00:00Z"), "Tue 6 Jan · 22:00");
  });

  it("accepts a Date and returns — for invalid input", () => {
    assert.equal(formatVizMoment(new Date("2026-09-06T22:00:00Z")), "Sun 6 Sep · 23:00");
    assert.equal(formatVizMoment("not-a-date"), "—");
    assert.equal(formatVizMoment(new Date("invalid")), "—");
  });
});

describe("formatVizDay / formatVizRelative", () => {
  it("drops the time for the day form", () => {
    assert.equal(formatVizDay("2026-09-06T22:00:00Z"), "Sun 6 Sep");
    assert.equal(formatVizDay("bad"), "—");
  });

  it("relative pins in / ago / now", () => {
    const now = new Date("2026-08-27T12:00:00Z");
    assert.equal(formatVizRelative(new Date("2026-08-29T09:00:00Z"), now), "in 2d");
    assert.equal(formatVizRelative(now, new Date("2026-08-29T09:00:00Z")), "2d ago");
    assert.equal(formatVizRelative(now, now), "now");
    assert.equal(formatVizRelative("bad", now), "—");
  });
});
