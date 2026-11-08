import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { MATAS_USER_IDS } from "../../auth/operator-allowlist.ts";
import { computeCopyPerformance, writeCopyPerformance } from "../copy-performance.ts";
import { dropUnsupportedClaims, emptyDictionaries, normaliseCopy, voiceOf } from "../copy/normalise.ts";
import { COPY_SHRINK_K, isNameOnlyTemplate, passesCopyMinimum, scoreTemplates, shrinkTowardOne, type ScoreAd } from "../copy/score.ts";
import { eventForCopyAd, rollAd, showOf } from "../copy/shows.ts";

register(new URL("../../__tests__/support/alias-hooks.mjs", import.meta.url));

const IRONWORKS = emptyDictionaries({
  lineup: ["Jamie Jones", "Sweely"],
  venueName: "Ironworks",
  venueCity: "London",
  eventName: "Jamie Jones",
  clientName: "Ironworks",
  globalArtists: ["Jamie Jones"],
  globalVenues: ["London", "Ironworks"],
  globalCities: ["London"],
  globalEvents: ["Jamie Jones", "Voyager"],
  globalPromoters: ["Ironworks"],
});

describe("copy normaliser", () => {
  it("Ironworks as the venue wins over Ironworks the client", () => {
    const atVenue = normaliseCopy("Saturday night at Ironworks", IRONWORKS);
    assert.match(atVenue!.template, /\{venue\}/);
    assert.doesNotMatch(atVenue!.template, /\{promoter\}/);
    const elsewhere = normaliseCopy("Ironworks presents", emptyDictionaries({
      ...IRONWORKS,
      venueName: "Fabric",
    }));
    assert.match(elsewhere!.template, /\{promoter\}/);
    assert.doesNotMatch(elsewhere!.template, /\{venue\}/);
  });

  it("London stored as a venue name stays a city", () => {
    const line = normaliseCopy("See you in London", emptyDictionaries({
      venueName: "London",
      venueCity: "London",
      globalVenues: ["London"],
      globalCities: ["London"],
    }));
    assert.equal(line?.template, "See you in {city}");
    assert.match(line!.key, /\{city\}/);
  });

  it("an event named after an artist stays the artist", () => {
    const line = normaliseCopy("Jamie Jones at the venue", IRONWORKS);
    assert.match(line!.template, /\{artist\}/);
    assert.doesNotMatch(line!.template, /\{event\}/);
    const named = normaliseCopy("Jamie Jones at the venue", emptyDictionaries({
      eventName: "Jamie Jones",
      globalArtists: ["Jamie Jones"],
    }));
    assert.match(named!.template, /\{artist\}/);
    assert.doesNotMatch(named!.template, /\{event\}/);
  });

  it("a support act missing from the artist library still comes from the lineup", () => {
    const line = normaliseCopy("with Sweely", emptyDictionaries({ lineup: ["Sweely"], globalArtists: [] }));
    assert.match(line!.template, /\{artist\}/);
    const missed = normaliseCopy("with Sweely", emptyDictionaries({ globalArtists: [] }));
    assert.match(missed!.template, /Sweely/);
  });

  it("each claim is a named slot, and an unsupported claim is dropped on refill", () => {
    const line = normaliseCopy(
      "FINAL 500 TICKETS. 85% sold. A world exclusive b2b. Their debut. 5 Years of Appetite. Venue opening.",
      emptyDictionaries(),
    );
    for (const slot of ["final_tickets", "percent_sold", "b2b", "debut", "years", "opening"] as const) {
      assert.ok(line!.claims.includes(slot), slot);
      assert.match(line!.key, new RegExp(`\\{${slot}\\}`));
    }
    assert.equal(dropUnsupportedClaims("FINAL {final_tickets} tonight", {}), "FINAL tonight");
    assert.match(dropUnsupportedClaims("FINAL {final_tickets} tonight", { finalTickets: true }), /\{final_tickets\}/);
  });

  it("voice comes from the page, and the key drops emoji and punctuation", () => {
    assert.deepEqual(voiceOf("11111_222", ["11111"]), { voice: "promoter", pageId: "11111" });
    assert.deepEqual(voiceOf("33333_222", ["11111"]), { voice: "artist", pageId: "33333" });
    assert.deepEqual(voiceOf(null, ["11111"]), { voice: "unknown", pageId: null });
    const line = normaliseCopy("See you soon! 🔥", emptyDictionaries());
    assert.equal(line?.key, "see you soon");
  });

  it("an event name that contains a claim word is one {event}, not a claim", () => {
    const dict = emptyDictionaries({
      eventName: "AZYR b2b Partiboi69",
      venueCity: "Newcastle",
      globalEvents: ["AZYR b2b Partiboi69"],
      globalCities: ["Newcastle"],
    });
    const line = normaliseCopy("AZYR b2b Partiboi69 - A world exclusive coming to Newcastle.", dict);
    assert.equal(line?.key, "{event} a world exclusive coming to {city}");
    assert.deepEqual(line?.claims, []);
    const real = normaliseCopy("A world exclusive b2b coming to Newcastle.", dict);
    assert.equal(real?.key, "a world exclusive {b2b} coming to {city}");
    assert.deepEqual(real?.claims, ["b2b"]);
  });

  it("an event name with a dash suffix matches by its first part", () => {
    const dict = emptyDictionaries({ eventName: "Mall Grab - Sheffield", venueCity: "Sheffield", globalCities: ["Sheffield"] });
    const line = normaliseCopy("Mall Grab makes his much anticipated return to Sheffield.", dict);
    assert.equal(line?.key, "{event} makes his much anticipated return to {city}");
    // The city inside the name is already {city} by the time the event is matched; the first part still carries it.
    const whole = normaliseCopy("Mall Grab - Sheffield is on sale", dict);
    assert.equal(whole?.key, "{event} {city} is on sale");
  });

  it("sentence punctuation with no space after it still separates words", () => {
    const dict = emptyDictionaries({ venueCity: "Sheffield", globalCities: ["Sheffield"] });
    const tight = normaliseCopy("Mall Grab returns to Sheffield.Tickets on sale now", dict);
    const spaced = normaliseCopy("Mall Grab returns to Sheffield. Tickets on sale now", dict);
    assert.equal(tight?.key, "mall grab returns to {city} tickets on sale now");
    assert.equal(tight?.key, spaced?.key);
    assert.equal(normaliseCopy("I'm back, line-up & set times!", emptyDictionaries())?.key, "im back lineup set times");
  });

  it("a time of day is {time}", () => {
    assert.equal(normaliseCopy("Tickets on sale 5th August 12PM.", emptyDictionaries())?.key, "tickets on sale {date} {time}");
    assert.equal(normaliseCopy("Pre-sale -12:00pm Friday 31st July", emptyDictionaries())?.key, "presale {time} {date}");
    assert.equal(normaliseCopy("Presale at 10 am, Thursday 11th September.", emptyDictionaries())?.key, "presale at {time} {date}");
    assert.equal(normaliseCopy("Final tickets go on presale 12:00, Tuesday 25th August.", emptyDictionaries())?.key, "final tickets go on presale {time} {date}");
  });

  it("a weekday or month on its own is {date}", () => {
    assert.equal(normaliseCopy("Tickets on sale Friday 12pm.", emptyDictionaries())?.key, "tickets on sale {date} {time}");
    assert.equal(normaliseCopy("Presale 12pm Wed 9th Sept.", emptyDictionaries())?.key, "presale {time} {date}");
    assert.equal(normaliseCopy("Worakls returns to London this December.", emptyDictionaries())?.key, "worakls returns to london {date}");
    assert.equal(normaliseCopy("Cant wait for NX Loves in October!", emptyDictionaries())?.key, "cant wait for nx loves {date}");
    assert.equal(normaliseCopy("Back at NX this November. Tickets drop Tuesday.", emptyDictionaries())?.key, "back at nx {date} tickets drop {date}");
    // Ordinary words that are also abbreviations stay words.
    assert.equal(normaliseCopy("You may have sat in the sun on Mon", emptyDictionaries())?.key, "you may have sat in the sun on mon");
  });

  it("a run of date phrases is one {date}", () => {
    assert.equal(normaliseCopy("Presale 12pm this Friday 28th August. Sign up.", emptyDictionaries())?.key, "presale {time} {date} sign up");
    assert.equal(normaliseCopy("See you this Saturday, 24th October 2026", emptyDictionaries())?.key, "see you {date}");
  });

  it("hashtags are dropped and a phone number is {phone}", () => {
    const line = normaliseCopy("Table reservations via +971 50 443 0933 #dhbdubai #deephousebible", emptyDictionaries());
    assert.equal(line?.key, "table reservations via {phone}");
    assert.equal(normaliseCopy("Doors 10pm-4am, 18+ only. 1st & 2nd release sold out", emptyDictionaries())?.key, "doors {time}{time} 18 only 1st 2nd release sold out");
  });
});

