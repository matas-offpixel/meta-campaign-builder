/**
 * PR B of docs/design-record/2026-11-17-retargeting-campaign-2.html:
 * RT11 (today's share), RT13 (the show's links from CIRQLIN), RT14 (windows),
 * RT15 (registrations), RT16 (Live without arming), and migration 257.
 * Ops' ruling of 17 Nov on the link lines is held here too.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { fetchCirqlinPageLinks, type PartnerPageLinks } from "../../cirqlin/page-links.ts";
import { applyGates, retargetingGates } from "../../onsale-refresh/apply-gates.ts";
import { linkKey, perLinkAudiences, pixelRules, ruleChanges, tierSpecs, type SourceSet } from "../audiences.ts";
import { startingBudget } from "../budget.ts";
import { firedOn, isSharedHost, landingShared, linksFallback, linksFromPages, otherLandingHosts, pixelOnOwnDomains, pixelOnPlatforms, platformName, urlRule } from "../links.ts";
import { bottomSignals, planRetargeting, tierRows } from "../plan.ts";
import { comparesRules, showLinks } from "../runner.ts";
import { runInOn, shareOn } from "../shares.ts";
import * as words from "../words.ts";

/**
 * CIRQLIN's page-links body for CQ-robbiedoherty-newcastle, as ops gave it
 * (cirqlin#653, live 17 Nov): one page, landing_url
 * https://robbiedoherty-newcastle.com, ticket links skiddle (shown first),
 * ra, fatsoma, fixr, dice. The URLs, labels and shop names are the page's
 * own CTAs, read once from CIRQLIN (URLs only).
 */
const ROBBIE: { pages: PartnerPageLinks[] } = {
  pages: [
    {
      page_id: "0c8e8daa-b2e3-49c0-8804-9f1c3453ff3b",
      slug: "robbiedoherty-newcastle",
      crm_base_tag: "CQ-robbiedoherty-newcastle",
      title: "Robbie Doherty Newcastle",
      landing_url: "https://robbiedoherty-newcastle.com",
      ticket_links: [
        { platform: "skiddle", url: "https://www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Robbie-Doherty/42832766/", label: "SKIDDLE", shop_name: "SKIDDLE", shown_first: true },
        { platform: "ra", url: "https://ra.co/events/2556925", label: "RA", shop_name: "RA", shown_first: false },
        { platform: "fatsoma", url: "https://www.fatsoma.com/e/hv0nhal3/robbie-doherty", label: "FATSOMA", shop_name: "FATSOMA", shown_first: false },
        { platform: "fixr", url: "https://fixr.co/event/robbie-doherty-tickets-473098150", label: "FIXR", shop_name: "FIXR", shown_first: false },
        { platform: "dice", url: "https://dice.fm/event/l8p6pr-robbie-doherty-27th-nov-nx-newcastle-newcastle-upon-tyne-tickets", label: "DICE", shop_name: "DICE", shown_first: false },
      ],
    },
  ],
};

/** A tag that matches two pages: the event page and a crowd page on crqln.com (the crowd page's own outlets, one shared with the event page). */
const TWO_PAGES: PartnerPageLinks[] = [
  ROBBIE.pages[0]!,
  {
    page_id: "crowd-1",
    slug: "robbiedoherty-newcastle-crowd",
    crm_base_tag: "CQ-robbiedoherty-newcastle",
    title: "Robbie Doherty Newcastle crowd",
    landing_url: "https://crqln.com/robbiedoherty-newcastle-crowd",
    ticket_links: [
      { platform: "skiddle", url: "https://www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Robbie-Doherty/42832766/", label: "SKIDDLE", shop_name: "SKIDDLE", shown_first: true },
      { platform: "skiddle", url: "https://www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Robbie-Doherty-Crowd/42839999/", label: "Crowd tickets", shop_name: null, shown_first: false },
    ],
  },
];

const PAGES = TWO_PAGES;

