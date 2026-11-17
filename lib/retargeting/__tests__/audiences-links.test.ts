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
import { pixelRules, ruleChanges, tierSpecs, type SourceSet } from "../audiences.ts";
import { startingBudget } from "../budget.ts";
import { firedOn, isSharedHost, linksFallback, linksFromPages, pixelOnPlatforms, platformName, urlRule } from "../links.ts";
import { bottomSignals, tierRows } from "../plan.ts";
import { showLinks } from "../runner.ts";
import { runInOn, shareOn } from "../shares.ts";
import * as words from "../words.ts";

const PAGES: PartnerPageLinks[] = [
  {
    page_id: "a",
    slug: "robbie-doherty-newcastle",
    crm_base_tag: "RD-NCL",
    title: "Robbie Doherty",
    landing_url: "https://robbiedoherty-newcastle.com/",
    ticket_links: [
      { platform: "ra", url: "https://ra.co/events/2222222", label: "Tickets", shop_name: null, shown_first: false },
      { platform: "skiddle", url: "https://www.skiddle.com/whats-on/Newcastle/RD/111/?sktag=1", label: "Tickets", shop_name: null, shown_first: true },
      { platform: "fatsoma", url: "https://www.fatsoma.com/e/x1/rd", label: "Tickets", shop_name: null, shown_first: false },
    ],
  },
  {
    page_id: "b",
    slug: "rd-crowd",
    crm_base_tag: "RD-NCL",
    title: "Robbie Doherty crowd",
    landing_url: "https://crqln.com/rd-crowd",
    ticket_links: [
      { platform: "fixr", url: "https://fixr.co/event/rd-123", label: "Book", shop_name: null, shown_first: false },
      { platform: "dice", url: "https://dice.fm/event/rd", label: "Tickets", shop_name: null, shown_first: false },
      // The same Skiddle link as page a: one rule.
      { platform: "skiddle", url: "https://www.skiddle.com/whats-on/Newcastle/RD/111/", label: "Tickets", shop_name: null, shown_first: false },
    ],
  },
];