function ad(overrides: Partial<ScoreAd> & Pick<ScoreAd, "metaAdId" | "eventId" | "spend" | "results">): ScoreAd {
  return {
    showId: overrides.eventId,
    pageId: null,
    clientId: "client-a",
    vertical: "music",
    stage: "ticket_sale",
    voice: "promoter",
    lines: [{ field: "body", key: "see you down in {city}", text: "See you down in London" }],
    ...overrides,
  };
}

describe("copy scoring", () => {
  it("uses the event baseline, the client fallback, events as n, and the proven bar", () => {
    const rows = scoreTemplates([
      ad({ metaAdId: "a1", eventId: "e1", spend: 500, results: 20 }),
      ad({ metaAdId: "a2", eventId: "e1", spend: 500, results: 0, lines: [] }),
      ad({ metaAdId: "a3", eventId: "e2", spend: 200, results: 4 }),
      ad({ metaAdId: "a4", eventId: "e1", clientId: "client-a", spend: 0, results: 0, lines: [{ field: "body", key: "other", text: "Other" }] }),
    ]);
    const all = rows.find((row) => row.scope === "all" && row.template_key === "see you down in {city}")!;
    // e1 has 20 results so its own cost is £50. e2 has 4, so it uses the client cost.
    // Client is 500+500+200 = 1200 spend and 24 results → £50. a3 expected = 4.
    // a1 expected = 10. Index = 14/24.
    assert.equal(all.events_n, 2);
    assert.equal(all.ads_n, 2);
    assert.equal(all.results, 24);
    const raw = 14 / 24;
    assert.equal(all.index_vs_event, Math.round(shrinkTowardOne(2, raw, COPY_SHRINK_K) * 10000) / 10000);
    assert.equal(COPY_SHRINK_K, 2);
    assert.equal(all.proven, all.index_vs_event! <= 0.9);
    assert.equal(passesCopyMinimum(all), true);
    assert.equal(isNameOnlyTemplate("{venue} {city}"), true);
    assert.equal(scoreTemplates([ad({ metaAdId: "n1", eventId: "e1", spend: 400, results: 20, lines: [{ field: "title", key: "{venue} {city}", text: "Ironworks London" }] })]).length, 0);
    assert.equal(isNameOnlyTemplate("see you soon fam extra"), false);
    assert.equal(all.example_text, "See you down in London");

    const oneEvent = scoreTemplates([
      ad({ metaAdId: "b1", eventId: "e1", spend: 200, results: 10 }),
      ad({ metaAdId: "b2", eventId: "e1", spend: 200, results: 10 }),
      ad({ metaAdId: "b3", eventId: "e1", spend: 200, results: 10 }),
    ]);
    assert.equal(oneEvent.find((row) => row.scope === "all")!.events_n, 1);
    assert.equal(oneEvent.find((row) => row.scope === "all")!.ads_n, 3);
    assert.equal(oneEvent.find((row) => row.scope === "all")!.proven, false);

    const sameShow = scoreTemplates([
      ad({ metaAdId: "s1", eventId: "e1", showId: "show", spend: 400, results: 20 }),
      ad({ metaAdId: "s2", eventId: "e2", showId: "show", spend: 400, results: 20 }),
    ]);
    assert.equal(sameShow.find((row) => row.scope === "all")!.events_n, 1);
    assert.equal(sameShow.find((row) => row.scope === "all")!.ads_n, 2);

    const weak = shrinkTowardOne(2, 0.95);
    assert.ok(weak > 0.9);
    const strong = shrinkTowardOne(2, 0.5);
    assert.ok(strong <= 0.9);
  });

  it("is idempotent", () => {
    const ads = [ad({ metaAdId: "a1", eventId: "e1", spend: 400, results: 10 }), ad({ metaAdId: "a2", eventId: "e2", spend: 400, results: 10 })];
    assert.deepEqual(computeCopyPerformance({ ads }), computeCopyPerformance({ ads }));
  });
});

