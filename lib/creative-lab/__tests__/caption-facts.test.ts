import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  factsHash,
  formatBilling,
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

  it("A11: '90% sold out' passes only while that claim is live for that release", () => {
    const claim = { release: "2nd release", claim: "90% sold out", live: true };
    const live = { ...P26, captionRelease: "2nd release", liveClaims: [claim] };
    assert.deepEqual(codes("90% sold out", { facts: live }), []);
    assert.deepEqual(codes("90% sold out", { facts: { ...live, liveClaims: [{ ...claim, live: false }] } }), ["scarcity_without_tiers"]);
    assert.deepEqual(codes("90% sold out", { facts: { ...live, captionRelease: "3rd release" } }), ["scarcity_without_tiers"]);
    assert.ok(codes("90% sold out. Final tickets.", { facts: live }).includes("scarcity_without_tiers"));
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
    const long = "aaaaabbbbb cccccddddd eeeeefffff ggggghhhhh iiiiiijjjj";
    const out = validateCaption(long, "lineup", ["Luke Dean", "Enzo Siragusa", "Reeshy", "Benji King"], P26, STYLE);
    assert.equal(out.sizeVariant, "long");
    assert.equal(out.ok, true, out.errors.map((e) => e.detail).join("; "));
    const pastLong = "abcdefghijklm ".repeat(6).trim();
    const overflow = validateCaption(pastLong, "lineup", ["Luke Dean", "Enzo Siragusa", "Reeshy", "Benji King"], P26, STYLE);
    assert.ok(overflow.errors.some((e) => e.code === "too_long"));
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
    assert.equal(facts.hasFacts, true);
    assert.deepEqual(facts.headliners, []);
    assert.deepEqual(facts.lineup, ["Luke Dean", "Reeshy"]);
    assert.deepEqual(facts.allowedDates, ["2026-10-30"]);
    assert.deepEqual(facts.tiers, [
      { name: "Tier 1", price: 20, remaining: 0 },
      { name: "Tier 2", price: 25, remaining: null },
    ]);
  });
});

describe("creative lab captions: M3 checks", () => {
  const overlay = (text: string, opts: Parameters<typeof validateCaption>[5] = {}) =>
    validateCaption(text, "lineup", ["Luke Dean"], P26, STYLE, opts);

  it("allows a crowd number only when the filmed show sold at least that many", () => {
    const text = "This is what 2,000 people look like with Luke Dean";
    assert.equal(overlay(text, { crowdTicketsSold: 2000 }).ok, true);
    assert.deepEqual(overlay(text, { crowdTicketsSold: 400 }).errors.map((e) => e.code), ["crowd_unproven"]);
    assert.deepEqual(overlay(text, { crowdTicketsSold: null }).errors.map((e) => e.code), ["crowd_unproven"]);
  });

  it("lets a Next list name an upcoming show and refuses a past one, at most three", () => {
    const upcoming = "Next: Schak, East End Dubs, Robbie Doherty";
    const pass = overlay(upcoming, { extraNames: ["Schak", "East End Dubs", "Robbie Doherty"] });
    assert.equal(pass.ok, true);
    const past = overlay("Next: Azyr, Schak", { extraNames: ["Schak"] });
    assert.ok(past.errors.some((e) => e.code === "unknown_name" && e.detail.includes("Azyr")));
    const four = overlay("Next: Schak, East End Dubs, Robbie Doherty, Folamour", {
      extraNames: ["Schak", "East End Dubs", "Robbie Doherty", "Folamour"],
    });
    assert.ok(four.errors.some((e) => e.code === "next_list"));
  });

  it("rejects emoji on the overlay and follows the primary-text setting", () => {
    assert.ok(overlay("Luke Dean 💚").errors.some((e) => e.code === "emoji"));
    const primary = overlay("Luke Dean joins", { primaryText: "Who's in? 💚", emojiInPrimary: true });
    assert.equal(primary.ok, true);
    const blocked = overlay("Luke Dean joins", { primaryText: "Who's in? 💚", emojiInPrimary: false });
    assert.deepEqual(blocked.errors.map((e) => e.code), ["primary_emoji"]);
  });

  it("uses the long size from 73 to 96 characters and rejects 97 or a word past the line", () => {
    const line = (n: number, ch: string) => ch.repeat(n);
    const at96 = [line(24, "a"), line(24, "b"), line(24, "c"), line(21, "d")].join(" ");
    assert.equal(at96.length, 96);
    const fit = overlay(at96);
    assert.equal(fit.sizeVariant, "long");
    assert.equal(fit.ok, true);
    assert.equal(fit.lines.length, 4);
    const at97 = `${at96}e`;
    assert.equal(at97.length, 97);
    assert.ok(overlay(at97).errors.some((e) => e.code === "too_long"));
    assert.ok(overlay("a".repeat(19)).errors.some((e) => e.code === "word_too_long"));
    const southampton = "Back in Southampton on 27th December to close out the year w/ Puzzle.";
    assert.equal(wrapCaption(southampton, 18).length, 5);
    const wrapped = overlay(southampton);
    assert.equal(wrapped.sizeVariant, "long");
    assert.ok(wrapped.lines.length <= 5);
    assert.ok(wrapped.lines.every((line) => line.length <= 24));
    assert.equal(wrapped.errors.some((e) => e.code === "too_long" || e.code === "word_too_long"), false);
  });

  it("four_line is exactly four lines", () => {
    const out = validateCaption("One\nTwo\nThree", "four_line", [], P26, STYLE);
    assert.ok(out.errors.some((e) => e.code === "four_line"));
  });

  it("wraps Interplanetary Criminal at the space", () => {
    assert.deepEqual(wrapCaption("Interplanetary Criminal", 18), ["Interplanetary", "Criminal"]);
    assert.equal(overlay("Interplanetary Criminal", { extraNames: ["Interplanetary Criminal"] }).ok, true);
  });
});

