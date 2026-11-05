import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  factsHash,
  loadEventFacts,
  remainingStock,
  validateCaption,
  wrapCaption,
  type CaptionErrorCode,
  type EventFacts,
  type FactTier,
} from "../caption-facts.ts";
import type { ServiceRoleDb } from "../load.ts";
import type { CaptionStyle } from "../tags.ts";
import { fakeDb } from "./fake-db.ts";

const STYLE = { version: "luke-dean-v1" };

const P26: EventFacts = {
  eventId: "evt-day",
  eventName: "Puzzle 4th Birthday Part 1",
  eventDate: "2026-12-27",
  venueName: "Circuit",
  venueCity: "Southampton",
  lineup: ["Enzo Siragusa", "Luke Dean", "Reeshy", "Phill de Janeiro", "Benji King"],
  allowedDates: ["2026-10-29", "2026-10-30"],
  tiers: [],
};

function withTiers(tiers: FactTier[]): EventFacts {
  return { ...P26, tiers };
}

function codes(text: string, opts: { style?: CaptionStyle; names?: string[]; facts?: EventFacts } = {}): CaptionErrorCode[] {
  return validateCaption(text, opts.style ?? "lineup", opts.names ?? [], opts.facts ?? P26, STYLE).errors.map((e) => e.code);
}

describe("creative lab captions: the spec's cases", () => {
  it("passes the lineup caption for P26-BDAY-shaped facts, in four lines at 18 characters", () => {
    const out = validateCaption(
      "Luke Dean joins Enzo Siragusa for our 4th Birthday. You in?",
      "lineup",
      ["Luke Dean", "Enzo Siragusa"],
      P26,
      STYLE,
    );
    assert.deepEqual(out.errors, []);
    assert.equal(out.ok, true);
    assert.deepEqual(out.lines, ["Luke Dean joins", "Enzo Siragusa for", "our 4th Birthday.", "You in?"]);
    assert.match(out.factsHash, /^[0-9a-f]{64}$/);
  });

  it("rejects 15.11, a date the record does not hold", () => {
    assert.deepEqual(codes("Luke Dean live 15.11", { names: ["Luke Dean"] }), ["date_not_in_facts"]);
  });

  it("'Final tier on sale' fails without tiers and passes with one in stock", () => {
    assert.deepEqual(codes("Final tier on sale"), ["scarcity_without_tiers"]);
    assert.deepEqual(codes("Final tier on sale", { facts: withTiers([{ name: "Final release", price: 30, remaining: 40 }]) }), []);
  });

  it("an unknown artist fails, declared or not", () => {
    assert.deepEqual(codes("Seth Troxler joins the party", { names: ["Seth Troxler"] }), ["unknown_name", "unknown_name"]);
    assert.deepEqual(codes("Seth Troxler joins the party"), ["unknown_name"]);
  });
});

describe("creative lab captions: names", () => {
  it("one-word and particle names pass when on the lineup", () => {
    assert.deepEqual(codes("Phill de Janeiro and Reeshy open up", { names: ["Phill de Janeiro", "Reeshy"] }), []);
  });

  it("an undeclared particle name off the lineup is caught by the backstop", () => {
    assert.deepEqual(codes("Carl de Souza on the decks"), ["unknown_name"]);
  });

  it("event name, venue and city words count; the stoplist covers title-case phrases", () => {
    assert.deepEqual(codes("Puzzle turns four at Circuit, Southampton", { names: ["Puzzle", "Circuit"] }), []);
    assert.deepEqual(codes("New Year? Boxing Day? Birthday Weekend with Luke Dean", { names: ["Luke Dean"] }), []);
  });
});

describe("creative lab captions: dates", () => {
  it("an ordinal alone is not a date", () => {
    assert.deepEqual(codes("Our 4th Birthday is coming"), []);
  });

  it("accepts the event date in every written form", () => {
    for (const text of ["See you 27 Dec", "27 December", "Sun 27 Dec", "27.12", "Dec 27th", "Sunday 27th December 2026"]) {
      assert.deepEqual(codes(text), [], text);
    }
  });

  it("checks weekdays: next to a date against that date, alone against the event's", () => {
    assert.deepEqual(codes("Sat 27 Dec"), ["weekday_mismatch"]);
    assert.deepEqual(codes("See you Sunday"), []);
    assert.deepEqual(codes("See you Saturday"), ["weekday_mismatch"]);
  });

  it("allowed dates (presale, general sale) pass; anything else fails", () => {
    assert.deepEqual(codes("On sale Fri 30 Oct"), []);
    assert.deepEqual(codes("On sale 31 Oct"), ["date_not_in_facts"]);
    assert.deepEqual(codes("27 Dec 2025"), ["date_not_in_facts"]);
  });

  it("times and prices are not dates", () => {
    assert.deepEqual(codes("Doors 10.30", { facts: withTiers([{ name: "GA", price: 12.5, remaining: 10 }]) }), []);
    assert.deepEqual(codes("From £12.50", { facts: withTiers([{ name: "GA", price: 12.5, remaining: 10 }]) }), []);
  });
});