describe("shows", () => {
  const dated = (id: string, date: string, venue: string) => ({
    id,
    date,
    venueName: venue,
    venueKey: venue.toLowerCase(),
    status: "upcoming",
  });

  it("one ad counts toward the event it spent the most on", () => {
    const rolled = rollAd([
      { eventId: "always-on", spend: 30, results: 1 },
      { eventId: "show", spend: 70, results: 4 },
    ]);
    assert.equal(rolled?.eventId, "show");
    assert.equal(rolled?.spend, 100);
    assert.equal(rolled?.results, 5);
  });

  it("events on the same date at the same venue are one show", () => {
    const shows = showOf([
      dated("b", "2026-10-03", "Ironworks"),
      dated("a", "2026-10-03", "Ironworks"),
      dated("c", "2026-11-01", "Ironworks"),
    ]);
    assert.equal(shows.get("a"), shows.get("b"));
    assert.notEqual(shows.get("a"), shows.get("c"));
  });

  it("a bracketed campaign code beats a ledger event that points at a different show", () => {
    const placed = eventForCopyAd(
      { meta_ad_id: "ad", campaign_name: "[IRW0001] Jamie Jones - Signups" },
      { clientId: "colyn-client", eventId: "colyn" },
      [{ eventId: "jamie", clientId: "ironworks", eventCode: "IRW0001", adAccountId: "act_1" }],
    );
    assert.deepEqual(placed, { clientId: "ironworks", eventId: "jamie" });
  });

  it("a campaign that names one other show beats a ledger link that names nobody", () => {
    const shows = [
      { eventId: "worakls", clientId: "client", name: "Worakls" },
      { eventId: "dod", clientId: "client", name: "D.O.D" },
      { eventId: "colyn", clientId: "other", name: "Colyn" },
    ];
    const placed = eventForCopyAd(
      { meta_ad_id: "ad", campaign_name: "[20261204CSA] Woraklis — Purchase" },
      { clientId: "other", eventId: "colyn", eventName: "Colyn" },
      [],
      shows,
    );
    assert.deepEqual(placed, { clientId: "client", eventId: "worakls" });
  });

  it("keeps the ledger event when the campaign names that show", () => {
    const placed = eventForCopyAd(
      { meta_ad_id: "ad", campaign_name: "Colyn at E1" },
      { clientId: "other", eventId: "colyn", eventName: "Colyn" },
      [],
      [
        { eventId: "colyn", clientId: "other", name: "Colyn" },
        { eventId: "worakls", clientId: "client", name: "Worakls" },
      ],
    );
    assert.deepEqual(placed, { clientId: "other", eventId: "colyn" });
  });

  it("keeps the ledger event when the campaign names no show", () => {
    const placed = eventForCopyAd(
      { meta_ad_id: "ad", campaign_name: "Evergreen retargeting" },
      { clientId: "client", eventId: "show" },
      [{ eventId: "jamie", clientId: "ironworks", eventCode: "IRW0001", adAccountId: null }],
    );
    assert.deepEqual(placed, { clientId: "client", eventId: "show" });
  });

  it("a cancelled event is excluded, and an event with no date is not a show", () => {
    const shows = showOf([
      { ...dated("live", "2026-10-03", "Ironworks") },
      { ...dated("off", "2026-10-03", "Ironworks"), status: "cancelled" },
      { id: "always", date: null, venueName: "Ironworks", venueKey: "ironworks", status: "on_sale" },
    ]);
    assert.equal(shows.has("live"), true);
    assert.equal(shows.has("off"), false);
    assert.equal(shows.has("always"), false);
  });
});

