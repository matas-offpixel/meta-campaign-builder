import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currencyResolver } from "../currency.ts";
import {
  buildTagIndex,
  interestKeyOf,
  joinAdDay,
  joinRates,
  objectiveStage,
  resultOf,
  resultStageByAd,
  resultTypeStage,
  stageOf,
  tagsForAd,
} from "../joins.ts";
import { adDay, joinContext } from "./fixtures.ts";

describe("learning joins: ad-day → client / event", () => {
  const ctx = joinContext();

  it("launched_ads first", () => {
    const f = joinAdDay(adDay({ meta_ad_id: "ad-launched", meta_adset_id: "adset-b", campaign_name: "[CODE-C]" }), ctx);
    assert.deepEqual([f.clientId, f.eventId, f.contextSource], ["client-a", "event-a", "launched_ads"]);
  });

  it("then launched_ad_sets; an event with no client on the ledger takes the event's client", () => {
    const f = joinAdDay(adDay({ meta_ad_id: "ad-x", meta_adset_id: "adset-b", campaign_name: "[CODE-C]" }), ctx);
    assert.deepEqual([f.clientId, f.eventId, f.contextSource], ["client-b", "event-b", "launched_ad_sets"]);
  });

  it("then [EVENT_CODE] in campaign_name; nothing matched → no client", () => {
    const coded = joinAdDay(adDay({ meta_ad_id: "ad-y", campaign_name: "[CODE-C] Presale" }), ctx);
    assert.deepEqual([coded.clientId, coded.eventId, coded.contextSource], ["client-a", "event-c", "campaign_code"]);
    const none = joinAdDay(adDay({ meta_ad_id: "ad-z", campaign_name: "No code" }), ctx);
    assert.deepEqual([none.clientId, none.eventId, none.contextSource], [null, null, null]);
  });
});

describe("learning joins: ad-day → tags", () => {
  const index = buildTagIndex(
    [
      { event_id: "event-a", creative_name: "Motion 1", tag_id: "t-motion", meta_ad_id: null },
      { event_id: "event-a", creative_name: "Still 1", tag_id: "t-still", meta_ad_id: "ad-by-id" },
      { event_id: "event-a", creative_name: "Old", tag_id: "t-unknown", meta_ad_id: null },
    ],
    new Set(["t-motion", "t-still"]),
  );

  it("by meta_ad_id when an assignment carries the ad's id, whatever the ad's name", () => {
    assert.deepEqual(tagsForAd("ad-by-id", "event-a", "Motion 1", index), { tagIds: ["t-still"], via: "meta_ad_id" });
  });

  it("else by (event_id, creative_name = ad_name); another event's name does not match", () => {
    assert.deepEqual(tagsForAd("ad-other", "event-a", " Motion 1 ", index), { tagIds: ["t-motion"], via: "name" });
    assert.deepEqual(tagsForAd("ad-other", "event-b", "Motion 1", index), { tagIds: [], via: null });
    assert.deepEqual(tagsForAd("ad-other", null, "Motion 1", index), { tagIds: [], via: null });
  });

  it("assignments to tags outside the taxonomy are ignored", () => {
    assert.deepEqual(tagsForAd("ad-other", "event-a", "Old", index), { tagIds: [], via: null });
  });

  it("join rate = tagged ad-days ÷ ad-days per client", () => {
    const ctx = joinContext({
      assignments: [{ event_id: "event-a", creative_name: "Motion 1", tag_id: "t-motion", meta_ad_id: null }],
    });
    const facts = [
      joinAdDay(adDay({ meta_ad_id: "ad-launched", ad_name: "Motion 1" }), ctx),
      joinAdDay(adDay({ meta_ad_id: "ad-launched", ad_name: "Motion 1", date: "2026-10-02" }), ctx),
      joinAdDay(adDay({ meta_ad_id: "ad-y", ad_name: "Untagged", campaign_name: "[CODE-C]" }), ctx),
    ];
    assert.deepEqual(joinRates(facts).get("client-a"), { adDays: 3, tagged: 2, byAdId: 0, byName: 2, rate: 2 / 3 });
  });
});