const NAMES = ["Enzo Siragusa", "Luke Dean", "Reeshy", "Phill de Janeiro", "Benji King"];
const HEADLINERS = ["Enzo Siragusa", "Luke Dean", "Reeshy"];

describe("creative lab captions: names stay whole and lines balance", () => {
  it("does not split a name in a Next list", () => {
    const lines = wrapCaption("Next: Enzo Siragusa, Luke Dean, Reeshy", 18, NAMES);
    for (const name of ["Enzo Siragusa", "Luke Dean", "Reeshy"]) {
      assert.equal(lines.filter((line) => line.includes(name.split(" ")[0])).length, 1);
      assert.ok(lines.some((line) => line.includes(name)), name);
    }
  });

  it("does not leave coming alone", () => {
    const lines = wrapCaption("The lineup is coming", 18);
    assert.ok(lines.every((line) => line !== "coming"));
    assert.ok(lines.some((line) => line.includes("coming") && line.split(/\s+/).length > 1));
  });

  it("reflows a newline so a one-word line cannot sit in the middle", () => {
    const out = validateCaption("Luke Dean closing\nout\nCircuit for our 4th birthday", "lineup", ["Luke Dean"], P26, STYLE);
    assert.equal(out.lines.includes("out"), false);
    assert.ok(out.lines.every((line, i) => i === out.lines.length - 1 || line.trim().split(/\s+/).length > 1));
  });

  it("keeps Phill de Janeiro and Benji King whole", () => {
    const lines = wrapCaption("Phill de Janeiro & Benji King", 18, ["Phill de Janeiro", "Benji King"]);
    assert.ok(lines.some((line) => line.includes("Phill de Janeiro")));
    assert.ok(lines.some((line) => line.includes("Benji King")));
    assert.equal(lines.some((line) => line === "de" || line.startsWith("Janeiro") || line === "Benji"), false);
  });
});