/** A show that would be proposed (RB's figures), for the not-proposed sentences. */
const PROPOSABLE = {
  eventId: "e",
  eventCode: "RD",
  runDay: "2026-11-17",
  eventDate: "2026-12-18",
  onSaleDay: "2026-11-06",
  read: { state: "platform_under_bar", pixel: { id: "px", source: "ad_sets", spendShare: 1, stored: "px", matches: true }, pixelName: "NX", domain: null, onDomain: null, platform: "Skiddle" } as never,
  last7SpendGbp: 406,
  minDailyMinor: 100,
  sources: { pixelId: "px", links: linksFromPages(ROBBIE.pages), videos: [], pages: [], lists: [] } as SourceSet,
  existing: null,
  legacy: [],
  budgetGbp: 4000,
  spendToDateGbp: 1500,
  committedGbp: 1000,
  main: null,
  ads: [{ adId: "a", name: "A" }],
  geoFromAdsetId: null,
  where: { draftId: "d", adAccountId: "act_1", campaignIds: ["c"] },
  linksRead: "ok" as const,
};

describe("RT13: the show's links from CIRQLIN", () => {
  it("Robbie Doherty: one page, five ticket links in order, Skiddle first, each one URL rule named by its host", () => {
    const links = linksFromPages(ROBBIE.pages);
    assert.deepEqual(
      links.map((link) => [link.kind, link.name, link.rule]),
      [
        ["ticket", "Skiddle", "www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Robbie-Doherty/42832766/"],
        ["ticket", "RA", "ra.co/events/2556925"],
        ["ticket", "Fatsoma", "www.fatsoma.com/e/hv0nhal3/robbie-doherty"],
        ["ticket", "Fixr", "fixr.co/event/robbie-doherty-tickets-473098150"],
        ["ticket", "DICE", "dice.fm/event/l8p6pr-robbie-doherty-27th-nov-nx-newcastle-newcastle-upon-tyne-tickets"],
        ["landing", "robbiedoherty-newcastle.com", "robbiedoherty-newcastle.com"],
      ],
    );
  });

  it("a tag with two pages: every page's landing_url and every ticket link is its own rule, one per distinct link", () => {
    const links = linksFromPages(TWO_PAGES);
    assert.deepEqual(
      links.map((link) => [link.kind, link.name]),
      [
        ["ticket", "Skiddle (SKIDDLE)"],
        ["ticket", "RA"],
        ["ticket", "Fatsoma"],
        ["ticket", "Fixr"],
        ["ticket", "DICE"],
        ["ticket", "Skiddle (Crowd tickets)"],
        ["landing", "robbiedoherty-newcastle.com"],
        ["landing", "crqln.com/robbiedoherty-newcastle-crowd"],
      ],
    );
    // Each link is one rule, and each is its own audience at its source's longest window.
    const specs = tierSpecs({ pixelId: "px", links, videos: [], pages: [], lists: [] });
    assert.deepEqual(perLinkAudiences(specs.find((spec) => spec.tier === "bottom")).map((row) => row.name), ["Skiddle (SKIDDLE)", "RA", "Fatsoma", "Fixr", "DICE", "Skiddle (Crowd tickets)"]);
    assert.deepEqual(perLinkAudiences(specs.find((spec) => spec.tier === "mid_bottom")).map((row) => row.name), ["robbiedoherty-newcastle.com", "crqln.com/robbiedoherty-newcastle-crowd"]);
  });

  it("two links on one platform are told apart by shop_name, else label", () => {
    const links = linksFromPages([
      {
        ...PAGES[0]!,
        ticket_links: [
          { platform: "skiddle", url: "https://www.skiddle.com/e/1", label: "Early bird", shop_name: null, shown_first: true },
          { platform: "skiddle", url: "https://www.skiddle.com/e/2", label: "Tickets", shop_name: "NX Shop", shown_first: false },
        ],
      },
    ]);
    assert.deepEqual(links.filter((link) => link.kind === "ticket").map((link) => link.name), ["Skiddle (Early bird)", "Skiddle (NX Shop)"]);
  });

  it("a ticket link is named by its host (RT18), else Other ({host})", () => {
    const named = (url: string) => linksFromPages([{ ...ROBBIE.pages[0]!, ticket_links: [{ platform: "other", url, label: "Tickets", shop_name: null, shown_first: true }] }])[0]!.name;
    assert.deepEqual(
      ["https://www.skiddle.com/e/1", "https://ra.co/events/1", "https://www.fatsoma.com/e/1", "https://fixr.co/event/1", "https://dice.fm/event/1", "https://www.eventbrite.co.uk/e/1", "https://www.ticketmaster.co.uk/e/1", "https://www.seetickets.com/event/1", "https://www.gigantic.com/x"].map(named),
      ["Skiddle", "RA", "Fatsoma", "Fixr", "DICE", "Eventbrite", "Ticketmaster", "See Tickets", "Other (gigantic.com)"],
    );
    assert.equal(platformName("other", "www.tickets.example.com"), "Other (tickets.example.com)");
  });

  it("no CIRQLIN tag: RT2's two links, named the same way", () => {
    assert.deepEqual(linksFallback({ ticket_url: "https://www.skiddle.com/whats-on/x/9/", signup_url: "https://show.example/page?utm=1" }).map((link) => [link.kind, link.name, link.rule]), [
      ["ticket", "Skiddle", "www.skiddle.com/whats-on/x/9/"],
      ["landing", "show.example/page", "show.example/page"],
    ]);
  });

  it("the pixel line: any event from the platform's host in 28 days (GET /{pixel}/stats?aggregation=host)", () => {
    const links = linksFromPages(ROBBIE.pages);
    const hosts = { any: ["www.skiddle.com", "ra.co", "robbiedoherty-newcastle.com"], pageView: [], checkout: [], registration: [] };
    assert.deepEqual(pixelOnPlatforms(links, hosts), [
      { name: "Skiddle", on: true },
      { name: "RA", on: true },
      { name: "Fatsoma", on: false },
      { name: "Fixr", on: false },
      { name: "DICE", on: false },
    ]);
    assert.equal(words.pixelLine(pixelOnPlatforms(links, hosts)!), "Pixel on Skiddle and RA: yes · Fatsoma, Fixr and DICE: no");
    assert.equal(words.pixelLine([{ name: "Fatsoma", on: false }, { name: "DICE", on: false }]), "Pixel on Fatsoma and DICE: no");
    assert.equal(words.pixelLine([{ name: "xmpl-whse.com", on: true }]), "Pixel on xmpl-whse.com: yes");
    assert.equal(words.TICKET_SITE_COUNTS, "A ticket site counts visitors only when your pixel is on it there.");
    assert.equal(firedOn(["skiddle.com"], "www.skiddle.com"), true);
    assert.equal(pixelOnPlatforms(links, null), null, "not read: no line");
  });

  it("no pixel line for crqln.com, nor for a landing host another show's pages use; the show's own domain gets one", () => {
    const links = linksFromPages(TWO_PAGES);
    const hosts = { any: ["robbiedoherty-newcastle.com", "crqln.com"], pageView: [], checkout: [], registration: [] };
    assert.deepEqual(pixelOnOwnDomains(links, hosts, new Set()), [{ name: "robbiedoherty-newcastle.com", on: true }], "crqln.com never");
    assert.equal(isSharedHost("crqln.com"), true);
    // Another show's page on the same host: shared, so no line.
    const byShow = new Map([
      ["rd", links],
      ["other", linksFromPages([{ ...ROBBIE.pages[0]!, page_id: "o", landing_url: "https://www.robbiedoherty-newcastle.com/second-show", ticket_links: [] }])],
    ]);
    const others = otherLandingHosts(byShow, "rd");
    assert.equal(landingShared("robbiedoherty-newcastle.com", others), true);
    assert.deepEqual(pixelOnOwnDomains(links, hosts, others), []);
  });

  it("sizes: each link's band once created, \"By link: known after create\" before", () => {
    assert.equal(words.BY_LINK_BEFORE_CREATE, "By link: known after create");
    assert.equal(words.sizesLine([{ name: "Skiddle", band: words.sizeBand(2100, 2500) }, { name: "RA", band: words.sizeBand(1000, 1200) }, { name: "Fixr", band: words.sizeBand(300, 800) }]), "Skiddle 2,100–2,500 · RA 1,000–1,200 · Fixr below 1,000");
    assert.equal(words.sizesLine([{ name: "xmpl-whse.com", band: words.sizeBand(7000, 8200) }]), "xmpl-whse.com 7,000–8,200");
    assert.equal(words.sizesLine([{ name: "DICE", band: null }]), "DICE —");
  });

  it("reads page-links with the partner bearer and the Robbie Doherty body", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const ok = await fetchCirqlinPageLinks("CQ-robbiedoherty-newcastle", {
      base: "https://app.cirqlin.com",
      secret: "s3cret",
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
        return new Response(JSON.stringify(ROBBIE), { status: 200 });
      }) as typeof fetch,
    });
    assert.deepEqual(ok, { ok: true, pages: ROBBIE.pages });
    assert.deepEqual(seen, [{ url: "https://app.cirqlin.com/api/partner/page-links?crm_base_tag=CQ-robbiedoherty-newcastle", auth: "Bearer s3cret" }]);
    assert.deepEqual(await fetchCirqlinPageLinks("CQ-robbiedoherty-newcastle", { secret: "" }), { ok: false, reason: "not_configured" });
  });

  it("each of the five errors gives RT13's sentence: 404 no_page its own, 400 / 401 / 429 / 500 \"couldn't be read\"", async () => {
    const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    const cases: [number, unknown, string, string][] = [
      [404, { error: "no_page" }, "no_page", words.LINKS_NO_PAGE],
      [400, { error: "bad_request" }, "failed", words.LINKS_NOT_READ],
      [401, { error: "unauthorized" }, "failed", words.LINKS_NOT_READ],
      [429, { error: "rate_limited", retryAfterSeconds: 60 }, "failed", words.LINKS_NOT_READ],
      [500, { error: "read_failed" }, "failed", words.LINKS_NOT_READ],
    ];
    const event = { id: "e", event_code: "RD", mailchimp_tag: "CQ-robbiedoherty-newcastle" } as never;
    for (const [status, body, linksRead, sentence] of cases) {
      const read = await showLinks(event, (tag) => fetchCirqlinPageLinks(tag, { secret: "s", fetchImpl: respond(status, body) }));
      assert.equal(read.linksRead, linksRead, String(status));
      const plan = planRetargeting({ ...PROPOSABLE, linksRead: read.linksRead as never });
      assert.equal(plan.view.notProposed, sentence, String(status));
      // A running campaign keeps its last rules on any of them.
      assert.equal(comparesRules(read.linksRead), false, String(status));
      assert.equal(planRetargeting({ ...PROPOSABLE, linksRead: read.linksRead as never, existing: { campaignId: "c", since: "2026-11-10", totalMinor: 580, share: 10, tiers: { bottom: 290, mid_bottom: 145, mid: 145 } } }).state, "running", String(status));
    }
    assert.equal(words.LINKS_NO_PAGE, "Retargeting not proposed: this show's CIRQLIN page isn't published. It's proposed at the first read after it is.");
    assert.equal(words.LINKS_NOT_READ, "Retargeting not proposed: the show's links couldn't be read from CIRQLIN this run. The next run tries again.");
    assert.equal(comparesRules("ok"), true);
    assert.equal(comparesRules("no_tag"), true);
  });

  it("the daily read: CIRQLIN by tag, RT2's links with none, and the two not-proposed states", async () => {
    const event = { id: "e", event_code: "RD", ticket_url: "https://www.skiddle.com/x/1/", signup_url: "https://rd.example/" } as never;
    assert.equal((await showLinks({ ...(event as object), mailchimp_tag: null } as never, async () => ({ ok: true, pages: [] }))).linksRead, "no_tag");
    assert.equal((await showLinks({ ...(event as object), mailchimp_tag: "RD-NCL" } as never, async () => ({ ok: true, pages: PAGES }))).links.length, 8);
    assert.deepEqual(await showLinks({ ...(event as object), mailchimp_tag: "RD-NCL" } as never, async () => ({ ok: false, reason: "no_page" })), { links: [], linksRead: "no_page", reason: "no_page" });
    assert.deepEqual(await showLinks({ ...(event as object), mailchimp_tag: "RD-NCL" } as never, async () => ({ ok: false, reason: "read_failed", status: 500 })), { links: [], linksRead: "failed", reason: "read_failed" });
    assert.equal(words.LINKS_NO_PAGE, "Retargeting not proposed: this show's CIRQLIN page isn't published. It's proposed at the first read after it is.");
    assert.equal(words.LINKS_NOT_READ, "Retargeting not proposed: the show's links couldn't be read from CIRQLIN this run. The next run tries again.");
  });

  it("a change on the read shows as changed rules; the same links, in any order, don't", () => {
    const set: SourceSet = { pixelId: "px", links: linksFromPages(PAGES), videos: [], pages: [], lists: [] };
    const built = pixelRules(tierSpecs(set));
    assert.deepEqual(ruleChanges(built, pixelRules(tierSpecs({ ...set, links: [...set.links].reverse() }))), []);
    // An outlet switched off on CIRQLIN: every ticket-link audience changes.
    const fewer = { ...set, links: set.links.filter((link) => link.name !== "Fatsoma") };
    const fatsoma = set.links.find((link) => link.name === "Fatsoma")!.rule;
    assert.deepEqual(ruleChanges(built, pixelRules(tierSpecs(fewer))), ["bottom:checkout:14", "bottom:checkout:30", "bottom:checkout:7", "bottom:ticket:14", `bottom:ticket:30:${linkKey(fatsoma)}`, "bottom:ticket:7", "mid_bottom:checkout:60"].sort());
    assert.equal(urlRule("not a url"), null);
  });
});