describe("copy_performance write", () => {
  it("upserts on the template key and deletes rows from before this run", async () => {
    const rows = scoreTemplates([
      ad({ metaAdId: "a1", eventId: "e1", spend: 400, results: 10 }),
      ad({ metaAdId: "a2", eventId: "e2", spend: 400, results: 10 }),
    ]).filter((row) => row.scope === "all");
    const { db, calls } = fakeDb(() => ({ error: null, count: 1 }));
    const first = await writeCopyPerformance(db, rows, "2026-11-07T03:30:00.000Z");
    const second = await writeCopyPerformance(db, rows, "2026-11-07T03:30:00.000Z");
    assert.equal(first.written, rows.length);
    assert.equal(second.written, rows.length);
    const upserts = calls.filter((call) => call.table === "copy_performance" && op(call, "upsert"));
    assert.equal(upserts.length, 2);
    assert.equal((op(upserts[0], "upsert")?.[1] as { onConflict: string }).onConflict, "template_key,field,stage,voice,scope,scope_id");
    assert.ok(calls.some((call) => call.table === "copy_performance" && op(call, "delete")));
  });

  it("migration 207 is service-role only", () => {
    const sql = readFileSync("supabase/migrations/207_copy_performance.sql", "utf8");
    assert.match(sql, /create table if not exists copy_performance/);
    assert.match(sql, /primary key \(template_key, field, stage, voice, scope, scope_id\)/);
    assert.match(sql, /page_id\s+text/);
    assert.match(sql, /for select to authenticated using \(false\)/);
    assert.doesNotMatch(sql, /for (insert|update|delete)/);
    assert.doesNotMatch(sql, /using \(true\)/);
    assert.match(sql, /notify pgrst, 'reload schema';\s*$/);
  });
});

