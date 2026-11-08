import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { MATAS_USER_IDS } from "../../auth/operator-allowlist.ts";
import { computeCopyFeatures, featureAds, summariseCopyFeatures, writeCopyFeatures, type CopyFeatureRow } from "../copy-features.ts";
import {
  COPY_FEATURES,
  COPY_FEATURE_VALUES,
  copyFeatures,
  ctaKindOf,
  emojiCountBandOf,
  featureKey,
  featuresOf,
  hasLineupList,
  lengthBandOf,
  lineCountBandOf,
  openerOf,
  parseFeatureKey,
  scarcityKindOf,
} from "../copy/features.ts";
import { emptyDictionaries } from "../copy/normalise.ts";
import { COPY_SHRINK_K, scoreTemplates, shrinkTowardOne, type ScoreAd } from "../copy/score.ts";

register(new URL("../../__tests__/support/alias-hooks.mjs", import.meta.url));

const NX = emptyDictionaries({
  lineup: ["Saoirse", "Jamback", "Job de Jong"],
  venueName: "NX Newcastle",
  venueCity: "Newcastle",
  eventName: "Modern Funktion",
  clientName: "Electric Brixton",
  globalCities: ["Newcastle", "Sheffield"],
});

describe("copy features: every value is a label from a fixed list", () => {
  it("opener", () => {
    assert.equal(openerOf("Who's on your list this season?", "whos on your list this season"), "question");
    assert.equal(openerOf("Saoirse joins our stacked line-up.", "{artist} joins our stacked line-up"), "name_first");
    assert.equal(openerOf("Newcastle! Excited to be back.", "{city} excited to be back"), "name_first");
    assert.equal(openerOf("5 shows. 4 sold out already.", "5 shows 4 sold out already"), "number_first");
    assert.equal(openerOf("Friday 6th November - the biggest disco night", "{date} the biggest disco night"), "number_first");
    assert.equal(openerOf("Join us for our new London headline show.", "join us for our new {city} headline show"), "imperative");
    assert.equal(openerOf("🏭 Sign up for presale access", "sign up for presale access"), "imperative");
    assert.equal(openerOf("A new season has begun ❤️‍🔥", "a new season has begun"), "statement");
    assert.equal(openerOf("Tickets are now on sale for my headline show", "tickets are now on sale for my headline show"), "statement");
  });

  it("cta_kind, with tag > bio > sign up > book", () => {
    assert.equal(ctaKindOf("Tag the 3 friends you'd bring with you. Sign up now."), "tag_a_mate");
    assert.equal(ctaKindOf("Sign up via the link in our bio for access"), "link_in_bio");
    assert.equal(ctaKindOf("Sign up for exclusive presale access."), "sign_up");
    assert.equal(ctaKindOf("Sign-up for presale ticket access."), "sign_up");
    assert.equal(ctaKindOf("Final tickets on sale now."), "book_now");
    assert.equal(ctaKindOf("Grab your tickets before they go."), "book_now");
    assert.equal(ctaKindOf("A new season has begun in the heart of the city."), "none");
  });

  it("scarcity_kind, with roll call > percent > final > price > countdown", () => {
    assert.equal(scarcityKindOf("IRONWORKS OPENING SEASON. 5 shows. 4 sold out already. Final tickets."), "sold_out_rollcall");
    assert.equal(scarcityKindOf("Last 3 shows sold out, this one will be the same."), "sold_out_rollcall");
    assert.equal(scarcityKindOf("80% sold. Final tickets."), "pct_sold");
    assert.equal(scarcityKindOf("Final 50 tickets. Expected to sell out before the weekend."), "final_x");
    assert.equal(scarcityKindOf("Tickets running low."), "final_x");
    assert.equal(scarcityKindOf("Limited £16.50 early bird tickets available this bank holiday weekend"), "price_rise");
    assert.equal(scarcityKindOf("Price move Friday. Grab them before they go up!"), "price_rise");
    assert.equal(scarcityKindOf("This Saturday: Puzzle Open Air."), "countdown");
    assert.equal(scarcityKindOf("Tickets go live Wednesday 23rd September. Sign up."), "none");
  });

  it("length, emoji and line bands", () => {
    assert.equal(lengthBandOf("Who's in?"), "le_60");
    assert.equal(lengthBandOf("x".repeat(61)), "61_120");
    assert.equal(lengthBandOf("x".repeat(120)), "61_120");
    assert.equal(lengthBandOf("x".repeat(121)), "121_200");
    assert.equal(lengthBandOf("x".repeat(201)), "gt_200");
    assert.equal(emojiCountBandOf("See you there"), "0");
    assert.equal(emojiCountBandOf("☀️🌊 Puzzle Open Air"), "1_2");
    assert.equal(emojiCountBandOf("☀️🌊 Puzzle Open Air 🚨"), "3_plus");
    assert.equal(lineCountBandOf("one line"), "1");
    assert.equal(lineCountBandOf("one\n\ntwo"), "2_3");
    assert.equal(lineCountBandOf("1\n2\n3\n4"), "4_plus");
  });

  it("lineup list, date and price read the normalised key; a comma list of names counts too", () => {
    assert.equal(hasLineupList("Saoirse and Jamback", "{artist} and {artist}"), true);
    assert.equal(hasLineupList("Dan Shake, Horse Meat Disco, MiNNA, Theon Bower and more", "dan shake horse meat disco minna theon bower and more"), true);
    assert.equal(hasLineupList("Saoirse joins the bill", "{artist} joins the bill"), false);
    const features = featuresOf("Saoirse, Jamback and Job de Jong join us on Friday 16th October. Tickets £12.50.", NX)!;
    assert.equal(features.has_lineup_list, "yes");
    assert.equal(features.has_date, "yes");
    assert.equal(features.has_price, "yes");
    assert.equal(features.opener, "name_first");
    assert.equal(featuresOf("   ", NX), null);
  });

  it("every value is in its list and the key round-trips", () => {
    const features = copyFeatures("Who's in? Tag a mate. Final 50 tickets 🚨", "whos in tag a mate {final_tickets}");
    for (const feature of COPY_FEATURES) {
      assert.ok((COPY_FEATURE_VALUES[feature] as readonly string[]).includes(features[feature]), `${feature}=${features[feature]}`);
      assert.deepEqual(parseFeatureKey(featureKey(feature, features[feature])), { feature, value: features[feature] });
    }
    assert.equal(parseFeatureKey("see you down in {city}"), null);
    assert.equal(parseFeatureKey("opener=shouting"), null);
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

describe("copy_features scoring", () => {
  const library = {
    droppedNameOnly: 0,
    ads: [
      // Show e1: a question line (one ad) and a statement line (one ad); e2: a question line.
      ad({ metaAdId: "a1", eventId: "e1", spend: 500, results: 20, lines: [{ field: "body", key: "whos in", text: "Who's in?" }] }),
      ad({ metaAdId: "a2", eventId: "e1", spend: 500, results: 20, lines: [{ field: "body", key: "see you down in {city} tickets on sale now", text: "See you down in London. Tickets on sale now." }] }),
      ad({ metaAdId: "a3", eventId: "e2", clientId: "client-b", spend: 200, results: 10, lines: [{ field: "body", key: "which show are you coming to", text: "Which show are you coming to?" }] }),
    ],
  };

  it("re-keys every line to one key per feature, keeps the one-word keys the template scorer drops", () => {
    const keyed = featureAds(library);
    assert.equal(keyed[0]!.lines.length, COPY_FEATURES.length);
    assert.ok(keyed[0]!.lines.some((line) => line.key === "opener=question"));
    assert.ok(keyed[1]!.lines.some((line) => line.key === "cta_kind=book_now"));
    assert.equal(scoreTemplates(keyed).length, 0, "the default scorer drops one-word keys");
  });

  it("the same maths as copy_performance: event baseline, n = shows, shrink k = 2, proven at 2 shows and ≤ 0.9", () => {
    const rows = computeCopyFeatures(library);
    const question = rows.find((row) => row.scope === "all" && row.feature === "opener" && row.value === "question")!;
    assert.equal(question.events_n, 2);
    assert.equal(question.ads_n, 2);
    assert.deepEqual(question.client_ids, ["client-a", "client-b"]);
    assert.equal(question.field, "body");
    assert.equal(question.stage, "ticket_sale");
    // e1: £1000 / 40 = £25 per result → a1 expected 20. e2 has 10 results: £20 → a3 expected 10. Index 30/30 = 1.
    assert.equal(question.index_vs_event, Math.round(shrinkTowardOne(2, 1, COPY_SHRINK_K) * 10000) / 10000);
    assert.equal(question.proven, false);
    const statement = rows.find((row) => row.scope === "all" && row.feature === "opener" && row.value === "statement")!;
    assert.equal(statement.events_n, 1);
    assert.equal(statement.proven, false);
    // client-a: "Who's in?" has no call to action; "Tickets on sale now" books.
    const clientA = rows.find((row) => row.scope === "client" && row.scope_id === "client-a" && row.feature === "cta_kind" && row.value === "none")!;
    assert.equal(clientA.ads_n, 1);
    assert.equal(rows.find((row) => row.scope === "client" && row.scope_id === "client-a" && row.feature === "cta_kind" && row.value === "book_now")!.ads_n, 1);
    assert.ok(rows.every((row) => COPY_FEATURES.includes(row.feature)));
    assert.ok(rows.every((row) => (COPY_FEATURE_VALUES[row.feature] as readonly string[]).includes(row.value)));
    const summary = summariseCopyFeatures(rows);
    assert.equal(summary.scopes.all, rows.filter((row) => row.scope === "all").length);
    assert.equal(summary.perFeature.opener, 2);
    assert.equal(summary.recurring, rows.filter((row) => row.scope === "all" && row.events_n >= 2).length);
    assert.equal(summary.proven, 0);
  });

  it("writes in chunks on the seven-column key and deletes stale rows", async () => {
    const rows = computeCopyFeatures(library);
    const { db, calls } = fakeDb(() => ({ error: null, count: 3 }));
    const written = await writeCopyFeatures(db, rows, "2026-11-09T03:30:00.000Z");
    assert.equal(written.written, rows.length);
    assert.equal(written.deleted, 3);
    const upsert = calls.find((call) => call.table === "copy_features" && op(call, "upsert"))!;
    assert.deepEqual(op(upsert, "upsert")![1], { onConflict: "feature,value,field,stage,voice,scope,scope_id" });
    const first = (op(upsert, "upsert")![0] as Record<string, unknown>[])[0]!;
    assert.equal(first.updated_at, "2026-11-09T03:30:00.000Z");
    assert.ok(!("example_text" in first) && !("template_key" in first));
    const stale = calls.find((call) => call.table === "copy_features" && op(call, "delete"))!;
    assert.deepEqual(op(stale, "lt"), ["updated_at", "2026-11-09T03:30:00.000Z"]);
    const none = await writeCopyFeatures(db, [], "2026-11-09T03:30:00.000Z");
    assert.deepEqual(none, { written: 0, deleted: 0 });
  });
});

describe("copy_features reader and migration", () => {
  it("requireOperator() gates the reader like topTemplates: the reader is exported next to it", async () => {
    const { requireOperator, topCopyFeatures } = await import("../cross-client/index.ts");
    assert.equal(typeof requireOperator, "function");
    assert.equal(typeof topCopyFeatures, "function");
  });

  it("topCopyFeatures: one scope + stage, minimum-passing rows, archived clients out, names for Matas", async () => {
    const { OperatorContext } = await import("../cross-client/context.ts");
    const { topCopyFeatures } = await import("../cross-client/read.ts");
    const ctx = OperatorContext.forAllowlistedUser(MATAS_USER_IDS[0]!);
    const shown: CopyFeatureRow = {
      feature: "cta_kind",
      value: "sign_up",
      field: "body",
      stage: "registration",
      voice: "promoter",
      scope: "all",
      scope_id: "all",
      events_n: 3,
      ads_n: 40,
      spend: 900,
      results: 60,
      index_vs_event: 0.85,
      confidence: "ok",
      proven: true,
      client_ids: ["11111111-1111-1111-1111-111111111111"],
    };
    const { db, calls } = fakeDb((call) => {
      if (call.table === "clients" && op(call, "eq")) return { data: [{ id: "archived-client" }], error: null };
      if (call.table === "clients") return { data: [{ id: shown.client_ids[0], name: "Puzzle" }], error: null };
      if (call.table === "copy_features") {
        return {
          data: [
            { ...shown, value: "book_now", index_vs_event: 1.1, proven: false },
            shown,
            { ...shown, scope: "client", scope_id: "archived-client", client_ids: ["archived-client"] },
            { ...shown, value: "tag_a_mate", events_n: 1, spend: 10, results: 1, index_vs_event: 0.5 },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const top = await topCopyFeatures(ctx, { stage: "registration", voice: "promoter" }, db);
    assert.deepEqual(top.map((row) => `${row.feature}=${row.value}`), ["cta_kind=sign_up", "cta_kind=book_now"]);
    assert.equal(top[0]?.clients[0]?.name, "Puzzle");
    const read = calls.find((call) => call.table === "copy_features")!;
    assert.deepEqual(op(read, "order"), ["index_vs_event", { ascending: true }]);
    assert.ok(read.ops.some(([name, args]) => name === "eq" && args[0] === "voice" && args[1] === "promoter"));
  });

  it("migration 213: the seven-column key, every feature in the CHECK, 207's RLS pattern, no example text", () => {
    const sql = readFileSync("supabase/migrations/213_copy_features.sql", "utf8");
    assert.match(sql, /create table if not exists copy_features/);
    for (const feature of COPY_FEATURES) assert.ok(sql.includes(`'${feature}'`), feature);
    assert.match(sql, /primary key \(feature, value, field, stage, voice, scope, scope_id\)/);
    assert.match(sql, /"copy_features no authenticated read"/);
    assert.match(sql, /for select to authenticated using \(false\)/);
    assert.doesNotMatch(sql, /example_text/);
    assert.match(sql, /events_n\s+integer not null/);
    assert.match(sql, /proven\s+boolean not null/);
    const runner = readFileSync("lib/learning/runner.ts", "utf8");
    assert.ok(runner.indexOf('job("copy_performance"') < runner.indexOf('job("copy_features"'), "features run after the templates");
    assert.match(readFileSync("lib/learning/cross-client/index.ts", "utf8"), /topCopyFeatures/);
  });
});