describe("RT11: today's share", () => {
  it("RA's show (Sat 19 Dec): 10 % on Tue 17 Nov, then 15, 20 and 25 % from 30, 14 and 7 days out", () => {
    assert.deepEqual(shareOn("2026-11-17", "2026-12-19"), { share: 10, stretch: null });
    assert.deepEqual(shareOn("2026-11-19", "2026-12-19"), { share: 15, stretch: "final_month" });
    // The payday stretch (Thu 26 Nov – Sun 13 Dec) inside a 15 % step adds nothing.
    assert.deepEqual(shareOn("2026-11-26", "2026-12-19"), { share: 15, stretch: "final_month" });
    assert.deepEqual(shareOn("2026-12-05", "2026-12-19"), { share: 20, stretch: "final_two_weeks" });
    assert.deepEqual(shareOn("2026-12-12", "2026-12-19"), { share: 25, stretch: "final_week" });
    assert.deepEqual(shareOn("2026-12-19", "2026-12-19"), { share: 25, stretch: "final_week" });
    assert.equal(runInOn("2026-12-20", "2026-12-19"), null);
  });

  it("RB's show (Fri 18 Dec): 10 % on Tue 17 Nov, 31 days out; a payday stretch outside the run-in is 15 %", () => {
    assert.deepEqual(shareOn("2026-11-17", "2026-12-18"), { share: 10, stretch: null });
    assert.deepEqual(shareOn("2026-11-18", "2026-12-18"), { share: 15, stretch: "final_month" });
    assert.deepEqual(shareOn("2026-11-27", "2027-03-01"), { share: 15, stretch: "payday" });
  });

  it("the Create line names the stretch inside a step", () => {
    assert.equal(words.createLine({ totalMinor: 3600, pct: 15, tiers: { bottom: 1800, mid_bottom: 900, mid: 900 }, atFloor: false, floorMinor: 100, stretch: "final month" }), "£36.00 a day · 15 % of current daily spend, final month · Bottom £18.00 · Mid Bottom £9.00 · Mid £9.00");
  });
});