describe("cross-client reader", () => {
  it("requireOperator() is how a route gets a context", async () => {
    const { OperatorContext, displayClientName, requireOperator } = await import("../cross-client/index.ts");
    assert.equal(typeof requireOperator, "function");
    const ctx = OperatorContext.forAllowlistedUser(MATAS_USER_IDS[0]!);
    assert.equal(ctx.seesClientNames, true);
    assert.equal(displayClientName("Puzzle", false), "another client");
    assert.equal(displayClientName("Puzzle", true), "Puzzle");
    assert.throws(() => OperatorContext.forAllowlistedUser("someone-else"), /not an operator/);
  });

  it("hides an archived client's row and a line under the minimum", async () => {
    const { OperatorContext } = await import("../cross-client/index.ts");
    const { topTemplates } = await import("../cross-client/read.ts");
    const ctx = OperatorContext.forAllowlistedUser(MATAS_USER_IDS[0]!);
    const shown = {
      template_key: "see you",
      field: "body",
      stage: "ticket_sale",
      voice: "promoter",
      scope: "all",
      scope_id: "all",
      example_text: "See you",
      events_n: 2,
      ads_n: 4,
      spend: 200,
      results: 20,
      index_vs_event: 0.8,
      confidence: "ok",
      proven: true,
      client_ids: ["11111111-1111-1111-1111-111111111111"],
    };
    const { db } = fakeDb((call) => {
      if (call.table === "clients" && op(call, "eq")) return { data: [{ id: "archived-client" }], error: null };
      if (call.table === "clients") return { data: [{ id: shown.client_ids[0], name: "Puzzle" }], error: null };
      if (call.table === "copy_performance") {
        return {
          data: [
            shown,
            { ...shown, scope: "client", scope_id: "archived-client", client_ids: ["archived-client"] },
            { ...shown, template_key: "thin", events_n: 1, spend: 10, results: 1, index_vs_event: 0.5 },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const top = await topTemplates(ctx, { stage: "ticket_sale" }, db);
    assert.deepEqual(top.map((row) => row.template_key), ["see you"]);
    assert.equal(top[0]?.clients[0]?.name, "Puzzle");
  });
});