describe("creative lab captions: long size, sale stage, billing", () => {
  const billed: EventFacts = { ...P26, headliners: HEADLINERS };

  it("passes the 94-character Prospa line on the long size", () => {
    const text = "Prospa at NX last season. This season: Interplanetary Criminal, Schak, East End Dubs and more.";
    assert.equal(text.length, 94);
    const names = ["Prospa", "Interplanetary Criminal", "Schak", "East End Dubs"];
    const lines = wrapCaption(text, 24, names);
    assert.ok(lines.length <= 5, lines.join(" | "));
    assert.ok(lines.some((line) => line.includes("Interplanetary Criminal")));
    assert.ok(lines.some((line) => line.includes("East End Dubs")));
    const out = validateCaption(text, "whats_next", names, P26, STYLE, {
      extraNames: names,
      pastAppearances: [{ artist: "Prospa", venue: "NX" }],
    });
    assert.equal(out.sizeVariant, "long");
    assert.equal(out.ok, true, out.errors.map((e) => e.detail).join("; "));
  });

  it("uses ticket CTAs on sale and signup CTAs before it", () => {
    const ticket = validateCaption("Luke Dean at Circuit", "lineup", ["Luke Dean"], P26, STYLE, {
      saleStage: "on_sale",
      primaryText: "Tickets on sale now",
    });
    assert.equal(ticket.ok, true);
    const signupOnSale = validateCaption("Luke Dean at Circuit", "lineup", ["Luke Dean"], P26, STYLE, {
      saleStage: "on_sale",
      primaryText: "Get on the list for priority access",
    });
    assert.ok(signupOnSale.errors.some((e) => e.code === "signup_on_sale"));
    const overlaySignup = validateCaption("Sign up for presale", "lineup", [], P26, STYLE, { saleStage: "on_sale" });
    assert.ok(overlaySignup.errors.some((e) => e.code === "signup_on_sale"));
    const earlyTicket = validateCaption("Luke Dean at Circuit", "lineup", ["Luke Dean"], P26, STYLE, {
      saleStage: "upcoming",
      primaryText: "Grab yours",
    });
    assert.ok(earlyTicket.errors.some((e) => e.code === "ticket_before_sale"));
    const signup = validateCaption("Luke Dean at Circuit", "lineup", ["Luke Dean"], P26, STYLE, {
      saleStage: "signup",
      primaryText: "Who's coming?",
    });
    assert.equal(signup.ok, true);
  });

  it("rejects scarcity wording when Puzzle has no ticket numbers", () => {
    for (const text of ["Final tickets", "Selling fast", "80% sold"]) {
      const out = validateCaption(text, "scarcity", [], P26, STYLE);
      assert.ok(out.errors.some((e) => e.code === "scarcity_without_tiers"), text);
    }
  });

  it("rejects a support-only lineup caption and keeps a folded bill", () => {
    const alone = validateCaption("Phill de Janeiro at Circuit", "lineup", ["Phill de Janeiro"], billed, STYLE);
    assert.ok(alone.errors.some((e) => e.code === "support_artist"));
    const asked = validateCaption("Phill de Janeiro at Circuit", "lineup", ["Phill de Janeiro"], billed, STYLE, {
      allowSupportArtist: "Phill de Janeiro",
    });
    assert.equal(asked.ok, true, asked.errors.map((e) => e.detail).join("; "));
    assert.equal(formatBilling(billed), "Enzo Siragusa, Luke Dean, Reeshy & more");
    const folded = validateCaption(formatBilling(billed), "lineup", HEADLINERS, billed, STYLE);
    assert.equal(folded.ok, true, folded.errors.map((e) => e.detail).join("; "));
    const full = validateCaption("Enzo Siragusa, Luke Dean, Reeshy, Phill de Janeiro, Benji King", "lineup", NAMES, billed, STYLE);
    assert.equal(full.errors.some((e) => e.code === "support_artist"), false);
  });

  it("builds a Next list from headliners", () => {
    const support = validateCaption("Next: Phill de Janeiro", "whats_next", ["Phill de Janeiro"], billed, STYLE);
    assert.ok(support.errors.some((e) => e.code === "next_list" || e.code === "support_artist"));
    const next = validateCaption("Next: Enzo Siragusa, Luke Dean", "whats_next", HEADLINERS, billed, STYLE);
    assert.equal(next.ok, true, next.errors.map((e) => e.detail).join("; "));
  });

  it("rejects the generic overlay lines", () => {
    assert.ok(validateCaption("Sign up now", "lineup", [], P26, STYLE).errors.some((e) => e.code === "generic_overlay"));
    assert.ok(validateCaption("Four years deep", "experience", [], P26, STYLE).errors.some((e) => e.code === "generic_overlay"));
    assert.ok(validateCaption("This one matters", "experience", [], P26, STYLE).errors.some((e) => e.code === "generic_overlay"));
    assert.ok(validateCaption("Puzzle turns 4", "experience", [], P26, STYLE).errors.some((e) => e.code === "generic_overlay"));
  });
});