describe("RT13 / RT15: Bottom's sources, registrations and an empty Bottom", () => {
  const set: SourceSet = { pixelId: "px", links: linksFromPages(ROBBIE.pages), videos: [{ contextId: "pg", videoIds: ["v"] }], pages: [{ id: "pg", name: "Promoter", igId: null, kind: "promoter", hasRole: true }], lists: [] };

  it("no registrations from the show's own landing page in 28 days: the brick line", () => {
    const { rows } = tierRows({ sources: set, pixelHosts: { any: ["www.skiddle.com"], pageView: ["www.skiddle.com"], checkout: [], registration: [] } }, { bottom: 300, mid_bottom: 150, mid: 150 });
    assert.deepEqual(rows[0]!.missing.map((line) => line.text), [
      "No registrations from robbiedoherty-newcastle.com reach the pixel in 28 days, so Bottom counts signups from the signup list only.",
      "No signup list yet, so Bottom runs on ticket-link visitors, checkout starters and registrations only.",
    ]);
  });

  it("a shared landing host (crqln.com) can't say whose registrations they are: no line", () => {
    const crowd = { ...set, links: linksFromPages([TWO_PAGES[1]!]) };
    assert.equal(bottomSignals(crowd, { any: [], pageView: [], checkout: [], registration: [] }).registrations, true);
  });

  it("no visits, checkouts, registrations or signup list: Bottom can't be built, and its 50 % goes 1 to 1", () => {
    const hosts = { any: [], pageView: [], checkout: [], registration: [] };
    assert.equal(bottomSignals(set, hosts).empty, true);
    const { rows } = tierRows({ sources: set, pixelHosts: hosts }, { bottom: 0, mid_bottom: 290, mid: 290 });
    assert.deepEqual(rows[0]!.missing.map((line) => line.text), ["Bottom has no audience yet: no visits, checkout starters, registrations or signup list."]);
    assert.deepEqual(startingBudget({ currentDailyMinor: 5800, share: 10, midBuildable: true, bottomBuildable: false })!.tiers, { bottom: 0, mid_bottom: 290, mid: 290 });
    assert.deepEqual(startingBudget({ currentDailyMinor: 5801, share: 10, midBuildable: false, bottomBuildable: false })!.tiers, { bottom: 0, mid_bottom: 580, mid: 0 });
    // Not read: it isn't called empty.
    assert.equal(bottomSignals(set, null).empty, false);
  });
});