describe("creative lab captions: prices and scarcity", () => {
  const two: FactTier[] = [
    { name: "Tier 2", price: 25, remaining: 60 },
    { name: "Final release", price: 30, remaining: 200 },
  ];

  it("a £ amount must be a tier price", () => {
    assert.deepEqual(codes("Tickets £25", { facts: withTiers(two) }), []);
    assert.deepEqual(codes("Tickets £20", { facts: withTiers(two) }), ["price_not_in_facts"]);
    assert.deepEqual(codes("Tickets £25"), ["price_not_in_facts"]);
  });

  it("'Final release' fails with two tiers in stock, passes with only the top tier left", () => {
    assert.deepEqual(codes("Final release on sale", { facts: withTiers(two) }), ["final_not_true"]);
    const onlyTop = withTiers([{ ...two[0], remaining: 0 }, two[1]]);
    assert.deepEqual(codes("Final release on sale", { facts: onlyTop }), []);
    const onlyCheap = withTiers([two[0], { ...two[1], remaining: 0 }]);
    assert.deepEqual(codes("Final release on sale", { facts: onlyCheap }), ["final_not_true"]);
  });

  it("'Under 100 left' fails when remaining is unknown or too high, passes when true", () => {
    assert.deepEqual(codes("Under 100 left", { facts: withTiers([{ name: "GA", price: 25, remaining: null }]) }), [
      "remaining_unknown",
    ]);
    assert.deepEqual(codes("Under 100 left", { facts: withTiers([{ name: "GA", price: 25, remaining: 120 }]) }), [
      "count_not_true",
    ]);
    assert.deepEqual(codes("Under 100 left", { facts: withTiers([{ name: "GA", price: 25, remaining: 80 }]) }), []);
    assert.deepEqual(codes("Only 50 tickets left", { facts: withTiers([{ name: "GA", price: 25, remaining: 80 }]) }), [
      "count_not_true",
    ]);
  });

  it("'sold out' needs a tier with none left; style scarcity needs tiers whatever the words", () => {
    assert.deepEqual(codes("Tier 2 sold out", { facts: withTiers(two) }), ["sold_out_not_true"]);
    assert.deepEqual(codes("Tier 2 sold out", { facts: withTiers([{ ...two[0], remaining: 0 }, two[1]]) }), []);
    assert.deepEqual(codes("Be quick", { style: "scarcity" }), ["scarcity_without_tiers"]);
  });
});

describe("creative lab captions: form", () => {
  it("wraps at the style profile's characters per line and fails over four lines", () => {
    assert.deepEqual(wrapCaption("one two three four five", 9), ["one two", "three", "four five"]);
    const long = "Luke Dean and Enzo Siragusa and Reeshy and Benji King all on one bill this year";
    const out = validateCaption(long, "lineup", ["Luke Dean", "Enzo Siragusa", "Reeshy", "Benji King"], P26, STYLE);
    assert.deepEqual(out.errors.map((e) => e.code), ["too_long"]);
    const wide = validateCaption(long, "lineup", ["Luke Dean", "Enzo Siragusa", "Reeshy", "Benji King"], P26, {
      version: "wide",
      charsPerLine: 40,
    });
    assert.equal(wide.ok, true);
  });

  it("no emoji, no '#', not all caps", () => {
    assert.deepEqual(codes("You in? 🔥"), ["emoji"]);
    assert.deepEqual(codes("You in? #puzzle"), ["hashtag"]);
    assert.deepEqual(codes("YOU IN?"), ["all_caps"]);
  });
});

describe("creative lab captions: facts", () => {
  it("remaining = allocation − sold; null when either is unknown", () => {
    assert.equal(remainingStock(220, 300), 80);
    assert.equal(remainingStock(220, null), null);
    assert.equal(remainingStock(null, 300), null);
  });

  it("facts_hash ignores order and changes with stock", () => {
    const a = withTiers([
      { name: "A", price: 20, remaining: 5 },
      { name: "B", price: 25, remaining: 9 },
    ]);
    const b = { ...a, lineup: [...a.lineup].reverse(), tiers: [...a.tiers].reverse() };
    assert.equal(factsHash(a), factsHash(b));
    assert.notEqual(factsHash(a), factsHash(withTiers([{ name: "A", price: 20, remaining: 4 }, a.tiers[1]])));
  });

  it("loadEventFacts reads the event, the Lab facts and the tiers", async () => {
    const db = fakeDb({
      events: [{ id: "evt-day", name: "Puzzle 4th Birthday Part 1", event_date: "2026-12-27", venue_name: "Circuit", venue_city: "Southampton" }],
      creative_lab_event_facts: [{ event_id: "evt-day", lineup: ["Luke Dean ", "Reeshy"], allowed_dates: ["2026-10-30"] }],
      event_ticket_tiers: [
        { event_id: "evt-day", tier_name: "Tier 1", price: "20.00", quantity_sold: 300, quantity_available: 300 },
        { event_id: "evt-day", tier_name: "Tier 2", price: 25, quantity_sold: 40, quantity_available: null },
      ],
    });
    const facts = await loadEventFacts(db as unknown as ServiceRoleDb, "evt-day");
    assert.deepEqual(facts.lineup, ["Luke Dean", "Reeshy"]);
    assert.deepEqual(facts.allowedDates, ["2026-10-30"]);
    assert.deepEqual(facts.tiers, [
      { name: "Tier 1", price: 20, remaining: 0 },
      { name: "Tier 2", price: 25, remaining: null },
    ]);
  });
});
