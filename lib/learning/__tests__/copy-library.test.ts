import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { MATAS_USER_IDS } from "../../auth/operator-allowlist.ts";
import { computeCopyPerformance, writeCopyPerformance } from "../copy-performance.ts";
import { dropUnsupportedClaims, emptyDictionaries, normaliseCopy, voiceOf } from "../copy/normalise.ts";
import { COPY_SHRINK_K, passesCopyMinimum, scoreTemplates, shrinkTowardOne, type ScoreAd } from "../copy/score.ts";

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
    assert.equal(voiceOf("11111_222", ["11111"], []), "promoter");
    assert.equal(voiceOf("33333_222", ["11111"], ["33333"]), "artist");
    assert.equal(voiceOf("99999_222", ["11111"], ["33333"]), "unknown");
    assert.equal(voiceOf(null, ["11111"], []), "unknown");
    const line = normaliseCopy("See you soon! 🔥", emptyDictionaries());
    assert.equal(line?.key, "see you soon");
  });
});

function ad(overrides: Partial<ScoreAd> & Pick<ScoreAd, "metaAdId" | "eventId" | "spend" | "results">): ScoreAd {
  return {
    clientId: "client-a",
    vertical: "music",
    stage: "ticket_sale",
    voice: "promoter",
    lines: [{ field: "body", key: "see you in {city}", text: "See you in London" }],
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
    const all = rows.find((row) => row.scope === "all" && row.template_key === "see you in {city}")!;
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
    assert.equal(all.example_text, "See you in London");

    const oneEvent = scoreTemplates([
      ad({ metaAdId: "b1", eventId: "e1", spend: 200, results: 10 }),
      ad({ metaAdId: "b2", eventId: "e1", spend: 200, results: 10 }),
      ad({ metaAdId: "b3", eventId: "e1", spend: 200, results: 10 }),
    ]);
    assert.equal(oneEvent.find((row) => row.scope === "all")!.events_n, 1);
    assert.equal(oneEvent.find((row) => row.scope === "all")!.ads_n, 3);
    assert.equal(oneEvent.find((row) => row.scope === "all")!.proven, false);

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