describe("RT16: the Retargeting panel is Live on every active show without arming", () => {
  it("retargeting lines take the deployment's gate with the arm Live; the refresh keeps its arm", () => {
    const env = { ONSALE_REFRESH_APPLY_ENABLED: "1" };
    const unarmed = applyGates(env, "shadow");
    assert.equal(unarmed.mode, "shadow");
    assert.equal(retargetingGates(unarmed).mode, "live");
    assert.equal(retargetingGates(applyGates({}, "live")).mode, "shadow", "the deployment's gate still holds");
    assert.equal(retargetingGates(unarmed).campaignCreateEnabled, unarmed.campaignCreateEnabled, "every write gate stands");
  });

  it("decide, the apply route and the panel load use it; the daily read writes Live proposals", () => {
    assert.match(readFileSync("lib/onsale-refresh/decide.ts", "utf8"), /if \(runKind === "retargeting"\) args = \{ \.\.\.args, gates: retargetingGates\(args\.gates\) \};/);
    assert.match(readFileSync("lib/onsale-refresh/read.ts", "utf8"), /retargetingApply: panelApply\(retargetingGates\(gates\)\)/);
    assert.match(readFileSync("lib/retargeting/runner.ts", "utf8"), /mode: retargetingGates\(applyGates\(input\.env, arms\.get\(event\.id\)\)\)\.mode/);
    assert.match(readFileSync("components/dashboard/events/onsale-refresh-panel.tsx", "utf8"), /apply=\{panel\.retargetingApply \?\? undefined\}/);
  });
});

