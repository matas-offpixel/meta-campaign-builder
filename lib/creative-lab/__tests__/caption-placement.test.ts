import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCaption, type EventFacts } from "../caption-facts.ts";
import {
  PLACE_REFUSAL,
  PLACEMENT_HOME,
  QUOTE_TOO_LONG,
  captionBoxesAt,
  fitQuote,
  placementCentres,
  placementLine,
  searchPlacement,
} from "../caption-placement.ts";
import { validateQuote } from "../quote.ts";

const LINES = ["pov: the drop", "you waited all", "night for", "finally lands"];

const FACTS: EventFacts = {
  eventId: "evt",
  eventName: "Puzzle 4th Birthday",
  eventDate: "2026-12-27",
  venueName: "Circuit",
  venueCity: "Southampton",
  lineup: ["Enzo Siragusa", "Luke Dean"],
  allowedDates: [],
  tiers: [],
};

const LUKE = "Back in Southampton for this one… Closing out the year with Puzzle on 27th December. See you there";

describe("caption placement", () => {
  it("tries the nearest place first, and up before down", () => {
    const places = placementCentres(LINES, 1);
    assert.deepEqual(places.slice(0, 5).map((place) => place.step), [0, -1, 1, -2, 2]);
    assert.equal(places.filter((place) => place.step < 0).length, 5);
    assert.equal(places.filter((place) => place.step > 0).length, 11);
    assert.equal(Math.round(places[0]!.centre * 10) / 10, Math.round(PLACEMENT_HOME * 10) / 10);
  });

  it("resolves the CLP4 fixture to 6 up at 85%", () => {
    const tried: { scale: number; step: number }[] = [];
    const found = searchPlacement({
      lines: LINES,
      baseScale: 1,
      inPoints: [0],
      kind: "caption",
      judge: ({ scale, step }) => {
        tried.push({ scale, step });
        const pass = scale === 0.85 && step === -6;
        return { ok: pass, topShare: pass ? 0 : 0.4, longestRunS: pass ? 0 : 2 };
      },
    });
    assert.equal(found.ok, true);
    if (!found.ok) return;
    assert.equal(found.step, -6);
    assert.equal(found.scale, 0.85);
    assert.equal(found.line, "Moved up and smaller to keep off the face — 85 %");
    const firstSmall = tried.findIndex((try_) => try_.scale === 0.85);
    assert.ok(firstSmall > 0);
    assert.ok(tried.slice(0, firstSmall).every((try_) => try_.scale === 1));
    const full = captionBoxesAt(LINES, 1, PLACEMENT_HOME);
    const smaller = captionBoxesAt(LINES, 0.85, PLACEMENT_HOME - 6 * 38.4);
    const height = (boxes: { top: number; height: number }[]) => boxes[boxes.length - 1]!.top + boxes[boxes.length - 1]!.height - boxes[0]!.top;
    assert.ok(Math.abs(height(full) - 234) < 1);
    assert.ok(Math.abs(height(smaller) - 199) < 1);
  });

  it("refuses only after every place and size, with the record's line", () => {
    const caption = searchPlacement({
      lines: LINES,
      baseScale: 1,
      inPoints: [0, 4],
      kind: "caption",
      judge: () => ({ ok: false, topShare: 1, longestRunS: 3 }),
    });
    assert.deepEqual(caption, { ok: false, line: PLACE_REFUSAL.caption });
    const quote = searchPlacement({
      lines: LINES,
      baseScale: 0.75,
      inPoints: [0],
      kind: "quote",
      judge: () => ({ ok: false, topShare: 1, longestRunS: 3 }),
    });
    assert.equal(quote.ok, false);
    if (quote.ok) return;
    assert.equal(quote.line, PLACE_REFUSAL.quote);
    assert.equal(placementLine(0, 0.75, 0.75), null);
    assert.equal(placementLine(0, 0.65, 0.75), "Smaller to keep off the face — 65 %");
    assert.equal(placementLine(1, 1, 1), "Moved down to keep off the face");
  });

  it("keeps Luke's 98-character quote whole, and refuses a sixth line", () => {
    const fit = fitQuote(LUKE);
    assert.equal(fit.ok, true);
    if (!fit.ok) return;
    assert.equal(fit.size, "long");
    assert.equal(fit.lines.length, 5);
    assert.equal(fit.lines.join(" "), LUKE);
    assert.ok(fit.lines.every((line) => line.length <= 24));
    const over = fitQuote(Array.from({ length: 6 }, () => "abcdefghijklmnop").join(" "));
    assert.equal(over.ok, false);
    if (over.ok) return;
    assert.equal(over.sentence, QUOTE_TOO_LONG);
  });

  it("runs the quote checks and not the writer's", () => {
    const quote = validateQuote(LUKE, FACTS);
    assert.equal(quote.ok, true, quote.sentence ?? "");
    const writer = validateCaption(LUKE, "lineup", ["Luke Dean"], FACTS, { version: "v" }).errors.map((error) => error.code);
    assert.ok(writer.includes("too_long"));
    assert.ok(writer.includes("past_not_in_facts"));
    assert.ok(writer.includes("set_not_in_facts"));
    const held = validateQuote("Back with Ben UFO on 27th December", FACTS);
    assert.equal(held.ok, false);
    assert.match(held.sentence ?? "", /This quote names .+ who isn't on this event/);
    const same = searchPlacement({
      lines: ["one line"],
      baseScale: 1,
      inPoints: [0],
      kind: "caption",
      judge: () => ({ ok: true, topShare: 0, longestRunS: 0 }),
    });
    const asQuote = searchPlacement({
      lines: ["one line"],
      baseScale: 1,
      inPoints: [0],
      kind: "quote",
      judge: () => ({ ok: true, topShare: 0, longestRunS: 0 }),
    });
    assert.equal(same.ok && asQuote.ok && same.centre === asQuote.centre && same.scale === asQuote.scale, true);
  });
});
