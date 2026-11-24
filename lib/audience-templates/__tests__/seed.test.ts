/**
 * The seed planner (brief R6, record RC5): shows from the genre family and the
 * brief, pages from those shows' groups (no venue pages, "less disco",
 * crossover and the brief's named pages kept), interests by shows and
 * evidence, lists and pools by role. Genre keys are the code's.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GENRE_POOL_KEYS } from "../../learning/genre/families.ts";
import { TEMPLATE_DEFS, findPageByName, planTemplates, showName, type SeedDraft, type SeedEvent } from "../seed.ts";
import { TEMPLATE_NAMES } from "../words.ts";

const ev = (id: string, code: string, name: string, genreFamily: string | null = null): SeedEvent => ({ id, code, name, genreFamily });
const draft = (eventId: string, pageGroups: unknown[], interestGroups: unknown[] = []): SeedDraft => ({
  eventId,
  status: "published",
  audiences: { pageGroups, interestGroups },
});

const EVENTS: SeedEvent[] = [
  ev("e1", "NX26-LOCKLEAD", "Locklead"),
  ev("e2", "NX26-FOLAMOUR", "Folamour"),
  ev("e3", "NX27-SILVABUMPA", "Silva Bumpa"),
  ev("e4", "NX26-RUDIMENTAL", "Rudimental"),
  ev("e5", "NX26-AZYR", "AZYR b2b Partiboi69"),
  ev("e6", "ES27-DAVEPEARCE", "Dave Pearce: Trance Anthems Day Party"),
  ev("e7", "NX26-NEW", "New House Show", "disco"),
];

const DRAFTS: SeedDraft[] = [
  draft(
    "e1",
    [
      { name: "Venue", pageIds: ["900"] },
      { name: "Tech House Pages", pageIds: ["101", "102"] },
      { name: "Lineup", pageIds: ["900", "103"] },
    ],
    [{ name: "Music", interests: [{ id: "i1", name: "House music" }, { id: "i2", name: "Disco" }] }],
  ),
  draft("e2", [{ name: "Disco Pages", pageIds: ["201", "101"] }], [{ name: "Music", interests: [{ id: "i1", name: "House music" }, { id: "i3", name: "Only once" }] }]),
  draft("e3", [{ name: "Disco Pages", pageIds: ["201"] }, { name: "Tech House Pages", pageIds: ["101"] }]),
  draft("e4", [{ name: "DnB", pageIds: ["401", "402"] }]),
  draft("e6", [{ name: "Techno Pages", pageIds: ["601"] }]),
];

const NAMES = { "101": "Sam Divine", "102": "Gaskin", "103": "Locklead", "201": "Glitterbox", "401": "Pendulum", "402": "Andy C", "601": "Paul Van Dyk", "700": "Mall Grab / Jordon Alexander", "900": "NX LOVES" };

const plan = () =>
  planTemplates({
    clientId: "c",
    businessId: "1927009767586803",
    events: EVENTS,
    drafts: DRAFTS,
    pageNames: NAMES,
    clusters: [{ name: "Disc Genre", interestIds: ["i2"], cprIndex: 0.65, confidence: "strong" }],
  });

describe("planTemplates", () => {
  it("proposes the record's four templates with the code's genre keys", () => {
    const p = plan();
    assert.deepEqual(p.map((x) => x.template.name), TEMPLATE_NAMES);
    assert.deepEqual(p.map((x) => x.template.genreFamilies), [
      ["house_tech", "disco"],
      ["garage_bass", "house_tech"],
      ["techno", "hard_techno", "melodic_prog"],
      ["commercial", "house_tech", "disco"],
    ]);
    for (const d of TEMPLATE_DEFS) for (const k of d.families) assert.ok(GENRE_POOL_KEYS.includes(k), k);
    for (const d of TEMPLATE_DEFS) for (const l of d.lists) assert.ok(GENRE_POOL_KEYS.includes(l.family), l.family);
  });

  it("takes shows from the genre family first, then the brief's, and names the missing ones", () => {
    const house = plan()[0]!;
    assert.deepEqual(house.shows.map((s) => `${s.code}:${s.source}`), ["NX26-NEW:genre", "NX26-LOCKLEAD:brief", "NX26-FOLAMOUR:brief"]);
    assert.deepEqual(house.missingShows, ["NX27-EWANMCVICAR", "NX26-ROBBIEDOHERTY", "NX27-JULIANFIJMA"]);
  });

  it("leaves venue pages out, even inside a Lineup group, and ranks by shows", () => {
    const house = plan()[0]!;
    const ids = house.pages.map((p) => p.pageId);
    assert.ok(!ids.includes("900"));
    assert.equal(ids[0], "101", "Sam Divine: two shows");
    assert.deepEqual(house.pages.find((p) => p.pageId === "101")!.shows, ["NX26-LOCKLEAD", "NX26-FOLAMOUR"]);
  });

  it("House & garage: less disco, crossover D&B and techno, the brief's pages by name", () => {
    const garage = plan()[1]!;
    const ids = garage.pages.map((p) => p.pageId);
    assert.ok(!ids.includes("201"), "Disco Pages left out");
    assert.ok(ids.includes("101"));
    assert.ok(ids.includes("401") && ids.includes("601"), "crossover groups from any show");
    assert.ok(ids.includes("700"), "Mall Grab, by name");
    assert.equal(garage.pages[0]!.pageId, "700", "the brief's pages first");
    assert.deepEqual(garage.missingPages, ["HAAI"]);
  });

  it("Techno: Paul van Dyk / Dave Pearce pages by name; a missing one is reported", () => {
    const techno = plan()[2]!;
    assert.ok(techno.pages.some((p) => p.pageId === "601" && p.why === "brief"));
    assert.deepEqual(techno.missingPages, ["Dave Pearce"]);
    assert.equal(techno.template.items.find((i) => i.kind === "customer_list")!.familyKey, "techno");
  });

  it("Commercial house carries the commercial D&B pages", () => {
    const commercial = plan()[3]!;
    assert.ok(commercial.pages.some((p) => p.pageId === "401" && p.why === "crossover"));
  });

  it("interests need two shows, and evidence ranks first", () => {
    const house = plan()[0]!;
    assert.deepEqual(house.interests.map((i) => i.name), ["House music"]);
    const single = planTemplates({ clientId: "c", businessId: "b", events: [ev("e1", "NX26-LOCKLEAD", "Locklead")], drafts: DRAFTS, pageNames: NAMES, clusters: [{ name: "Disc Genre", interestIds: ["i2"], cprIndex: 0.65, confidence: "strong" }] })[0]!;
    assert.deepEqual(single.interests.map((i) => i.name), ["Disco", "House music"], "one show with drafts: every interest, evidence first");
    assert.deepEqual(single.interests[0]!.evidence, { cluster: "Disc Genre", cprIndex: 0.65, confidence: "strong" });
  });

  it("every template holds the three retargeting pools and its lists by role", () => {
    for (const p of plan()) {
      const pools = p.template.items.filter((i) => i.kind === "retargeting_pool").map((i) => `${i.listRole}:${i.retentionDays}`);
      assert.deepEqual(pools, ["page_views:30", "signups:180", "video_viewers:60"]);
      assert.ok(p.template.items.some((i) => i.kind === "customer_list" && i.listRole === "buyers"));
      assert.equal(p.template.confirmedBy, null, "the seed never confirms: Matas does");
    }
    assert.deepEqual(plan()[0]!.template.items.filter((i) => i.kind === "customer_list").map((i) => i.detail.name), ["Tech house buyers", "Disco buyers"]);
  });
});

describe("helpers", () => {
  it("finds a page by name, ignoring case and spacing and the part after a slash", () => {
    assert.equal(findPageByName("Mall Grab", NAMES), "700");
    assert.equal(findPageByName("paul van dyk", NAMES), "601");
    assert.equal(findPageByName("HAAI", NAMES), null);
  });
  it("a show's name for the header", () => {
    assert.equal(showName("AZYR b2b Partiboi69"), "AZYR");
    assert.equal(showName("Dave Pearce: Trance Anthems Day Party"), "Dave Pearce");
    assert.equal(showName("Mall Grab - Sheffield"), "Mall Grab");
    assert.equal(showName("D.O.D"), "D.O.D");
  });
});