describe("RT11: the share choice is gone from the panel", () => {
  it("no 10 / 15 / 20 % radio group", () => {
    const panel = readFileSync("components/dashboard/events/retargeting-panel.tsx", "utf8");
    assert.doesNotMatch(panel, /ShareChoice|role="radiogroup"/);
  });
});

/** Migration 257 against the live CHECK, copied from prod (pg_get_constraintdef, read 17 Nov 2026). */
describe("migration 257: stored retargeting audiences keep their key", () => {
  const SQL = readFileSync(new URL("../../../supabase/migrations/257_retargeting_audience_parts.sql", import.meta.url), "utf8");
  const LIVE = "CHECK ((part = ANY (ARRAY['landing'::text, 'ticket'::text, 'video'::text, 'registrations'::text, 'lookalike'::text, 'adset'::text])))";
  // select kind, part, count(*) on prod, 17 Nov 2026.
  const ROWS: [string, string][] = [["registrations_lookalike", "adset"], ["registrations_lookalike", "lookalike"], ["registrations_lookalike", "registrations"], ["retargeting", "adset"], ["retargeting", "landing"], ["retargeting", "registrations"], ["retargeting", "ticket"], ["retargeting", "video"]];

  it("drops the live check by name before adding, and keeps the six parts", () => {
    const drop = SQL.indexOf("drop constraint if exists onsale_refresh_audiences_part_check");
    const add = SQL.indexOf("add constraint onsale_refresh_audiences_part_check");
    assert.ok(drop > 0 && add > drop);
    assert.doesNotMatch(SQL, /do \$\$/i);
    const live = [...LIVE.matchAll(/'([^']+)'::text/g)].map((m) => m[1]);
    for (const part of live) assert.match(SQL, new RegExp(`'${part}'`));
  });

  it("every row prod holds passes, and a retargeting_campaign key does too", () => {
    const allowed = (kind: string, part: string) => ["landing", "ticket", "video", "registrations", "lookalike", "adset"].includes(part) || (kind === "retargeting_campaign" && part.length >= 1 && part.length <= 200);
    for (const [kind, part] of ROWS) assert.ok(allowed(kind, part), `${kind}/${part}`);
    assert.ok(allowed("retargeting_campaign", "mid:video:120000000000:1:90"));
    assert.equal(allowed("retargeting", "bottom:ticket:7"), false);
    assert.match(SQL, /kind = 'retargeting_campaign' and length\(part\) between 1 and 200/);
  });
});

