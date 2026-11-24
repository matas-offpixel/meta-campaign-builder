import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planVenueSeed, type SeedAdSet, type SeedEvent } from "../venue-seed.ts";

const ev = (id: string, code: string, venue: string, extra: Partial<SeedEvent> = {}): SeedEvent => ({
  id,
  user_id: "matas",
  event_code: code,
  venue_name: venue,
  venue_city: null,
  venue_id: null,
  event_date: "2027-02-01",
  meta_ad_account_id: null,
  ...extra,
});

const set = (id: string, event: string, account: string, pixel: string | null, spend: number): SeedAdSet => ({
  meta_adset_id: id,
  event_id: event,
  ad_account_id: account,
  pixel_id: pixel,
  spend,
});

describe("planVenueSeed", () => {
  const events = [
    ev("nx1", "NX26-DOD", "NX Newcastle", { venue_city: "Newcastle upon Tyne" }),
    ev("nx2", "NX27-GLITTERBOX", "NX NEWCASTLE"),
    ev("es1", "ES27-LPRHYTHM", "Electric Studios", { venue_city: "Sheffield" }),
    ev("es2", "ES27-DAVEPEARCE", "Electric Studios"),
    ev("es3", "ES26-GDS", "Electric Studios", { event_date: "2026-10-31" }),
  ];
  const adSets = [
    set("a1", "nx1", "act_606252931141334", "645185673672763", 900),
    set("a2", "nx1", "606252931141334", "1283861880364565", 5),
    set("a3", "nx2", "act_2011069725849568", "800268622344093", 20),
    set("b1", "es1", "act_1073273492854557", "2261755947685271", 400),
    set("b2", "es2", "act_1073273492854557", "1987031252241238", 50),
    set("b3", "es3", "act_1073273492854557", "1987031252241238", 30),
  ];
  const plan = planVenueSeed({ clientId: "electric", events, adSets, today: "2026-11-24" });

  it("groups events by venue key and takes the most-spent account, then its most-spent pixel", () => {
    const nx = plan.venues.find((v) => v.key === "nx newcastle")!;
    assert.equal(nx.events, 2);
    assert.equal(nx.name, "NX Newcastle");
    assert.equal(nx.city, "Newcastle upon Tyne");
    assert.equal(nx.account?.value, "act_606252931141334");
    assert.equal(nx.account?.adSets, 2);
    assert.equal(nx.pixel?.value, "645185673672763");
    // The Bristol account's £20 is under 10 % of £905: not named.
    assert.deepEqual(nx.accountOthers, []);
    assert.deepEqual(nx.eventsToLink, ["nx1", "nx2"]);
  });

  it("proposes an override for an upcoming event on another pixel, never a past one", () => {
    assert.deepEqual(
      plan.overrides.map((o) => [o.code, o.pixel, o.source]),
      [["ES27-DAVEPEARCE", "1987031252241238", "launched_ad_sets"]],
    );
  });

  it("has no values for a venue with no launched ad sets", () => {
    const quiet = planVenueSeed({ clientId: "c", events: [ev("x", "EBX27-X", "Electric Brixton")], adSets: [], today: "2026-11-24" });
    assert.equal(quiet.venues[0]!.account, null);
    assert.equal(quiet.venues[0]!.pixel, null);
  });

  it("takes an event's latest draft pixel when it has no launched ad sets", () => {
    const p = planVenueSeed({
      clientId: "c",
      events: [ev("es1", "ES27-LPRHYTHM", "Electric Studios"), ev("es2", "ES27-DAVEPEARCE", "Electric Studios")],
      adSets: [set("b1", "es1", "act_1073273492854557", "2261755947685271", 400)],
      draftPixelByEvent: { es2: "1987031252241238" },
      today: "2026-11-24",
    });
    assert.deepEqual(p.overrides.map((o) => [o.code, o.source]), [["ES27-DAVEPEARCE", "draft"]]);
  });
});