describe("learning joins: stage", () => {
  const st = (...args: Parameters<typeof stageOf>) => {
    const { stage, source } = stageOf(...args);
    return `${stage}/${source}`;
  };

  it("before general sale is registration; the general sale day and after is ticket_sale", () => {
    const event = { clientId: "c", generalSaleAt: "2026-10-03T09:00:00Z", presaleAt: "2026-09-30T09:00:00Z" };
    assert.equal(st("2026-10-02", event, "on_sale", "ticket_sale"), "registration/event_dates");
    assert.equal(st("2026-10-03", event, null), "ticket_sale/event_dates");
  });

  it("presale is the boundary when there is no general sale date", () => {
    const event = { clientId: "c", generalSaleAt: null, presaleAt: "2026-10-02T09:00:00Z" };
    assert.equal(st("2026-10-01", event, null), "registration/event_dates");
    assert.equal(st("2026-10-02", event, null), "ticket_sale/event_dates");
  });

  it("no dates → phase_at_launch, then objective, else unknown", () => {
    const undated = { clientId: "c", generalSaleAt: null, presaleAt: null };
    assert.equal(st("2026-10-01", undated, "presale"), "registration/phase_at_launch");
    assert.equal(st("2026-10-01", undated, "waiting_list"), "registration/phase_at_launch");
    assert.equal(st("2026-10-01", undated, "on_sale", "registration"), "ticket_sale/phase_at_launch");
    assert.equal(st("2026-10-01", undated, null, "registration"), "registration/objective");
    assert.equal(st("2026-10-01", null, null, "ticket_sale"), "ticket_sale/objective");
    assert.equal(st("2026-10-01", undated, null), "unknown/unknown");
    assert.equal(st("2026-10-01", null, null, null), "unknown/unknown");
  });

  it("objective: registration / lead → registration, purchase → ticket_sale, anything else nothing", () => {
    assert.equal(objectiveStage("registration"), "registration");
    assert.equal(objectiveStage("LEAD"), "registration");
    assert.equal(objectiveStage("purchase"), "ticket_sale");
    for (const o of ["traffic", "awareness", "initiate_checkout", "engagement", "", null]) assert.equal(objectiveStage(o), null);
  });

  it("result type: registration and lead pixel types → registration, purchase → ticket_sale", () => {
    assert.equal(resultTypeStage("offsite_conversion.fb_pixel_complete_registration"), "registration");
    assert.equal(resultTypeStage("complete_registration"), "registration");
    assert.equal(resultTypeStage("offsite_conversion.fb_pixel_lead"), "registration");
    assert.equal(resultTypeStage("lead"), "registration");
    assert.equal(resultTypeStage("offsite_conversion.fb_pixel_purchase"), "ticket_sale");
    assert.equal(resultTypeStage("landing_page_view"), null);
    assert.equal(resultTypeStage(null), null);
  });

  it("result type is read per ad: the stage most result days carry, none on a tie or with no result day", () => {
    const reg = "offsite_conversion.fb_pixel_complete_registration";
    const buy = "offsite_conversion.fb_pixel_purchase";
    const map = resultStageByAd([
      { meta_ad_id: "r", result_action_type: reg },
      { meta_ad_id: "r", result_action_type: reg },
      { meta_ad_id: "r", result_action_type: buy },
      { meta_ad_id: "r", result_action_type: null },
      { meta_ad_id: "p", result_action_type: buy },
      { meta_ad_id: "tie", result_action_type: reg },
      { meta_ad_id: "tie", result_action_type: buy },
      { meta_ad_id: "none", result_action_type: null },
    ]);
    assert.deepEqual(Object.fromEntries(map), { r: "registration", p: "ticket_sale" });
  });

  it("joinAdDay reads the ad set's phase when the event has no dates; unknown is kept with no result", () => {
    const ctx = joinContext();
    const phased = joinAdDay(adDay({ meta_ad_id: "ad-y", meta_adset_id: "adset-phase", campaign_name: "[CODE-C]", purchases: 2 }), ctx);
    assert.deepEqual([phased.stage, phased.stageSource, phased.result], ["ticket_sale", "phase_at_launch", 2]);
    const unknown = joinAdDay(adDay({ meta_ad_id: "ad-y", campaign_name: "[CODE-C]", registrations: 5 }), ctx);
    assert.deepEqual([unknown.stage, unknown.stageSource, unknown.result], ["unknown", "unknown", null]);
  });

  it("joinAdDay: the ad set's objective first, then the ad's result days; event dates still win", () => {
    const ctx = joinContext({
      adSetObjective: new Map([["adset-obj", "registration"]]),
      adResultStage: new Map([["ad-buys", "ticket_sale"]]),
    });
    const byObjective = joinAdDay(adDay({ meta_ad_id: "ad-buys", meta_adset_id: "adset-obj", campaign_name: "[CODE-C]", registrations: 4 }), ctx);
    assert.deepEqual([byObjective.stage, byObjective.stageSource, byObjective.result], ["registration", "objective", 4]);
    const byResult = joinAdDay(adDay({ meta_ad_id: "ad-buys", campaign_name: "[CODE-C]", purchases: 1 }), ctx);
    assert.deepEqual([byResult.stage, byResult.stageSource, byResult.result], ["ticket_sale", "objective", 1]);
    const dated = joinAdDay(adDay({ meta_ad_id: "ad-launched", meta_adset_id: "adset-obj" }), ctx);
    assert.equal(dated.stageSource, "event_dates");
  });

  it("result: registrations in registration, purchases in ticket_sale", () => {
    const row = { registrations: 7, purchases: 2 };
    assert.equal(resultOf("registration", row), 7);
    assert.equal(resultOf("ticket_sale", row), 2);
    assert.equal(resultOf("unknown", row), null);
  });
});

describe("learning joins: currency and interest keys", () => {
  it("spend converts to GBP: stored currency first, then the 2026-10-06 map; unknown accounts are GBP and reported", () => {
    const resolver = currencyResolver(new Map([["act_555", "EUR"]]));
    assert.equal(resolver.rate("act_555"), 0.848824);
    assert.equal(resolver.rate("968594768066330"), 0.753239);
    assert.equal(resolver.rate("act_1967530076312"), 1);
    assert.equal(resolver.rate("act_999"), 1);
    assert.deepEqual([...resolver.assumed], ["999"]);
    const f = joinAdDay(adDay({ meta_ad_id: "ad-launched", ad_account_id: "act_968594768066330", spend: 100 }), joinContext());
    assert.equal(f.spendGbp, 75.3239);
  });

  it("interest key: sorted, deduped ids from strings or {id} objects", () => {
    assert.equal(interestKeyOf(["2", "1", "2"]), "1,2");
    assert.equal(interestKeyOf([{ id: "2" }, { id: 1 }]), "1,2");
    assert.equal(interestKeyOf(null), "");
  });
});