describe("frame RA (PR B's lines): a running campaign's per-link sizes and pixel lines", () => {
  it("Bottom: Skiddle 2,100–2,500 · RA 1,000–1,200 · Fixr below 1,000; Mid Bottom: xmpl-whse.com 7,000–8,200", async () => {
    const { raView } = await import("../../../scripts/plan-frames/retargeting-fixtures.ts");
    const view = raView();
    assert.equal(view.state, "running");
    assert.deepEqual(view.tiers.map((row) => row.links.wide), [
      ["Skiddle 2,100–2,500 · RA 1,000–1,200 · Fixr below 1,000", "Pixel on Skiddle and RA: yes · Fixr: no", "A ticket site counts visitors only when your pixel is on it there."],
      ["xmpl-whse.com 7,000–8,200", "Pixel on xmpl-whse.com: yes"],
      [],
    ]);
    assert.deepEqual(view.tiers.map((row) => row.audiences), [
      ["Ticket-link visitors · checkout starters · 7, 14 and 30 days", "Registrations · 30, 90 and 180 days", "Signup list"],
      ["Page visitors · 14, 30 and 60 days", "Checkout starters · 60 days", "2 similar lists"],
      ["Video viewers 75 % · 90, 180 and 365 days", "Page and Instagram engagers · 30, 90 and 180 days · 4 pages"],
    ]);
  });
});

/** Migration 257's second part: the ledger's op_kind, against the live CHECK (read 24 Nov 2026, after main's 263). */
describe("migration 257: the rule rewrite's op kind on the Meta write ledger", () => {
  const SQL = readFileSync(new URL("../../../supabase/migrations/257_retargeting_audience_parts.sql", import.meta.url), "utf8");
  const LIVE =
    "CHECK ((op_kind = ANY (ARRAY['campaign_create'::text, 'adset_create'::text, 'ad_create'::text, 'creative_upload'::text, 'adset_targeting_update'::text, 'adset_destination_update'::text, 'refresh_creative_create'::text, 'refresh_ad_create'::text, 'ad_status_update'::text, 'adset_status_update'::text, 'refresh_adset_budget_update'::text, 'refresh_adset_create'::text, 'refresh_custom_conversion_create'::text, 'refresh_campaign_create'::text, 'refresh_campaign_lifetime_budget_update'::text, 'refresh_campaign_status_update'::text, 'retargeting_audience_rule_update'::text, 'retargeting_study_create'::text, 'retargeting_study_end'::text, 'adset_end_time_update'::text])))";
  // select op_kind, count(*) on prod, 24 Nov 2026: the kinds rows hold.
  const HELD = ["ad_create", "adset_create", "campaign_create", "creative_upload", "refresh_ad_create", "refresh_adset_create"];

  it("drops the live check by name and re-adds the 20 live kinds (263's) plus #1367's two (267), whatever the order they're applied in", () => {
    const drop = SQL.indexOf("drop constraint if exists meta_write_idempotency_op_kind_check");
    const add = SQL.indexOf("add constraint meta_write_idempotency_op_kind_check");
    assert.ok(drop > 0 && add > drop);
    const listed = [...SQL.slice(add).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    const live = [...LIVE.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
    for (const kind of [...live, ...HELD]) assert.ok(listed.includes(kind), kind);
    assert.ok(listed.includes("retargeting_audience_rule_update"));
    // The signups engine's 267 (#1367) re-adds the same CHECK with these two more; 257 keeps them so neither order drops a kind.
    assert.deepEqual(new Set(listed), new Set([...live, "customer_list_create", "customer_list_users"]), "nothing dropped; only 267's two added");
  });
});