describe("RT13: the show's links from CIRQLIN", () => {
  it("every landing_url and ticket link is one URL rule, host to the end of the path as returned; shown first goes first", () => {
    const links = linksFromPages(PAGES);
    assert.deepEqual(
      links.map((link) => [link.kind, link.name, link.rule]),
      [
        ["ticket", "Skiddle", "www.skiddle.com/whats-on/Newcastle/RD/111/"],
        ["ticket", "RA", "ra.co/events/2222222"],
        ["ticket", "Fatsoma", "www.fatsoma.com/e/x1/rd"],
        ["ticket", "Fixr", "fixr.co/event/rd-123"],
        ["ticket", "DICE", "dice.fm/event/rd"],
        ["landing", "robbiedoherty-newcastle.com", "robbiedoherty-newcastle.com/"],
        ["landing", "crqln.com/rd-crowd", "crqln.com/rd-crowd"],
      ],
    );
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

  it("platform names (ops, 17 Nov), and Other ({host}) for the rest", () => {
    assert.deepEqual(["skiddle", "ra", "fatsoma", "fixr", "dice", "eventbrite", "ticketmaster", "seetickets"].map((slug) => platformName(slug, "x")), ["Skiddle", "RA", "Fatsoma", "Fixr", "DICE", "Eventbrite", "Ticketmaster", "See Tickets"]);
    assert.equal(platformName("other", "www.tickets.example.com"), "Other (tickets.example.com)");
    assert.equal(platformName("gigantic", "gigantic.com"), "Other (gigantic.com)");
  });

  it("no CIRQLIN tag: RT2's two links, named the same way", () => {
    assert.deepEqual(linksFallback({ ticket_url: "https://www.skiddle.com/whats-on/x/9/", signup_url: "https://show.example/page?utm=1" }).map((link) => [link.kind, link.name, link.rule]), [
      ["ticket", "Skiddle", "www.skiddle.com/whats-on/x/9/"],
      ["landing", "show.example/page", "show.example/page"],
    ]);
  });

  it("the pixel line names third-party platforms only, never a shared host", () => {
    const links = linksFromPages(PAGES);
    const hosts = { pageView: ["www.skiddle.com", "ra.co", "robbiedoherty-newcastle.com", "crqln.com"], checkout: [], registration: [] };
    assert.deepEqual(pixelOnPlatforms(links, hosts), [
      { name: "Skiddle", on: true },
      { name: "RA", on: true },
      { name: "Fatsoma", on: false },
      { name: "Fixr", on: false },
      { name: "DICE", on: false },
    ]);
    assert.equal(words.pixelOnLine(pixelOnPlatforms(links, hosts)!), "Pixel on Skiddle: yes · RA: yes · Fatsoma: no · Fixr: no · DICE: no");
    assert.equal(isSharedHost("crqln.com"), true);
    assert.equal(firedOn(["skiddle.com"], "www.skiddle.com"), true);
    assert.equal(pixelOnPlatforms(links, null), null, "not read: no line");
  });

  it("reads page-links with the partner bearer, and turns every failure into a state", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const respond = (status: number, body: unknown) => (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const ok = await fetchCirqlinPageLinks("RD-NCL", { base: "https://cirqlin.test/", secret: "s3cret", fetchImpl: respond(200, { pages: PAGES }) });
    assert.deepEqual(ok, { ok: true, pages: PAGES });
    assert.deepEqual(seen[0], { url: "https://cirqlin.test/api/partner/page-links?crm_base_tag=RD-NCL", auth: "Bearer s3cret" });
    assert.deepEqual(await fetchCirqlinPageLinks("RD-NCL", { secret: "s", fetchImpl: respond(404, { error: "no_page" }) }), { ok: false, reason: "no_page" });
    assert.equal((await fetchCirqlinPageLinks("RD-NCL", { secret: "s", fetchImpl: respond(500, { error: "read_failed" }) })).ok, false);
    assert.deepEqual(await fetchCirqlinPageLinks("RD-NCL", { secret: "s", fetchImpl: respond(200, { pages: [{ page_id: "x" }] }) }), { ok: false, reason: "bad_payload", status: 200 });
    assert.deepEqual(await fetchCirqlinPageLinks("RD-NCL", { secret: "" }), { ok: false, reason: "not_configured" });
    const thrown = await fetchCirqlinPageLinks("RD-NCL", { secret: "s", fetchImpl: (async () => { throw new Error("socket"); }) as typeof fetch });
    assert.deepEqual(thrown, { ok: false, reason: "network", message: "socket" });
  });

  it("the daily read: CIRQLIN by tag, RT2's links with none, and the two not-proposed states", async () => {
    const event = { id: "e", event_code: "RD", ticket_url: "https://www.skiddle.com/x/1/", signup_url: "https://rd.example/" } as never;
    assert.equal((await showLinks({ ...(event as object), mailchimp_tag: null } as never, async () => ({ ok: true, pages: [] }))).linksRead, "no_tag");
    assert.equal((await showLinks({ ...(event as object), mailchimp_tag: "RD-NCL" } as never, async () => ({ ok: true, pages: PAGES }))).links.length, 7);
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
    assert.deepEqual(ruleChanges(built, pixelRules(tierSpecs(fewer))), ["bottom:checkout:14", "bottom:checkout:30", "bottom:checkout:7", "bottom:ticket:14", "bottom:ticket:30", "bottom:ticket:7", "mid_bottom:checkout:60"]);
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
  const set: SourceSet = { pixelId: "px", links: linksFromPages([PAGES[0]!]), videos: [{ contextId: "pg", videoIds: ["v"] }], pages: [{ id: "pg", name: "Promoter", igId: null, kind: "promoter", hasRole: true }], lists: [] };

  it("no registrations from the show's own landing page in 28 days: the brick line", () => {
    const { rows } = tierRows({ sources: set, pixelHosts: { pageView: ["www.skiddle.com"], checkout: [], registration: [] } }, { bottom: 300, mid_bottom: 150, mid: 150 });
    assert.deepEqual(rows[0]!.missing.map((line) => line.text), [
      "No registrations from robbiedoherty-newcastle.com reach the pixel in 28 days, so Bottom counts signups from the signup list only.",
      "No signup list yet, so Bottom runs on ticket-link visitors, checkout starters and registrations only.",
    ]);
  });

  it("a shared landing host (crqln.com) can't say whose registrations they are: no line", () => {
    const crowd = { ...set, links: linksFromPages([PAGES[1]!]) };
    assert.equal(bottomSignals(crowd, { pageView: [], checkout: [], registration: [] }).registrations, true);
  });

  it("no visits, checkouts, registrations or signup list: Bottom can't be built, and its 50 % goes 1 to 1", () => {
    const hosts = { pageView: [], checkout: [], registration: [] };
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