describe("creative lab captions: claims the record does not hold", () => {
  const billed: EventFacts = { ...P26, headliners: HEADLINERS };
  const sameRoom = "Same room. Next: Enzo Siragusa, Luke Dean, Reeshy";

  it("rejects a set time, on the overlay or the primary text", () => {
    for (const text of ["closing out", "opening", "first track", "last track", "headlining", "b2b", "3-hour set", "all night long", "sunrise set"]) {
      assert.ok(validateCaption(`Luke Dean ${text} Circuit`, "lineup", ["Luke Dean"], billed, STYLE).errors.some((e) => e.code === "set_not_in_facts"), text);
    }
    const closing = validateCaption("Luke Dean closing out Circuit", "lineup", ["Luke Dean"], billed, STYLE);
    assert.ok(closing.errors.some((e) => e.code === "set_not_in_facts"));
    const primary = validateCaption("Luke Dean at Circuit", "lineup", ["Luke Dean"], billed, STYLE, {
      primaryText: "Luke Dean closing out Circuit",
    });
    assert.ok(primary.errors.some((e) => e.code === "set_not_in_facts"));
    assert.equal(validateCaption("Enzo Siragusa at Circuit last season", "whats_next", ["Enzo Siragusa"], billed, STYLE, {
      extraNames: ["Enzo Siragusa"],
    }).errors.some((e) => e.code === "set_not_in_facts"), false);
  });

  it("rejects footage claims unless the clip was filmed at that venue", () => {
    const dropped = validateCaption("POV: Luke Dean just dropped the first track at Circuit", "pov", ["Luke Dean"], billed, STYLE);
    assert.ok(dropped.errors.some((e) => e.code === "footage_venue"));
    assert.ok(dropped.errors.some((e) => e.code === "set_not_in_facts"));
    const noClip = validateCaption(sameRoom, "whats_next", HEADLINERS, billed, STYLE);
    assert.ok(noClip.errors.some((e) => e.code === "footage_venue"));
    const filmed = validateCaption(sameRoom, "whats_next", HEADLINERS, billed, STYLE, { clipVenueName: "Circuit" });
    assert.equal(filmed.ok, true, filmed.errors.map((e) => e.detail).join("; "));
    const otherRoom = validateCaption(sameRoom, "whats_next", HEADLINERS, billed, STYLE, { clipVenueName: "Engine Rooms" });
    assert.ok(otherRoom.errors.some((e) => e.code === "footage_venue"));
    assert.equal(validateCaption("Luke Dean is playing Circuit", "lineup", ["Luke Dean"], billed, STYLE).ok, true);
    assert.equal(validateCaption("Enzo Siragusa, Luke Dean, Reeshy & more are taking over Circuit", "lineup", HEADLINERS, billed, STYLE).ok, true);
  });

  it("requires Pick one to be 2 or 3 different upcoming shows, never this bill", () => {
    const nights = ["Bristol", "Leeds"];
    const list = validateCaption("Pick one: Bristol or Leeds", "question", [], billed, STYLE, { upcomingEvents: nights });
    assert.equal(list.ok, true, list.errors.map((e) => e.detail).join("; "));
    const artists = validateCaption("Pick one: Enzo Siragusa, Luke Dean or Reeshy", "question", HEADLINERS, billed, STYLE, { upcomingEvents: nights });
    assert.ok(artists.errors.some((e) => e.code === "pick_one"));
    const next = validateCaption("Pick one: Next: Bristol, Leeds", "question", [], billed, STYLE, { upcomingEvents: nights });
    assert.ok(next.errors.some((e) => e.code === "pick_one"));
    const few = validateCaption("Pick one: Bristol or Leeds", "question", [], billed, STYLE, { upcomingEvents: ["Bristol"] });
    assert.ok(few.errors.some((e) => e.code === "pick_one" && /upcoming shows/.test(e.detail)));
  });

  it("rejects a past appearance that the record does not hold", () => {
    const line = "Luke Dean at Circuit last season";
    const rejected = validateCaption(line, "whats_next", ["Luke Dean"], billed, STYLE);
    assert.ok(rejected.errors.some((e) => e.code === "past_not_in_facts"), rejected.errors.map((e) => e.detail).join("; "));
    for (const text of ["Luke Dean is back at Circuit", "Luke Dean returns to Circuit", "Luke Dean at Circuit last year"]) {
      assert.ok(validateCaption(text, "whats_next", ["Luke Dean"], billed, STYLE).errors.some((e) => e.code === "past_not_in_facts"), text);
    }
    const held = validateCaption(line, "whats_next", ["Luke Dean"], billed, STYLE, {
      pastAppearances: [{ artist: "Luke Dean", venue: "Circuit" }],
    });
    assert.equal(held.errors.some((e) => e.code === "past_not_in_facts"), false);
    const city = "Luke Dean back in Southampton";
    const missingCity = validateCaption(city, "whats_next", ["Luke Dean"], billed, STYLE);
    assert.ok(missingCity.errors.some((e) => e.code === "past_not_in_facts"));
    const heldCity = validateCaption(city, "whats_next", ["Luke Dean"], billed, STYLE, {
      pastAppearances: [{ artist: "Luke Dean", venue: "Engine Rooms", city: "southampton" }],
    });
    assert.equal(heldCity.errors.some((e) => e.code === "past_not_in_facts"), false);
    const enzo = "Back in Southampton on 27th December to close out the year w/ Puzzle.";
    const unnamed = validateCaption(enzo, "artist_first_person", [], P26, STYLE, { speakingArtist: "Enzo Siragusa" });
    assert.ok(unnamed.errors.some((e) => e.code === "past_not_in_facts"), unnamed.errors.map((e) => e.detail).join("; "));
    const southampton = validateCaption(enzo, "artist_first_person", [], P26, STYLE, {
      speakingArtist: "Enzo Siragusa",
      pastAppearances: [{ artist: "Enzo Siragusa", venue: "Engine Rooms", city: "Southampton" }],
    });
    assert.equal(southampton.ok, true, southampton.errors.map((e) => e.detail).join("; "));
    assert.equal(southampton.errors.some((e) => e.code === "past_not_in_facts"), false);
    const confirmed = validateCaption(enzo, "artist_first_person", [], P26, STYLE, {
      speakingArtist: "Enzo Siragusa",
      playedCities: ["Southampton"],
    });
    assert.equal(confirmed.ok, true, confirmed.errors.map((e) => e.detail).join("; "));
    assert.equal(confirmed.errors.some((e) => e.code === "past_not_in_facts"), false);
    const elsewhere = validateCaption(enzo, "artist_first_person", [], P26, STYLE, {
      speakingArtist: "Enzo Siragusa",
      playedCities: ["Bristol"],
    });
    assert.ok(elsewhere.errors.some((e) => e.code === "past_not_in_facts"), elsewhere.errors.map((e) => e.detail).join("; "));
    const otherArtist = validateCaption("Luke Dean back in Southampton", "artist_first_person", ["Luke Dean"], P26, STYLE, {
      speakingArtist: "Enzo Siragusa",
      playedCities: ["Southampton"],
    });
    assert.ok(otherArtist.errors.some((e) => e.code === "past_not_in_facts"));
    assert.equal(validateCaption("Luke Dean at Circuit", "lineup", ["Luke Dean"], billed, STYLE).ok, true);
  });

  it("keeps a date on one line", () => {
    const day = wrapCaption("Luke Dean at Circuit on 27 December", 18, ["Luke Dean"]);
    assert.ok(day.some((line) => line.includes("27 December")), day.join(" | "));
    assert.equal(day.some((line) => line === "27" || line === "December"), false);
    const sunday = wrapCaption("Sunday 27 December at Circuit", 18);
    assert.ok(sunday.some((line) => line.includes("Sunday 27 December")), sunday.join(" | "));
    const narrow = wrapCaption("Sunday 27 December at Circuit", 17);
    assert.ok(narrow.some((line) => line.includes("27 December")), narrow.join(" | "));
    assert.equal(narrow.some((line) => line.includes("Sunday 27 December")), false);
  });
});
