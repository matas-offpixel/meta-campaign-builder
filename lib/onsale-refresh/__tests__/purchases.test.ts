import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { canonicalHost, fetchAdSetPixels, fetchPurchaseHosts, firstOnSaleDay, loadPurchaseReads, resolveCirqlinDomain, type RefreshGraph } from "../purchase-read.ts";
import {
  attributedOnPixel,
  classifyDomain,
  countOn,
  hostOf,
  isCirqlinLink,
  platformFor,
  platformOf,
  purchaseWhy,
  readPurchases,
  resolvePixel,
  ticketSiteFor,
  ticketSiteOf,
  unreadPurchases,
  TICKET_SITES,
  UNLINKED_TICKETING,
  type AttributedRow,
  type CirqlinLookup,
  type DomainClass,
  type DomainEvent,
  type HostDay,
  type PurchaseRead,
  type ReadPurchasesInput,
} from "../purchases.ts";
import { buildProposal, type CampaignInput } from "../rules.ts";
import { inputsSnapshot, refreshRunLog, runOnsaleRefresh } from "../runner.ts";
import { planRun } from "../schedule.ts";
import { pixelSlackMessage, slackMessage } from "../slack.ts";

/**
 * docs/design-record/2026-11-13-per-event-purchases.html: E1 the own
 * domain, E2 the bar, E3 the states and their words, E4 the pixel; HE1's
 * acceptance cases on the real shows' URLs and pixels.
 */

const NX_PIXEL = "645185673672763";
const BRIXTON_PIXEL = "1283861880364565";
const PUZZLE_PIXEL = "1067726194205285";
const STUDIOS_PIXEL = "2261755947685271";

// The real shows (13 Nov): their signup and ticket links as stored on the events.
const LOCKLEAD: DomainEvent = { id: "locklead", signup_url: "https://www.locklead-newcastle.com", ticket_url: "https://www.skiddle.com/whats-on/Newcastle-on-Tyne/NX-Newcastle/Locklead/43144633/" };
const BDAY: DomainEvent = { id: "bday", signup_url: "https://crqln.com/l/puzzle-4th-birthday", ticket_url: "https://www.skiddle.com/whats-on/Southampton/Circuit-Southampton/Puzzle-The-4th-Birthday---Part-1/43050973/" };
const FEVER105: DomainEvent = { id: "fever", signup_url: "https://crqln.com/l/fever105-sheffield", ticket_url: "https://www.skiddle.com/whats-on/Sheffield/Electric-Studios/Fever-105-Sheffield/42833456/" };
const MALLGRAB: DomainEvent = { id: "mallgrab", signup_url: null, ticket_url: "https://www.skiddle.com/whats-on/Sheffield/Electric-Studios/Mall-Grab/42623153/" };
const TRANCOSO: DomainEvent = { id: "trancoso", signup_url: "https://www.ingresse.com/trancoso27-12/", ticket_url: "https://www.ingresse.com/trancoso27-12/" };
const JULIAN: DomainEvent = { id: "julian", signup_url: null, ticket_url: "https://www.universe.com/events/julian-fijima-tickets-5LV230" };
const PARABLE: DomainEvent = { id: "csa", signup_url: null, ticket_url: null };
const ALL = [LOCKLEAD, BDAY, FEVER105, MALLGRAB, TRANCOSO, JULIAN, PARABLE];

const CIRQLIN: Record<string, CirqlinLookup> = {
  "https://crqln.com/l/puzzle-4th-birthday": { ok: true, domain: null },
  "https://crqln.com/l/fever105-sheffield": { ok: true, domain: "fever105-sheffield.com" },
};
const lookup = (url: string) => CIRQLIN[url];

describe("per-event purchases: a domain of its own (E1)", () => {
  it("hosts compare as written, except a leading www.; ticket sites are named; a crqln.com link is a CIRQLIN page", () => {
    assert.equal(hostOf("https://www.locklead-newcastle.com"), "locklead-newcastle.com");
    assert.equal(hostOf("https://DOD-Newcastle.com/"), "dod-newcastle.com");
    assert.equal(hostOf("kream-bristol.com/tickets"), "kream-bristol.com");
    assert.equal(hostOf("  "), null);
    assert.equal(hostOf(null), null);
    assert.equal(ticketSiteOf("skiddle.com"), "Skiddle");
    assert.equal(ticketSiteOf("uk.ra.co"), "RA");
    assert.equal(ticketSiteOf("notskiddle.com"), null, "a suffix match is on the dot, never on the letters");
    assert.equal(ticketSiteOf("locklead-newcastle.com"), null);
    assert.equal(isCirqlinLink("https://crqln.com/l/puzzle-4th-birthday"), true);
    assert.equal(isCirqlinLink("https://crqln.com/"), false);
    assert.equal(isCirqlinLink("https://locklead-newcastle.com/l/x"), false);
    assert.equal(ticketSiteFor(LOCKLEAD), "Skiddle");
    assert.equal(ticketSiteFor(TRANCOSO), "Ingresse");
    assert.equal(ticketSiteFor({ id: "x", signup_url: null, ticket_url: "https://tickets.example.org/show" }), "tickets.example.org", "an unknown ticket host is named as written");
  });

  it("HE1: P26-BDAY has no domain of its own — a crqln.com page with no custom domain", () => {
    assert.deepEqual(classifyDomain(BDAY, ALL, lookup), { kind: "no_own_domain", cirqlinPage: true });
  });

  it("HE1: ES26-FEVER105 resolves to fever105-sheffield.com through its CIRQLIN page", () => {
    assert.deepEqual(classifyDomain(FEVER105, ALL, lookup), { kind: "own", domain: "fever105-sheffield.com", via: "cirqlin_custom_domain" });
  });

  it("HE1: ES26-MALLGRAB is ticket site only; so is a show whose signup link is itself the ticket site", () => {
    assert.deepEqual(classifyDomain(MALLGRAB, ALL, lookup), { kind: "ticket_site_only", ticketSite: "Skiddle" });
    assert.deepEqual(classifyDomain(TRANCOSO, ALL, lookup), { kind: "ticket_site_only", ticketSite: "Ingresse" });
    assert.deepEqual(classifyDomain(JULIAN, ALL, lookup), { kind: "ticket_site_only", ticketSite: "Universe" });
  });

  it("NX26-LOCKLEAD's signup host is its own; a show with neither link has no page or ticket URL", () => {
    assert.deepEqual(classifyDomain(LOCKLEAD, ALL, lookup), { kind: "own", domain: "locklead-newcastle.com", via: "signup_url" });
    assert.deepEqual(classifyDomain(PARABLE, ALL, lookup), { kind: "no_url" });
  });

  it("a domain another running or upcoming show uses is shared: www. is the same domain, a subdomain is not, and an event never counts against itself", () => {
    const tour: DomainEvent = { id: "tour-a", signup_url: "https://julianfijma.com/tour", ticket_url: null };
    const tourB: DomainEvent = { id: "tour-b", signup_url: "https://www.julianfijma.com/", ticket_url: null };
    const tourC: DomainEvent = { id: "tour-c", signup_url: "https://JULIANFIJMA.com", ticket_url: null };
    const sub: DomainEvent = { id: "sub", signup_url: "https://tickets.julianfijma.com", ticket_url: null };
    assert.deepEqual(classifyDomain(tour, [tour, tourB, tourC, sub], lookup), { kind: "shared_domain", domain: "julianfijma.com", others: 2 });
    assert.deepEqual(classifyDomain(sub, [tour, tourB, tourC, sub], lookup), { kind: "own", domain: "tickets.julianfijma.com", via: "signup_url" });
    assert.deepEqual(classifyDomain(tour, [tour], lookup), { kind: "own", domain: "julianfijma.com", via: "signup_url" });
    // A custom domain behind one show's CIRQLIN link that another show uses as its signup host is shared too.
    const squatter: DomainEvent = { id: "squat", signup_url: "https://fever105-sheffield.com/", ticket_url: null };
    assert.deepEqual(classifyDomain(FEVER105, [FEVER105, squatter], lookup), { kind: "shared_domain", domain: "fever105-sheffield.com", others: 1 });
  });

  it("crqln.com and the app's own landing host are never a show's own, however few shows use them; a CIRQLIN page that couldn't be read is not 'no domain'", () => {
    const onApp: DomainEvent = { id: "app", signup_url: "https://app.offpixel.co.uk/l/client/show", ticket_url: null };
    assert.deepEqual(classifyDomain(onApp, [onApp], lookup), { kind: "no_own_domain", cirqlinPage: false });
    assert.deepEqual(classifyDomain(BDAY, [BDAY], lookup), { kind: "no_own_domain", cirqlinPage: true });
    assert.deepEqual(classifyDomain(BDAY, ALL, () => ({ ok: false, reason: "HTTP 503" })), { kind: "not_read", reason: "the CIRQLIN page couldn't be read: HTTP 503" });
    assert.deepEqual(classifyDomain(BDAY, ALL, () => undefined), { kind: "not_read", reason: "the CIRQLIN page wasn't read" });
  });
});

describe("per-event purchases: the pixel (E4)", () => {
  it("HE1: NX shows resolve to 645185673672763 from their ad sets and flag the mismatch with the stored pixel", () => {
    const pixelOf = new Map<string, string | null>([["a", NX_PIXEL], ["b", NX_PIXEL]]);
    const resolved = resolvePixel([{ adsetId: "a", spend: 120 }, { adsetId: "b", spend: 80 }], pixelOf, BRIXTON_PIXEL, ONSALE_PHASE);
    assert.deepEqual(resolved, { pixel: { id: NX_PIXEL, source: "ad_sets", spendShare: 1, stored: BRIXTON_PIXEL, matches: false }, others: [] });
    assert.deepEqual(Object.keys(resolved!.pixel), ["id", "source", "spendShare", "stored", "matches"], "the record's evidence shape, exactly");
    assert.equal(resolvePixel([{ adsetId: "a", spend: 5 }], new Map([["a", PUZZLE_PIXEL]]), PUZZLE_PIXEL, ONSALE_PHASE)!.pixel.matches, true);
    assert.equal(resolvePixel([{ adsetId: "a", spend: 5 }], new Map([["a", PUZZLE_PIXEL]]), null, ONSALE_PHASE)!.pixel.matches, false, "nothing stored is not a match");
  });

  it("when ad sets disagree the pixel with the most spend wins; another at 10 % of the spend or more is named, one under it is not", () => {
    const pixelOf = new Map<string, string | null>([["a", NX_PIXEL], ["b", BRIXTON_PIXEL], ["c", BRIXTON_PIXEL], ["d", STUDIOS_PIXEL], ["e", null]]);
    const resolved = resolvePixel([{ adsetId: "a", spend: 70 }, { adsetId: "b", spend: 8 }, { adsetId: "c", spend: 7 }, { adsetId: "d", spend: 5 }, { adsetId: "e", spend: 10 }], pixelOf, BRIXTON_PIXEL, ONSALE_PHASE)!;
    assert.equal(resolved.pixel.id, NX_PIXEL);
    assert.equal(resolved.pixel.spendShare, 0.7, "the share is of every delivering ad set's spend, with or without a pixel");
    assert.deepEqual(resolved.others, [{ id: BRIXTON_PIXEL, adSets: 2, spendShare: 0.15 }], "5 % is not named");
  });

  it("no delivering ad set with a pixel resolves nothing; an ad set Meta did not return and one that spent nothing are left out", () => {
    assert.equal(resolvePixel([{ adsetId: "traffic", spend: 40 }], new Map([["traffic", null]]), BRIXTON_PIXEL, ONSALE_PHASE), null);
    assert.equal(resolvePixel([], new Map(), BRIXTON_PIXEL, ONSALE_PHASE), null);
    assert.equal(resolvePixel([{ adsetId: "unread", spend: 40 }], new Map(), BRIXTON_PIXEL, ONSALE_PHASE), null);
    const resolved = resolvePixel([{ adsetId: "unread", spend: 900 }, { adsetId: "idle", spend: 0 }, { adsetId: "a", spend: 10 }], new Map<string, string | null>([["idle", BRIXTON_PIXEL], ["a", NX_PIXEL]]), null, ONSALE_PHASE)!;
    assert.deepEqual([resolved.pixel.id, resolved.pixel.spendShare], [NX_PIXEL, 1]);
  });
});

const END = "2026-11-11";
const NX = { pixel: { id: NX_PIXEL, source: "ad_sets" as const, spendShare: 1, stored: BRIXTON_PIXEL, matches: false }, others: [] };
const OWN: DomainClass = { kind: "own", domain: "locklead-newcastle.com", via: "signup_url" };

function hosts(...rows: [day: string, host: string, count: number][]): HostDay[] {
  return rows.map(([day, host, count]) => ({ day, host, count }));
}

function input(overrides: Partial<ReadPurchasesInput> = {}): ReadPurchasesInput {
  return { pixelError: null, resolved: NX, pixelName: "NX Live Skiddle", domain: OWN, ticketSite: "Skiddle", stats: { rows: [] }, windowEnd: END, attributed14: 21, ticketsSold14: null, config: ONSALE_PHASE, ...overrides };
}

describe("per-event purchases: the count, the bar and the state (E2, E3)", () => {
  it("counts a host between two days inclusive, www. the same host, null = every host", () => {
    const rows = hosts(["2026-10-28", "www.skiddle.com", 9], ["2026-10-29", "locklead-newcastle.com", 2], ["2026-11-11", "www.locklead-newcastle.com", 4], ["2026-11-12", "locklead-newcastle.com", 7]);
    assert.equal(countOn(rows, "locklead-newcastle.com", "2026-10-29", "2026-11-11"), 6);
    assert.equal(countOn(rows, "locklead-newcastle.com", null, null), 13);
    assert.equal(countOn(rows, null, "2026-10-29", "2026-11-11"), 6);
    assert.equal(countOn(rows, null, null, null), 22);
  });

  it("15 on the own domain in the 14 days to the window end proposes; 14 does not; days outside the 14 don't count", () => {
    const rows = (inWindow: number) => hosts(["2026-10-28", "locklead-newcastle.com", 30], ["2026-10-29", "locklead-newcastle.com", inWindow - 1], ["2026-11-11", "locklead-newcastle.com", 1], ["2026-11-12", "locklead-newcastle.com", 30], ["2026-11-05", "www.skiddle.com", 200]);
    const under = readPurchases(input({ stats: { rows: rows(14) } }));
    assert.equal(under.state, "under_bar");
    assert.deepEqual(under.onDomain, { d14: 14, d28: 44, history: 74 });
    assert.deepEqual(under.pixelWide, { d14: 214, d28: 244, history: 274, topHost: "skiddle.com" });
    const proposed = readPurchases(input({ stats: { rows: rows(15) } }));
    assert.equal(proposed.state, "proposed");
    assert.equal(proposed.onDomain!.d14, 15);
    assert.equal(ONSALE_PHASE.ownDomainPurchasesMinIn14Days, 15);
  });

  it("an own domain no purchase has reached while the pixel has purchases is 'nothing reaches', not '0, under 15'; with nothing on the pixel either it is under the bar", () => {
    const nothing = readPurchases(input({ stats: { rows: hosts(["2026-11-03", "www.skiddle.com", 473]) } }));
    assert.equal(nothing.state, "nothing_reaches");
    assert.equal(nothing.landsOn, "Skiddle");
    assert.equal(nothing.historyDays, 28, "Meta's domain breakdown returns 28 days; the record's 90 isn't readable");
    const offList = readPurchases(input({ ticketSite: "Eventbrite", stats: { rows: hosts(["2026-11-03", "www.skiddle.com", 473], ["2026-11-03", "ra.co", 2]) } }));
    assert.deepEqual([offList.state, offList.landsOn], ["nothing_reaches", "Eventbrite"], "a ticket link on a site that is not a platform: it names the show's own ticket site");
    // With no ticket link stored there is nothing to name: that is "no ticket URL" (design, 13 Nov), whatever the pixel has.
    assert.equal(readPurchases(input({ ticketSite: null, stats: { rows: hosts(["2026-11-03", "www.skiddle.com", 473]) } })).state, "no_ticket_url");
    assert.equal(readPurchases(input({ ticketSite: null, stats: { rows: [] } })).state, "no_ticket_url");
    assert.equal(readPurchases(input({ stats: { rows: [] } })).state, "under_bar", "an empty pixel is not 'they land elsewhere'");
    // A purchase on the domain before the 14 days is still a purchase that reached it.
    assert.equal(readPurchases(input({ stats: { rows: hosts(["2026-10-20", "locklead-newcastle.com", 1], ["2026-11-03", "www.skiddle.com", 473]) } })).state, "under_bar");
  });

  it("the state order off the platform path: the first state that applies wins, and 'ticket site only' is retired", () => {
    const state = (overrides: Partial<ReadPurchasesInput>) => readPurchases(input(overrides)).state;
    const everything = { resolved: null, domain: { kind: "no_url" } as DomainClass };
    assert.equal(state(everything), "no_pixel", "no pixel, before the URLs are looked at");
    assert.equal(state({ domain: { kind: "no_url" } }), "no_url");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 6]) } }), "under_bar", "a domain a purchase has reached");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 18]) } }), "proposed");
    assert.equal(state({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 } }), "shared_domain");
    assert.equal(state({ domain: { kind: "no_own_domain", cirqlinPage: true } }), "no_own_domain");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "skiddle.com", 9]) } }), "nothing_reaches", "no ticket link on a platform: unchanged");
    // A show whose only link is a ticket site that is not a platform has no domain of its own; nothing needs the breakdown.
    assert.equal(state({ domain: { kind: "ticket_site_only", ticketSite: "Eventbrite" }, ticketSite: "Eventbrite", stats: { error: "rate limited" } }), "no_own_domain");
    assert.equal(state({ domain: { kind: "no_own_domain", cirqlinPage: true }, stats: null }), "no_own_domain");
  });

  it("a read that failed is said, never shown as a zero or as 'no pixel'", () => {
    const noToken = readPurchases(input({ pixelError: "META_ACCESS_TOKEN is not configured", resolved: null }));
    assert.deepEqual([noToken.state, noToken.notRead], ["not_read", "META_ACCESS_TOKEN is not configured"]);
    const statsDown = readPurchases(input({ stats: { error: "(#17) User request limit reached" } }));
    assert.deepEqual([statsDown.state, statsDown.onDomain], ["not_read", null]);
    assert.match(statsDown.notRead!, /User request limit reached/);
    assert.equal(readPurchases(input({ stats: null })).state, "not_read");
    assert.equal(readPurchases(input({ domain: { kind: "not_read", reason: "the CIRQLIN page couldn't be read: HTTP 503" } })).state, "not_read");
    assert.equal(unreadPurchases(3, ONSALE_PHASE).state, "not_read");
  });
});

function why(read: PurchaseRead, linked = false) {
  return purchaseWhy(read, linked, ONSALE_PHASE);
}

describe("per-event purchases: the words (F1, F2)", () => {
  const domain = "locklead-newcastle.com";
  const counted = (n: number) => readPurchases(input({ stats: { rows: hosts(["2026-11-03", domain, n], ["2026-11-03", "skiddle.com", 100]) } }));

  it("F2: every state's sentence at 1280 and at 393, in the record's words", () => {
    const cases: [PurchaseRead, string, string][] = [
      [counted(18), `Purchase campaign proposed — 18 purchases on ${domain} in 14 days.`, `Purchase campaign: 18 on ${domain} in 14 days.`],
      [counted(6), `Purchase campaign not proposed — 6 purchases on ${domain} in 14 days, under 15.`, `No Purchase campaign: 6 on ${domain} in 14 days, under 15.`],
      [counted(1), `Purchase campaign not proposed — 1 purchase on ${domain} in 14 days, under 15.`, `No Purchase campaign: 1 on ${domain} in 14 days, under 15.`],
      [
        readPurchases(input({ stats: { rows: hosts(["2026-11-03", "skiddle.com", 100]) } })),
        `Purchase campaign not proposed — no purchases have reached ${domain} in 28 days; they land on Skiddle, which can't be split by show.`,
        "No Purchase campaign: purchases land on Skiddle.",
      ],
      [
        readPurchases(input({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 } })),
        "Purchase campaign not proposed — julianfijma.com carries 2 other shows, so this show's purchases can't be told apart.",
        "No Purchase campaign: julianfijma.com is shared.",
      ],
      [
        readPurchases(input({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 1 } })),
        "Purchase campaign not proposed — julianfijma.com carries 1 other show, so this show's purchases can't be told apart.",
        "No Purchase campaign: julianfijma.com is shared.",
      ],
      [
        readPurchases(input({ domain: { kind: "no_own_domain", cirqlinPage: true } })),
        "Purchase campaign not proposed — this show has no domain of its own, so its purchases can't be told apart. A custom domain on its CIRQLIN page would let them be counted.",
        "No Purchase campaign: no domain of its own.",
      ],
      [
        readPurchases(input({ domain: { kind: "no_own_domain", cirqlinPage: false } })),
        "Purchase campaign not proposed — this show has no domain of its own, so its purchases can't be told apart.",
        "No Purchase campaign: no domain of its own.",
      ],
      [
        // "Ticket site only" is retired: off a platform, a show with only a ticket link has no domain of its own.
        readPurchases(input({ domain: { kind: "ticket_site_only", ticketSite: "Eventbrite" }, ticketSite: "Eventbrite" })),
        "Purchase campaign not proposed — this show has no domain of its own, so its purchases can't be told apart.",
        "No Purchase campaign: no domain of its own.",
      ],
      [readPurchases(input({ domain: { kind: "no_url" } })), "Purchase campaign not proposed — this show has no page or ticket URL set.", "No Purchase campaign: no page or ticket URL."],
      [readPurchases(input({ resolved: null })), "Purchase campaign not proposed — none of this show's ad sets optimises on a pixel yet.", "No Purchase campaign: no pixel on its ad sets."],
    ];
    for (const [read, wide, narrow] of cases) {
      const lines = why(read);
      assert.equal(lines.purchase, wide);
      assert.equal(lines.purchaseNarrow, narrow);
    }
  });

  it("the attributed line sits under every state, labelled any show, singular at 1; moves cross campaigns only when proposed", () => {
    for (const read of [counted(18), counted(6), readPurchases(input({ resolved: null })), readPurchases(input({ domain: { kind: "no_url" } })), readPurchases(input({ pixelError: "down", resolved: null }))]) {
      const lines = why(read);
      assert.equal(lines.attributed, "Attributed to these ads: 21 purchases in 14 days, any show on this pixel.");
      assert.equal(lines.attributedNarrow, "21 attributed purchases in 14 days, any show.");
      assert.equal(lines.moves, read.state === "proposed" ? "Budget moves can cross campaigns on cost per purchase." : "Budget moves stay inside each campaign.");
      assert.deepEqual(read.attributedPurchases, { count: 21, scope: "any_show_on_pixel" });
    }
    const one = why(readPurchases(input({ attributed14: 1, domain: { kind: "no_own_domain", cirqlinPage: true } })));
    assert.equal(one.attributed, "Attributed to these ads: 1 purchase in 14 days, any show on this pixel.");
    assert.equal(one.attributedNarrow, "1 attributed purchase in 14 days, any show.");
  });

  it("F1: the setup line when the ads' pixel is not the stored one, with the pixel's name when Meta gave one; none when they match or nothing is stored", () => {
    const lines = why(counted(6));
    assert.deepEqual(lines.pixel, ["Ads optimise on pixel …2763 (NX Live Skiddle); the client's stored pixel is …4565. Counts use …2763."]);
    assert.deepEqual(lines.pixelNarrow, ["Ads use pixel …2763; stored is …4565. Counts use …2763."]);
    assert.deepEqual(why(readPurchases(input({ pixelName: null }))).pixel, ["Ads optimise on pixel …2763; the client's stored pixel is …4565. Counts use …2763."]);
    const match = { pixel: { ...NX.pixel, stored: NX_PIXEL, matches: true }, others: [] };
    assert.deepEqual(why(readPurchases(input({ resolved: match }))).pixel, []);
    assert.deepEqual(why(readPurchases(input({ resolved: { pixel: { ...NX.pixel, stored: null, matches: false }, others: [] } }))).pixel, []);
    // E4: a second pixel at 10 % of the spend or more is added, mismatch or not.
    const second = why(readPurchases(input({ resolved: { pixel: match.pixel, others: [{ id: BRIXTON_PIXEL, adSets: 2, spendShare: 0.15 }, { id: STUDIOS_PIXEL, adSets: 1, spendShare: 0.1 }] } })));
    assert.deepEqual(second.pixel, ["2 ad sets optimise on pixel …4565", "1 ad set optimises on pixel …5271"]);
    assert.deepEqual(second.pixelNarrow, second.pixel);
  });

  it("the ticketing check shows only when ticketing is linked, sales are known and there is a domain count: Proposed and Under the bar", () => {
    const linked = (n: number, sold: number | null) => why(readPurchases(input({ ticketsSold14: sold, stats: { rows: hosts(["2026-11-03", domain, n], ["2026-11-03", "skiddle.com", 100]) } })), true);
    assert.equal(linked(18, 40).ticketing, `Ticketing: 40 sold in 14 days · the pixel saw 18 on ${domain} (45 % of sales).`);
    assert.equal(linked(6, 40).ticketing, `Ticketing: 40 sold in 14 days · the pixel saw 6 on ${domain} (15 % of sales).`);
    assert.equal(linked(6, 0).ticketing, `Ticketing: 0 sold in 14 days · the pixel saw 6 on ${domain}.`, "no share of nothing");
    assert.equal(linked(6, null).ticketing, null, "linked, but no sales figure to compare");
    assert.equal(why(readPurchases(input({ ticketsSold14: 40, stats: { rows: hosts(["2026-11-03", "skiddle.com", 100]) } })), true).ticketing, null, "nothing reaches: no domain count");
    assert.equal(why(readPurchases(input({ ticketsSold14: 40, domain: { kind: "no_own_domain", cirqlinPage: true } })), true).ticketing, null);
    assert.equal(why(counted(18), false).ticketing, UNLINKED_TICKETING, "C6: unlinked is said, never a blocker");
    assert.equal(why(readPurchases(input({ domain: { kind: "no_own_domain", cirqlinPage: true } })), false).ticketing, UNLINKED_TICKETING);
  });

  it("a read that failed says one fixed sentence at each width, whatever the reason; the raw reason is never in the words", () => {
    const reasons = ["META_ACCESS_TOKEN is not configured", "(#17) User request limit reached", "the CIRQLIN page couldn't be read: HTTP 503"];
    const reads = [
      ...reasons.map((reason) => readPurchases(input({ pixelError: reason, resolved: null }))),
      readPurchases(input({ stats: { error: "(#100) Missing permissions" } })),
      readPurchases(input({ domain: { kind: "not_read", reason: "the CIRQLIN page couldn't be read: socket hang up" } })),
      unreadPurchases(3, ONSALE_PHASE),
    ];
    for (const read of reads) {
      assert.equal(read.state, "not_read");
      assert.ok(read.notRead, "the reason is kept on the read, for the evidence and the ops log");
      for (const linked of [false, true]) {
        const lines = why(read, linked);
        assert.equal(lines.purchase, "Purchase campaign not proposed — this show's purchases couldn't be read this run. The next run tries again.");
        assert.equal(lines.purchaseNarrow, "No Purchase campaign: purchases not read this run.");
        const said = JSON.stringify(lines);
        for (const leak of [read.notRead!, "META_ACCESS_TOKEN", "#17", "#100", "HTTP 503", "socket hang up", "CIRQLIN page couldn't"]) assert.ok(!said.includes(leak), `the panel's words never carry "${leak}"`);
      }
    }
  });
});

// ── The ticket-platform path (T1–T6) ─────────────────────────────────────────

const SKIDDLE_PIXEL = hosts(["2026-11-03", "www.skiddle.com", 677], ["2026-11-03", "ra.co", 120], ["2026-11-04", "uk.ra.co", 39]);

function adDay(date: string, purchases: number, overrides: Partial<AttributedRow> = {}): AttributedRow {
  return { date, adsetId: "as-nx", campaign: "[NX26-LOCKLEAD] On Sale", spend: 20, purchases, ...overrides };
}

function credited(count: number, fromDay = "2026-10-29", sinceOnSale = false) {
  return { count, fromDay, sinceOnSale, total: { fromDay, purchases: count, spend: 0, byCampaign: [] } };
}

/** A show selling on Skiddle with nothing on a domain of its own, on a pixel that mostly sells on Skiddle. */
function platformInput(overrides: Partial<ReadPurchasesInput> = {}): ReadPurchasesInput {
  return input({ platform: "Skiddle", attributed: credited(6), stats: { rows: SKIDDLE_PIXEL }, ...overrides });
}

describe("ticket-platform purchases: which shows, and the count (T1, T2)", () => {
  it("T1: the platforms are Matas's four plus Universe and Ingresse, from the config; a host matches itself and its subdomains", () => {
    assert.deepEqual(ONSALE_PHASE.ticketPlatforms.map((platform) => platform.name), ["Skiddle", "RA", "See Tickets", "Dice", "Universe", "Ingresse"]);
    const of = (host: string) => platformOf(host, ONSALE_PHASE.ticketPlatforms);
    assert.deepEqual(["skiddle.com", "uk.ra.co", "seetickets.com", "link.dice.fm", "universe.com", "ingresse.com"].map(of), ["Skiddle", "RA", "See Tickets", "Dice", "Universe", "Ingresse"]);
    assert.equal(of("eventbrite.co.uk"), null, "a ticket site that is not on the list is not a platform");
    assert.equal(of("notskiddle.com"), null);
    assert.equal(of("locklead-newcastle.com"), null);
    // Each platform is also a ticket site, under the same name, so no sentence names it two ways.
    for (const platform of ONSALE_PHASE.ticketPlatforms) for (const host of platform.hosts) assert.equal(TICKET_SITES.find((site) => site.host === host)?.name, platform.name, host);
    assert.equal(platformFor(LOCKLEAD, ONSALE_PHASE.ticketPlatforms), "Skiddle");
    assert.equal(platformFor(JULIAN, ONSALE_PHASE.ticketPlatforms), "Universe");
    assert.equal(platformFor(TRANCOSO, ONSALE_PHASE.ticketPlatforms), "Ingresse");
    assert.equal(platformFor({ signup_url: "https://www.ingresse.com/x", ticket_url: null }, ONSALE_PHASE.ticketPlatforms), "Ingresse", "a signup link that is itself the platform link");
    assert.equal(platformFor({ signup_url: "https://rudimental-newcastle.com", ticket_url: null }, ONSALE_PHASE.ticketPlatforms), null, "no ticket URL: unchanged");
    // An extended list is all it takes.
    assert.equal(platformOf("eventbrite.co.uk", [...ONSALE_PHASE.ticketPlatforms, { name: "Eventbrite", hosts: ["eventbrite.co.uk"] }]), "Eventbrite");
  });

  it("T2: the first on-sale date is the presale when stored, else the general sale", () => {
    assert.equal(firstOnSaleDay({ presale_at: "2026-11-03T10:00:00Z", general_sale_at: "2026-11-04T10:00:00Z" }), "2026-11-03");
    assert.equal(firstOnSaleDay({ presale_at: null, general_sale_at: "2026-11-06T10:00:00Z" }), "2026-11-06");
    assert.equal(firstOnSaleDay({ presale_at: null, general_sale_at: null }), null);
  });

  it("T2: the count runs from the later of the 14-day start and the on-sale date, on the resolved pixel's ad sets only", () => {
    const pixelOf = new Map<string, string | null>([["as-nx", NX_PIXEL], ["as-brixton", BRIXTON_PIXEL], ["as-none", null]]);
    const rows = [
      adDay("2026-10-20", 40), // before the 14 days and before on sale
      adDay("2026-11-03", 13), // in the 14 days, before the show could be bought: another show's
      adDay("2026-11-06", 5),
      adDay("2026-11-10", 3, { campaign: "[NX26-LOCKLEAD] Signup", spend: 7.126 }),
      adDay("2026-11-10", 9, { adsetId: "as-brixton" }), // another pixel
      adDay("2026-11-10", 9, { adsetId: "as-none" }),
      adDay("2026-11-10", 9, { adsetId: "as-unread" }), // an ad set Meta did not return
      adDay("2026-11-10", 9, { adsetId: null }),
      adDay("2026-11-12", 30), // after the window end
    ];
    const lessThan14 = attributedOnPixel(rows, pixelOf, NX_PIXEL, { windowEnd: "2026-11-11", onSaleDay: "2026-11-06" });
    assert.deepEqual([lessThan14.count, lessThan14.fromDay, lessThan14.sinceOnSale], [8, "2026-11-06", true]);
    assert.deepEqual(lessThan14.total, { fromDay: "2026-11-06", purchases: 8, spend: 27.13, byCampaign: [{ campaign: "[NX26-LOCKLEAD] On Sale", purchases: 5, spend: 20 }, { campaign: "[NX26-LOCKLEAD] Signup", purchases: 3, spend: 7.13 }] });
    // On sale for longer than the 14 days: the count is the 14 days; the total still runs from the on-sale date.
    const longer = attributedOnPixel(rows, pixelOf, NX_PIXEL, { windowEnd: "2026-11-11", onSaleDay: "2026-10-01" });
    assert.deepEqual([longer.count, longer.fromDay, longer.sinceOnSale, longer.total.fromDay, longer.total.purchases], [21, "2026-10-29", false, "2026-10-01", 61]);
    // No on-sale date stored: the 14 days (C8), and the total with them.
    const unknown = attributedOnPixel(rows, pixelOf, NX_PIXEL, { windowEnd: "2026-11-11", onSaleDay: null });
    assert.deepEqual([unknown.count, unknown.fromDay, unknown.sinceOnSale, unknown.total.fromDay, unknown.total.purchases], [21, "2026-10-29", false, "2026-10-29", 21]);
    // An on-sale date after the window end counts nothing before the show could be bought… and nothing at all.
    assert.equal(attributedOnPixel(rows, pixelOf, NX_PIXEL, { windowEnd: "2026-11-11", onSaleDay: "2026-11-20" }).count, 21, "a date still ahead is not an on-sale date yet: the 14 days");
  });

  it("T2: 15 credited proposes, 14 does not; the pixel-wide host count never triggers", () => {
    assert.equal(readPurchases(platformInput({ attributed: credited(14) })).state, "platform_under_bar");
    assert.equal(readPurchases(platformInput({ attributed: credited(15) })).state, "platform_proposed");
    assert.equal(ONSALE_PHASE.platformPurchasesMinIn14Days, 15);
    // 836 purchases on the pixel and 400 "attributed, any show" say the pixel has signal, not that these ads earn it.
    const busy = readPurchases(platformInput({ attributed: credited(0), attributed14: 400 }));
    assert.deepEqual([busy.state, busy.pixelWide!.history, busy.attributedPurchases.count], ["platform_under_bar", 836, 400]);
    assert.equal(readPurchases(platformInput({ attributed: null })).state, "platform_under_bar", "no count is not a count of 15");
  });

  it("T2's guard: the show's platform must carry at least half of the pixel's purchases in the breakdown, whatever the count", () => {
    const share = (skiddle: number, other: number) => readPurchases(platformInput({ attributed: credited(40), stats: { rows: hosts(["2026-11-03", "www.skiddle.com", skiddle], ["2026-11-03", "universe.com", other], ["2026-11-03", "ra.co", 1]) } }));
    const fails = share(49, 50);
    assert.equal(fails.state, "pixel_sells_elsewhere", "49 of 100 is under half, 40 credited or not");
    assert.deepEqual(fails.platformShare, { purchases: 49, pixelPurchases: 100, share: 0.49, elsewhereHost: "universe.com" });
    assert.equal(share(50, 49).state, "platform_proposed", "exactly half passes");
    assert.equal(ONSALE_PHASE.platformShareMin, 0.5);
    // Fever 105: its ads' pixel sells on universe.com while the show sells on Skiddle.
    const fever = readPurchases(platformInput({ stats: { rows: hosts(["2026-11-03", "www.universe.com", 1316]) } }));
    assert.deepEqual([fever.state, fever.platformShare!.elsewhereHost, fever.platformShare!.share], ["pixel_sells_elsewhere", "universe.com", 0]);
    // RA's locale hosts are RA.
    const ra = readPurchases(platformInput({ platform: "RA", ticketSite: "RA" }));
    assert.deepEqual([ra.platformShare!.purchases, ra.platformShare!.elsewhereHost, ra.state], [159, "skiddle.com", "pixel_sells_elsewhere"]);
  });

  it("a pixel with no purchases fails the guard as its own state: it never reads as proposed or under the bar, whatever is credited", () => {
    for (const count of [0, 6, 15, 40, 400]) {
      const empty = readPurchases(platformInput({ attributed: credited(count), attributed14: count, stats: { rows: [] } }));
      assert.equal(empty.state, "platform_no_purchases", `${count} credited`);
      assert.deepEqual(empty.platformShare, { purchases: 0, pixelPurchases: 0, share: null, elsewhereHost: null });
      const said = purchaseWhy(empty, false, ONSALE_PHASE);
      assert.ok(said.purchase.startsWith("Purchase campaign not proposed — ") && said.purchaseNarrow.startsWith("No Purchase campaign: "), "never the proposed form");
      assert.doesNotMatch(`${said.purchase} ${said.purchaseNarrow}`, /under 15|attributed/, "nor the under-the-bar form");
      assert.equal(said.moves, "Budget moves stay inside each campaign.");
    }
    // One purchase anywhere on the pixel and the guard is the share again.
    assert.equal(readPurchases(platformInput({ stats: { rows: hosts(["2026-11-03", "skiddle.com", 1]) } })).state, "platform_under_bar");
    assert.equal(readPurchases(platformInput({ stats: { rows: hosts(["2026-11-03", "universe.com", 1]) } })).state, "pixel_sells_elsewhere");
  });

  it("no ticket URL stored: a domain (own or shared) nothing has reached and no ticket link; 'nothing reaches' stays for a ticket link off the platform list", () => {
    const pixelHas = { rows: hosts(["2026-11-03", "www.skiddle.com", 844]) };
    const noLink = (overrides: Partial<ReadPurchasesInput> = {}) => readPurchases(input({ ticketSite: null, platform: null, stats: pixelHas, ...overrides }));
    assert.equal(noLink().state, "no_ticket_url", "Rudimental, D.O.D and Kream: their own domain, no ticket URL");
    assert.equal(noLink({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 } }).state, "no_ticket_url", "a shared domain too");
    assert.equal(noLink({ stats: { rows: [] } }).state, "no_ticket_url", "whatever the pixel has");
    assert.equal(noLink().attributedPurchases.count, 21, "not the platform path: the attributed figure stays");
    // A purchase on the domain is E1's count, ticket link or not.
    assert.equal(noLink({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 2]) } }).state, "under_bar");
    // A ticket link on a site that is not a platform: nothing reaches, as before.
    assert.equal(readPurchases(input({ ticketSite: "Eventbrite", platform: null, stats: pixelHas })).state, "nothing_reaches");
    assert.equal(readPurchases(input({ ticketSite: "Eventbrite", platform: null, domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 }, stats: pixelHas })).state, "shared_domain");
    // No domain at all is not this state.
    assert.equal(noLink({ domain: { kind: "no_own_domain", cirqlinPage: true } }).state, "no_own_domain");
  });

  it("the whole state order, as the panel reads it: every state in its place, and the earlier wins where two apply", () => {
    const pixelHas = hosts(["2026-11-03", "www.skiddle.com", 844]);
    const onDomainToo = hosts(["2026-11-03", "locklead-newcastle.com", 3], ["2026-11-03", "www.skiddle.com", 844]);
    const shared: DomainClass = { kind: "shared_domain", domain: "julianfijma.com", others: 2 };
    // In the record's order, with design's two states where the rulings put them. Each row: what must hold, and the state.
    const order: [string, Partial<ReadPurchasesInput>, PurchaseRead["state"]][] = [
      ["1 · couldn't be read (the pixels)", { pixelError: "down", resolved: null, domain: { kind: "no_url" } }, "not_read"],
      ["2 · no pixel, even with no URL", { resolved: null, domain: { kind: "no_url" } }, "no_pixel"],
      ["3 · no page or ticket URL", { domain: { kind: "no_url" }, ticketSite: null, platform: null }, "no_url"],
      ["1 · couldn't be read (the CIRQLIN page), once a pixel and a link exist", { domain: { kind: "not_read", reason: "HTTP 503" } }, "not_read"],
      ["1 · couldn't be read (the breakdown), when a count decides", { stats: { error: "down" } }, "not_read"],
      ["4 · a shared domain a purchase has reached, platform link or not", { domain: shared, stats: { rows: hosts(["2026-11-03", "julianfijma.com", 3], ["2026-11-03", "skiddle.com", 844]) }, attributed: credited(40) }, "shared_domain"],
      ["4 · own domain, under the bar, before the platform path", { stats: { rows: onDomainToo }, attributed: credited(40) }, "under_bar"],
      ["4 · own domain, proposed", { stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 15]) }, attributed: credited(0) }, "proposed"],
      ["5 · platform: no purchases on the pixel, first, whatever is credited", { stats: { rows: [] }, attributed: credited(40) }, "platform_no_purchases"],
      ["5 · platform: pixel sells elsewhere, before the count", { stats: { rows: hosts(["2026-11-03", "universe.com", 844]) }, attributed: credited(40) }, "pixel_sells_elsewhere"],
      ["5 · platform: under the bar", { stats: { rows: pixelHas }, attributed: credited(14) }, "platform_under_bar"],
      ["5 · platform: proposed", { stats: { rows: pixelHas }, attributed: credited(15) }, "platform_proposed"],
      ["5 · platform, for a shared domain nothing reaches", { domain: shared, stats: { rows: pixelHas }, attributed: credited(15) }, "platform_proposed"],
      ["6 · no domain of its own, off the platform list", { domain: { kind: "no_own_domain", cirqlinPage: true }, ticketSite: "Eventbrite", platform: null, stats: { rows: pixelHas } }, "no_own_domain"],
      ["6 · no ticket URL, own domain, ahead of nothing reaches", { ticketSite: null, platform: null, stats: { rows: pixelHas } }, "no_ticket_url"],
      ["6 · no ticket URL, shared domain, ahead of shared domain", { domain: shared, ticketSite: null, platform: null, stats: { rows: pixelHas } }, "no_ticket_url"],
      ["6 · shared domain, ticket link off the list", { domain: shared, ticketSite: "Eventbrite", platform: null, stats: { rows: pixelHas } }, "shared_domain"],
      ["6 · nothing reaches, ticket link off the list", { ticketSite: "Eventbrite", platform: null, stats: { rows: pixelHas } }, "nothing_reaches"],
    ];
    for (const [label, overrides, expected] of order) assert.equal(readPurchases(platformInput(overrides)).state, expected, label);
    // Every state the panel can show is in the list.
    const all: PurchaseRead["state"][] = ["not_read", "no_pixel", "no_url", "shared_domain", "under_bar", "proposed", "platform_no_purchases", "pixel_sells_elsewhere", "platform_under_bar", "platform_proposed", "no_own_domain", "no_ticket_url", "nothing_reaches"];
    assert.deepEqual([...new Set(order.map(([, , state]) => state))].sort(), [...all].sort());
  });

  it("T1 / T5: the platform path takes in 'nothing reaches', 'no domain of its own' and the retired 'ticket site only'; a domain a purchase has reached wins", () => {
    const state = (overrides: Partial<ReadPurchasesInput>) => readPurchases(platformInput(overrides)).state;
    assert.equal(state({}), "platform_under_bar", "own domain, nothing on it: was 'nothing reaches'");
    assert.equal(state({ domain: { kind: "no_own_domain", cirqlinPage: true } }), "platform_under_bar", "was 'no domain of its own'");
    assert.equal(state({ domain: { kind: "ticket_site_only", ticketSite: "Skiddle" } }), "platform_under_bar", "was 'ticket site only'");
    assert.equal(state({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 } }), "platform_under_bar", "a shared domain nothing reaches");
    // T5: E1 first.
    const reached = hosts(["2026-11-03", "locklead-newcastle.com", 1], ["2026-11-03", "www.skiddle.com", 677]);
    assert.equal(state({ stats: { rows: reached }, attributed: credited(40) }), "under_bar", "one purchase on its own domain: E1's count, not the shared signal");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 18]) } }), "proposed");
    assert.equal(state({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 }, stats: { rows: hosts(["2026-11-03", "julianfijma.com", 3]) } }), "shared_domain");
    // The order's first three still come first.
    assert.equal(state({ pixelError: "down", resolved: null }), "not_read");
    assert.equal(state({ resolved: null }), "no_pixel");
    assert.equal(state({ domain: { kind: "no_url" } }), "no_url");
    assert.equal(state({ stats: { error: "(#17) User request limit reached" } }), "not_read", "the guard needs the breakdown");
    assert.equal(state({ domain: { kind: "not_read", reason: "the CIRQLIN page couldn't be read: HTTP 503" } }), "not_read");
    // No ticket link on a platform: unchanged.
    assert.equal(state({ platform: null }), "nothing_reaches");
  });
});

describe("ticket-platform purchases: the words (T4, F1)", () => {
  const lines = (overrides: Partial<ReadPurchasesInput>, linked = false) => purchaseWhy(readPurchases(platformInput(overrides)), linked, ONSALE_PHASE);

  it("F1: proposed, under the bar and pixel sells elsewhere, at 1280 and 393, in the record's words", () => {
    const proposed = lines({ attributed: credited(17) });
    assert.equal(proposed.purchase, "Purchase campaign proposed — 17 purchases attributed to these ads in 14 days, on pixel …2763. The signal is shared: Skiddle sells every show on this pixel, so Meta optimises for buyers of any of them.");
    assert.equal(proposed.purchaseNarrow, "Purchase campaign: 17 attributed in 14 days · shared on Skiddle.");
    assert.equal(proposed.moves, "Budget moves can cross campaigns on cost per attributed purchase.", "T3: never 'cost per sale'");
    const under = lines({});
    assert.equal(under.purchase, "Purchase campaign not proposed — 6 purchases attributed to these ads in 14 days, under 15. The signal is shared: Skiddle sells every show on this pixel.");
    assert.equal(under.purchaseNarrow, "No Purchase campaign: 6 attributed in 14 days, under 15 · shared on Skiddle.");
    assert.equal(under.moves, "Budget moves stay inside each campaign.");
    assert.equal(lines({ attributed: credited(1) }).purchase, "Purchase campaign not proposed — 1 purchase attributed to these ads in 14 days, under 15. The signal is shared: Skiddle sells every show on this pixel.");
    const elsewhere = lines({ attributed: credited(40), stats: { rows: hosts(["2026-11-03", "universe.com", 810], ["2026-11-03", "skiddle.com", 26]) } });
    assert.equal(elsewhere.purchase, "Purchase campaign not proposed — most of this pixel's purchases are on universe.com, not Skiddle where this show sells, so optimising on them would chase another site's buyers.");
    assert.equal(elsewhere.purchaseNarrow, "No Purchase campaign: this pixel's purchases are mostly on universe.com.");
    assert.equal(elsewhere.moves, "Budget moves stay inside each campaign.");
  });

  it("F1: on sale under 14 days, 'in 14 days' becomes 'since {d Mon}' at both widths", () => {
    const under = lines({ attributed: credited(6, "2026-11-06", true) });
    assert.equal(under.purchase, "Purchase campaign not proposed — 6 purchases attributed to these ads since 6 Nov, under 15. The signal is shared: Skiddle sells every show on this pixel.");
    assert.equal(under.purchaseNarrow, "No Purchase campaign: 6 attributed since 6 Nov, under 15 · shared on Skiddle.");
    const proposed = lines({ attributed: credited(17, "2026-11-06", true) });
    assert.equal(proposed.purchase, "Purchase campaign proposed — 17 purchases attributed to these ads since 6 Nov, on pixel …2763. The signal is shared: Skiddle sells every show on this pixel, so Meta optimises for buyers of any of them.");
    assert.equal(proposed.purchaseNarrow, "Purchase campaign: 17 attributed since 6 Nov · shared on Skiddle.");
  });

  it("T4: the platform's share sits under each platform state in place of the attributed line; own-domain states keep the attributed line and have no share line", () => {
    for (const overrides of [{}, { attributed: credited(17) }]) {
      const said = lines(overrides);
      assert.equal(said.context, "Skiddle took 81 % of this pixel's 836 purchases in 28 days.");
      assert.equal(said.contextNarrow, "Skiddle: 81 % of the pixel's purchases in 28 days.");
      assert.deepEqual([said.attributed, said.attributedNarrow], [null, null], "there the attributed figure is the count");
    }
    const universe = lines({ platform: "Universe", ticketSite: "Universe", stats: { rows: hosts(["2026-11-03", "skiddle.com", 819], ["2026-11-03", "universe.com", 17]) } });
    assert.equal(universe.purchase, "Purchase campaign not proposed — most of this pixel's purchases are on skiddle.com, not Universe where this show sells, so optimising on them would chase another site's buyers.");
    assert.equal(universe.context, "Universe took 2 % of this pixel's 836 purchases in 28 days.");
    assert.equal(universe.contextNarrow, "Universe: 2 % of the pixel's purchases in 28 days.");
    assert.equal(lines({ stats: { rows: hosts(["2026-11-03", "skiddle.com", 1]) } }).context, "Skiddle took 100 % of this pixel's 1 purchase in 28 days.");
    // Off the platform path nothing changes: the attributed line, no share line.
    const own = purchaseWhy(readPurchases(input({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 6]) } })), false, ONSALE_PHASE);
    assert.deepEqual([own.context, own.contextNarrow], [null, null]);
    assert.equal(own.attributed, "Attributed to these ads: 21 purchases in 14 days, any show on this pixel.");
    // T6: the read that failed keeps the attributed line under it.
    const failed = purchaseWhy(readPurchases(platformInput({ stats: { error: "down" } })), false, ONSALE_PHASE);
    assert.equal(failed.purchase, "Purchase campaign not proposed — this show's purchases couldn't be read this run. The next run tries again.");
    assert.equal(failed.attributed, "Attributed to these ads: 21 purchases in 14 days, any show on this pixel.");
    assert.equal(failed.context, null);
  });

  it("design, 13 Nov: the two new states' sentences at 1280 and 393, and what sits under each", () => {
    // A pixel with no purchases: the platform is named; no context line and no attributed line under it.
    for (const [platform, site] of [["Skiddle", "Skiddle"], ["Universe", "Universe"], ["See Tickets", "See Tickets"]] as const) {
      const empty = lines({ platform, ticketSite: site, stats: { rows: [] }, attributed: credited(6) });
      assert.equal(empty.purchase, `Purchase campaign not proposed — this pixel has seen no purchases in 28 days, so there's nothing for Meta to optimise on. Check that ${platform} sends its purchases to this pixel.`);
      assert.equal(empty.purchaseNarrow, "No Purchase campaign: no purchases on this pixel in 28 days.");
      assert.equal(empty.moves, "Budget moves stay inside each campaign.");
      assert.deepEqual([empty.context, empty.contextNarrow, empty.attributed, empty.attributedNarrow], [null, null, null, null]);
      assert.equal(`${empty.purchase} ${empty.moves}`, `Purchase campaign not proposed — this pixel has seen no purchases in 28 days, so there's nothing for Meta to optimise on. Check that ${platform} sends its purchases to this pixel. Budget moves stay inside each campaign.`, "the 1280 line as the panel draws it");
    }
    // No ticket URL stored: not the platform path, so the attributed line stays and there is no context line.
    const noLink = purchaseWhy(readPurchases(input({ ticketSite: null, platform: null, stats: { rows: hosts(["2026-11-03", "www.skiddle.com", 844]) } })), false, ONSALE_PHASE);
    assert.equal(noLink.purchase, "Purchase campaign not proposed — no ticket URL is stored for this show, so its sales can't be matched to a ticket platform. Add the ticket link on the event page.");
    assert.equal(noLink.purchaseNarrow, "No Purchase campaign: no ticket URL stored.");
    assert.equal(noLink.moves, "Budget moves stay inside each campaign.");
    assert.equal(noLink.attributed, "Attributed to these ads: 21 purchases in 14 days, any show on this pixel.");
    assert.equal(noLink.attributedNarrow, "21 attributed purchases in 14 days, any show.");
    assert.deepEqual([noLink.context, noLink.contextNarrow], [null, null]);
    assert.equal(noLink.ticketing, UNLINKED_TICKETING);
  });

  it("the shared signal never blocks and never gets a ticketing check; unlinked ticketing is still said; the setup line is unchanged", () => {
    const linked = lines({ ticketsSold14: 40, attributed: credited(17) }, true);
    assert.equal(linked.ticketing, null, "the check compares a domain count, and there is none here");
    assert.equal(lines({}, false).ticketing, UNLINKED_TICKETING);
    assert.deepEqual(lines({}).pixel, ["Ads optimise on pixel …2763 (NX Live Skiddle); the client's stored pixel is …4565. Counts use …2763."]);
    const proposal = buildProposal({ ...proposalCampaign(readPurchases(platformInput({ attributed: credited(17) }))) }, ONSALE_PHASE);
    assert.deepEqual(proposal.blockers.map((blocker) => blocker.kind), [], "a budget is set: nothing blocks");
    assert.ok(!proposal.lines.some((line) => /purchase/i.test(`${line.kind} ${line.ruleId} ${line.title}`)), "HT1–HT2 read and say; no Purchase campaign line or cross-campaign move is built (HT3, HT4)");
    const slack = slackMessage({ proposalId: "p1", eventName: "Locklead", eventCode: "NX26-LOCKLEAD", eventId: "e1", campaignKey: "[NX26-LOCKLEAD] On Sale", plan: proposalCampaign(unreadPurchases(0, ONSALE_PHASE)).plan, mode: "shadow", proposal }, "https://app.example");
    assert.match(slack.text, /Purchase campaign proposed — 17 purchases attributed to these ads in 14 days, on pixel …2763\./);
    assert.match(slack.text, /Skiddle took 81 % of this pixel's 836 purchases in 28 days\./);
    assert.doesNotMatch(slack.text, /any show on this pixel/, "the attributed line is not repeated");
    const stored = inputsSnapshot(proposalCampaign(readPurchases(platformInput({ attributed: credited(17) })))) as { purchases: { state: string; platform: string; platformShare: { share: number }; attributedOnPixel: { count: number } } };
    assert.deepEqual([stored.purchases.state, stored.purchases.platform, stored.purchases.attributedOnPixel.count, Math.round(stored.purchases.platformShare.share * 100)], ["platform_proposed", "Skiddle", 17, 81], "the evidence keeps the count, the platform and its share");
  });
});

// ── The reads ────────────────────────────────────────────────────────────────

type GraphCall = { kind: "get" | "multi"; path: string; params: Record<string, string> };

function fakeGraph(handlers: { multi?: (params: Record<string, string>) => unknown; get?: (path: string, params: Record<string, string>) => unknown }): { graph: RefreshGraph; calls: GraphCall[] } {
  const calls: GraphCall[] = [];
  return {
    calls,
    graph: {
      graphGet: async (path, params) => {
        calls.push({ kind: "get", path, params });
        return handlers.get ? handlers.get(path, params) : { data: [] };
      },
      multiGet: async (path, params) => {
        calls.push({ kind: "multi", path, params });
        return handlers.multi ? handlers.multi(params) : {};
      },
    },
  };
}

describe("per-event purchases: the Meta and CIRQLIN reads", () => {
  it("ad-set pixels: one batch per 50 ids, null for an ad set with no pixel, absent for one Meta did not return, the error kept", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => `s${index}`);
    const { graph, calls } = fakeGraph({
      multi: (params) => Object.fromEntries(params.ids.split(",").filter((id) => id !== "s2").map((id) => [id, id === "s1" ? { promoted_object: { custom_event_type: "LEAD" } } : { promoted_object: { pixel_id: NX_PIXEL } }])),
    });
    const result = await fetchAdSetPixels(graph.multiGet, ids);
    assert.equal(result.calls, 2);
    assert.deepEqual(calls.map((call) => [call.params.fields, call.params.ids.split(",").length]), [["promoted_object", 50], ["promoted_object", 1]]);
    assert.equal(result.pixels.get("s0"), NX_PIXEL);
    assert.equal(result.pixels.get("s1"), null);
    assert.equal(result.pixels.has("s2"), false);
    assert.equal(result.error, null);
    const failed = await fetchAdSetPixels(async () => Promise.reject(new Error("(#17) User request limit reached")), ["a"]);
    assert.deepEqual([failed.calls, failed.pixels.size, failed.error], [1, 0, "(#17) User request limit reached"]);
  });

  it("the domain breakdown: Purchase by host, hourly buckets summed to their own day, paged on the cursor until a page is empty", async () => {
    const pages: Record<string, unknown> = {
      "": {
        data: [
          { start_time: "2026-11-03T10:00:00+0000", aggregation: "host", data: [{ value: "www.skiddle.com", count: 6 }, { value: "locklead-newcastle.com", count: 1 }] },
          { start_time: "2026-11-03T11:00:00+0000", aggregation: "host", data: [{ value: "www.skiddle.com", count: "4" }] },
          { start_time: "2026-10-31T23:00:00+0000", aggregation: "host", data: [{ value: "WWW.Locklead-Newcastle.com", count: 2 }] },
        ],
        paging: { cursors: { after: "c1" }, next: "https://graph.facebook.com/…" },
      },
      c1: { data: [{ start_time: "2026-10-20T09:00:00+0100", data: [{ value: "www.skiddle.com", count: 3 }] }], paging: { cursors: { after: "c2" }, next: "https://graph.facebook.com/…" } },
      c2: { data: [] },
    };
    const { graph, calls } = fakeGraph({ get: (_path, params) => pages[params.after ?? ""] });
    const now = new Date("2026-11-12T08:00:00Z");
    const result = await fetchPurchaseHosts(graph.graphGet, NX_PIXEL, now, 28);
    assert.equal(result.calls, 3);
    assert.equal(result.error, null);
    assert.deepEqual(calls.map((call) => [call.path, call.params.aggregation, call.params.event, call.params.after ?? null]), [
      [`/${NX_PIXEL}/stats`, "host", "Purchase", null],
      [`/${NX_PIXEL}/stats`, "host", "Purchase", "c1"],
      [`/${NX_PIXEL}/stats`, "host", "Purchase", "c2"],
    ]);
    const end = Math.floor(now.getTime() / 1000);
    assert.deepEqual([calls[0]!.params.start_time, calls[0]!.params.end_time], [String(end - 28 * 86_400), String(end)]);
    assert.deepEqual(
      [...result.rows].sort((a, b) => `${a.day}${a.host}`.localeCompare(`${b.day}${b.host}`)),
      [
        { day: "2026-10-20", host: "skiddle.com", count: 3 },
        { day: "2026-10-31", host: "locklead-newcastle.com", count: 2 },
        { day: "2026-11-03", host: "locklead-newcastle.com", count: 1 },
        { day: "2026-11-03", host: "skiddle.com", count: 10 },
      ],
    );
    const down = await fetchPurchaseHosts(async () => Promise.reject(new Error("(#100) Missing permissions")), NX_PIXEL, now, 28);
    assert.deepEqual([down.calls, down.rows.length, down.error], [1, 0, "(#100) Missing permissions"]);
  });

  it("the CIRQLIN page: its canonical link is the custom domain, crqln.com means none, a failed read is not 'none'", async () => {
    assert.equal(canonicalHost('<head><link rel="canonical" href="https://fever105-sheffield.com"/><meta property="og:url" content="https://crqln.com/x"/></head>'), "fever105-sheffield.com");
    assert.equal(canonicalHost('<meta property="og:url" content="https://www.kream-bristol.com/"/>'), "kream-bristol.com");
    assert.equal(canonicalHost("<html></html>"), null);
    const page = (html: string, status = 200) => (async () => new Response(html, { status })) as unknown as typeof fetch;
    assert.deepEqual(await resolveCirqlinDomain("https://crqln.com/l/fever105-sheffield", page('<link rel="canonical" href="https://fever105-sheffield.com"/>')), { ok: true, domain: "fever105-sheffield.com" });
    assert.deepEqual(await resolveCirqlinDomain("https://crqln.com/l/puzzle-4th-birthday", page('<link rel="canonical" href="https://crqln.com/puzzle-4th-birthday"/>')), { ok: true, domain: null });
    assert.deepEqual(await resolveCirqlinDomain("https://crqln.com/l/gone", page("not found", 404)), { ok: false, reason: "HTTP 404" });
    assert.deepEqual(await resolveCirqlinDomain("https://crqln.com/l/x", page("<html></html>")), { ok: false, reason: "no canonical link" });
    assert.deepEqual(await resolveCirqlinDomain("https://crqln.com/l/x", (async () => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch), { ok: false, reason: "socket hang up" });
  });
});

// ── HE1 end to end ───────────────────────────────────────────────────────────

const PARABLE_PIXEL = "1554272259038141";

const EVENTS = [
  { ...LOCKLEAD, event_code: "NX26-LOCKLEAD", client_id: "brixton", event_date: "2026-12-11", presale_at: null, general_sale_at: "2026-11-06T10:00:00Z" },
  { ...BDAY, event_code: "P26-BDAY", client_id: "puzzle", event_date: "2026-12-27", presale_at: "2026-10-21T09:00:00Z", general_sale_at: "2026-10-30T09:00:00Z" },
  { ...FEVER105, event_code: "ES26-FEVER105", client_id: "brixton", event_date: "2026-12-06", presale_at: null, general_sale_at: "2026-10-09T09:00:00Z" },
  { ...MALLGRAB, event_code: "ES26-MALLGRAB", client_id: "brixton", event_date: "2026-12-04" },
  { ...TRANCOSO, event_code: "DHB26-TRANCOSO", client_id: "dhb", event_date: "2026-12-27" },
  { ...JULIAN, event_code: "NX27-JULIANFIJMA", client_id: "brixton", event_date: "2027-03-19", presale_at: "2026-11-03T10:00:00Z", general_sale_at: "2026-11-04T10:00:00Z" },
  { ...PARABLE, event_code: "20261121CSA", client_id: "parable", event_date: "2026-11-21" },
  { id: "rudimental", signup_url: "https://rudimental-newcastle.com", ticket_url: null, event_code: "NX26-RUDIMENTAL", client_id: "brixton", event_date: "2026-12-12", presale_at: null, general_sale_at: "2026-10-01T09:00:00Z" },
];

/** One delivering ad set per show, with the pixel its ads really use; TRANCOSO's is a traffic ad set with none. */
const AD_SETS: Record<string, { event: string; pixel: string | null }> = {
  "as-locklead": { event: "locklead", pixel: NX_PIXEL },
  "as-bday": { event: "bday", pixel: PUZZLE_PIXEL },
  "as-fever": { event: "fever", pixel: STUDIOS_PIXEL },
  "as-mallgrab": { event: "mallgrab", pixel: STUDIOS_PIXEL },
  "as-trancoso": { event: "trancoso", pixel: null },
  "as-julian": { event: "julian", pixel: NX_PIXEL },
  "as-csa": { event: "csa", pixel: PARABLE_PIXEL },
  "as-rudimental": { event: "rudimental", pixel: NX_PIXEL },
};

/** Purchases Meta credited on 10 Nov (after every show's on-sale date) and on 3 Nov (before LOCKLEAD's 6 Nov). */
const CREDITED: Record<string, [onThe10th: number, onThe3rd: number]> = { locklead: [8, 13], bday: [1, 0], julian: [5, 19] };

function rawInsights() {
  const rows = Object.entries(AD_SETS).flatMap(([adsetId, set]) => {
    const [late, early] = CREDITED[set.event] ?? [0, 0];
    const day = (date: string, spend: number, purchases: number) => ({ meta_ad_id: `ad-${adsetId}`, meta_adset_id: adsetId, campaign_name: `[${set.event}] On Sale`, ad_account_id: null, date, spend, purchases });
    return [
      day("2026-11-10", 40, late),
      day("2026-11-03", 20, early),
      // Outside the 14 days to the window end: neither spend nor attributed purchases count there.
      day("2026-10-20", 999, 50),
      day("2026-11-12", 999, 50),
    ];
  });
  const launchedAdSets = new Map(Object.entries(AD_SETS).map(([adsetId, set]) => [adsetId, { clientId: null, eventId: set.event }]));
  return { rows, context: { launchedAds: new Map(), launchedAdSets, codedEvents: [] } };
}

function purchaseDb(tickets: { event_id: string; date: string; tickets_sold: number }[] = []) {
  return fakeDb((call) => {
    const columns = String(op(call, "select")?.[0] ?? "");
    if (call.table === "clients" && columns.includes("meta_pixel_id")) return { data: [{ id: "brixton", meta_pixel_id: BRIXTON_PIXEL }, { id: "puzzle", meta_pixel_id: PUZZLE_PIXEL }, { id: "dhb", meta_pixel_id: "361462699910737" }, { id: "parable", meta_pixel_id: PARABLE_PIXEL }], error: null };
    if (call.table === "events") return { data: EVENTS.map((event) => ({ id: event.id, signup_url: event.signup_url, ticket_url: event.ticket_url, client_id: event.client_id })), error: null };
    if (call.table === "event_daily_rollups") return { data: tickets, error: null };
    return { data: [], error: null };
  });
}

const cirqlinFetch = (async (url: string) => {
  const html = String(url).includes("fever105") ? '<link rel="canonical" href="https://fever105-sheffield.com"/>' : '<link rel="canonical" href="https://crqln.com/puzzle-4th-birthday"/>';
  return new Response(html, { status: 200 });
}) as unknown as typeof fetch;

const bucket = (host: string, count: number) => ({ data: [{ start_time: "2026-11-03T10:00:00+0000", data: [{ value: host, count }] }] });
/** The NX and Puzzle pixels sell on Skiddle; the Electric Studios pixel on Universe; Parable's on RA. */
const PIXEL_STATS: Record<string, unknown> = { [NX_PIXEL]: bucket("www.skiddle.com", 844), [PUZZLE_PIXEL]: bucket("www.skiddle.com", 32), [STUDIOS_PIXEL]: bucket("www.universe.com", 1316), [PARABLE_PIXEL]: bucket("ra.co", 255) };

function liveGraph(statsFor: Record<string, unknown> = {}) {
  return fakeGraph({
    multi: (params) =>
      params.fields === "name"
        ? Object.fromEntries(params.ids.split(",").map((id) => [id, { name: id === NX_PIXEL ? "NX Live Skiddle" : "Electric Studios Universe Pixel" }]))
        : Object.fromEntries(params.ids.split(",").map((id) => [id, AD_SETS[id]!.pixel ? { promoted_object: { pixel_id: AD_SETS[id]!.pixel } } : {}])),
    get: (path) => statsFor[path.split("/")[1]!] ?? PIXEL_STATS[path.split("/")[1]!] ?? { data: [] },
  });
}

describe("per-event and ticket-platform purchases: the read across a run (HE1, HT1)", () => {
  it("HT1's acceptance cases, on the shows' own links, pixels and on-sale dates", async () => {
    const { db, calls } = purchaseDb();
    const { graph, calls: graphCalls } = liveGraph();
    const result = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch, now: new Date("2026-11-12T08:00:00Z") });
    const read = (id: string) => result.reads.get(id)!;
    const said = (id: string) => purchaseWhy(read(id), false, ONSALE_PHASE);

    // NX shows still resolve to 645185673672763 and flag the mismatch (E4 stands).
    assert.deepEqual(read("locklead").pixel, { id: NX_PIXEL, source: "ad_sets", spendShare: 1, stored: BRIXTON_PIXEL, matches: false });
    assert.deepEqual(said("locklead").pixel, ["Ads optimise on pixel …2763 (NX Live Skiddle); the client's stored pixel is …4565. Counts use …2763."]);

    // NX26-LOCKLEAD takes the platform path, not "nothing reaches": 8 credited since 6 Nov, not the 21 any-show figure.
    assert.deepEqual([read("locklead").state, read("locklead").domain, read("locklead").platform], ["platform_under_bar", "locklead-newcastle.com", "Skiddle"]);
    assert.deepEqual(read("locklead").onDomain, { d14: 0, d28: 0, history: 0 });
    assert.deepEqual([read("locklead").attributedOnPixel!.count, read("locklead").attributedOnPixel!.fromDay, read("locklead").attributedOnPixel!.sinceOnSale], [8, "2026-11-06", true]);
    assert.deepEqual(read("locklead").attributedOnPixel!.total, { fromDay: "2026-11-06", purchases: 8, spend: 40, byCampaign: [{ campaign: "[locklead] On Sale", purchases: 8, spend: 40 }] });
    assert.deepEqual(read("locklead").attributedPurchases, { count: 21, scope: "any_show_on_pixel" }, "C2's figure is still the plain 14 days, labelled any show");
    assert.deepEqual(read("locklead").platformShare, { purchases: 844, pixelPurchases: 844, share: 1, elsewhereHost: null });
    assert.equal(said("locklead").purchase, "Purchase campaign not proposed — 8 purchases attributed to these ads since 6 Nov, under 15. The signal is shared: Skiddle sells every show on this pixel.");
    assert.equal(said("locklead").context, "Skiddle took 100 % of this pixel's 844 purchases in 28 days.");

    // NX27-JULIANFIJMA reads "pixel sells elsewhere": it sells on Universe, its ads' pixel sells on skiddle.com.
    assert.deepEqual([read("julian").state, read("julian").platform, read("julian").platformShare!.share, read("julian").platformShare!.elsewhereHost], ["pixel_sells_elsewhere", "Universe", 0, "skiddle.com"]);
    assert.deepEqual([read("julian").attributedOnPixel!.count, read("julian").attributedOnPixel!.fromDay], [24, "2026-11-03"], "presale 3 Nov is its first on-sale date");
    assert.equal(said("julian").purchase, "Purchase campaign not proposed — most of this pixel's purchases are on skiddle.com, not Universe where this show sells, so optimising on them would chase another site's buyers.");
    assert.equal(said("julian").context, "Universe took 0 % of this pixel's 844 purchases in 28 days.");

    // ES26-FEVER105 still resolves to fever105-sheffield.com through its CIRQLIN page; its pixel guard names universe.com.
    assert.deepEqual([read("fever").domain, read("fever").domainVia, read("fever").state, read("fever").platformShare!.elsewhereHost], ["fever105-sheffield.com", "cirqlin_custom_domain", "pixel_sells_elsewhere", "universe.com"]);
    assert.equal(said("fever").purchaseNarrow, "No Purchase campaign: this pixel's purchases are mostly on universe.com.");

    // P26-BDAY takes the platform path (Skiddle), not "no domain of its own"; on sale since 21 Oct, so the count is the 14 days.
    assert.deepEqual([read("bday").state, read("bday").platform, read("bday").cirqlinPage, read("bday").pixel!.matches], ["platform_under_bar", "Skiddle", true, true]);
    assert.deepEqual([read("bday").attributedOnPixel!.count, read("bday").attributedOnPixel!.fromDay, read("bday").attributedOnPixel!.sinceOnSale, read("bday").attributedOnPixel!.total.fromDay], [1, "2026-10-29", false, "2026-10-21"]);
    assert.equal(said("bday").purchaseNarrow, "No Purchase campaign: 1 attributed in 14 days, under 15 · shared on Skiddle.");
    assert.deepEqual(said("bday").pixel, []);

    // The retired "ticket site only": a show with only a Skiddle link, on a pixel that sells on Universe.
    assert.deepEqual([read("mallgrab").state, read("mallgrab").platform], ["pixel_sells_elsewhere", "Skiddle"]);
    // No pixel and no URL still come first; a show with no ticket URL is unchanged.
    assert.deepEqual([read("trancoso").state, read("trancoso").pixel, read("trancoso").platform], ["no_pixel", null, "Ingresse"]);
    assert.deepEqual([read("csa").state, read("csa").platform, read("csa").platformShare], ["no_url", null, null]);
    // Its own domain, nothing on it, and no ticket URL stored: it says so, and what to do.
    assert.deepEqual([read("rudimental").state, read("rudimental").platform, read("rudimental").landsOn], ["no_ticket_url", null, null]);
    assert.equal(said("rudimental").purchaseNarrow, "No Purchase campaign: no ticket URL stored.");

    // Reads only, counted: one ad-set batch, the breakdown of the three pixels a domain or a platform link counts on, one names batch.
    assert.equal(result.metaCalls, graphCalls.length);
    assert.deepEqual(graphCalls.map((call) => (call.kind === "multi" ? `batch:${call.params.fields}` : call.path)).sort(), ["batch:name", "batch:promoted_object", `/${NX_PIXEL}/stats`, `/${PUZZLE_PIXEL}/stats`, `/${STUDIOS_PIXEL}/stats`].sort());
    assert.equal(result.cirqlinReads, 2, "one page read per crqln.com link");
    assert.ok(calls.every((call) => !op(call, "insert") && !op(call, "update") && !op(call, "upsert") && !op(call, "delete")), "nothing is written: clients.meta_pixel_id least of all");
  });

  it("T5: a purchase on the own domain puts the show back on E1's count, with the ticketing check when the rollups have sales", async () => {
    const { db } = purchaseDb([
      { event_id: "locklead", date: "2026-11-03", tickets_sold: 30 },
      { event_id: "locklead", date: "2026-11-10", tickets_sold: 10 },
      { event_id: "locklead", date: "2026-10-20", tickets_sold: 500 },
    ]);
    const stats = { [NX_PIXEL]: { data: [{ start_time: "2026-11-04T20:00:00+0000", data: [{ value: "www.locklead-newcastle.com", count: 18 }, { value: "www.skiddle.com", count: 400 }] }] } };
    const { graph } = liveGraph(stats);
    const result = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch, now: new Date("2026-11-12T08:00:00Z") });
    const read = result.reads.get("locklead")!;
    assert.deepEqual([read.state, read.onDomain!.d14, read.ticketsSold14, read.platformShare], ["proposed", 18, 40, null]);
    assert.equal(purchaseWhy(read, true, ONSALE_PHASE).ticketing, "Ticketing: 40 sold in 14 days · the pixel saw 18 on locklead-newcastle.com (45 % of sales).");
    assert.equal(purchaseWhy(read, true, ONSALE_PHASE).purchase, "Purchase campaign proposed — 18 purchases on locklead-newcastle.com in 14 days.");
    // Rudimental, on the same pixel with no ticket link, reads no ticket URL stored.
    assert.equal(result.reads.get("rudimental")!.state, "no_ticket_url");
  });

  it("without Meta, or when Meta fails, every show says it was not read — and no call is made that could not be", async () => {
    const { db } = purchaseDb();
    const none = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph: null, graphReason: "META_ACCESS_TOKEN is not configured", fetchImpl: cirqlinFetch });
    assert.equal(none.metaCalls, 0);
    assert.ok([...none.reads.values()].every((read) => read.state === "not_read" && read.notRead === "META_ACCESS_TOKEN is not configured"));
    const { graph, calls } = fakeGraph({ multi: () => Promise.reject(new Error("(#17) User request limit reached")) });
    const limited = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch });
    assert.equal(calls.length, 1, "the batch failed once: no stats read, no names read");
    assert.equal(limited.metaCalls, 1);
    assert.ok([...limited.reads.values()].every((read) => read.state === "not_read"));
    assert.match(limited.notes.join(" "), /User request limit reached/);
  });

  it("everyPixel reads the breakdown of every resolved pixel for the table; the run reads only what a domain or a platform link needs", async () => {
    const { db } = purchaseDb();
    const { graph, calls } = liveGraph();
    const result = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch, everyPixel: true });
    assert.deepEqual(calls.filter((call) => call.kind === "get").map((call) => call.path).sort(), [`/${NX_PIXEL}/stats`, `/${PARABLE_PIXEL}/stats`, `/${PUZZLE_PIXEL}/stats`, `/${STUDIOS_PIXEL}/stats`].sort());
    assert.equal(result.reads.get("csa")!.pixelWide!.history, 255);
    assert.equal(result.reads.get("csa")!.state, "no_url", "the pixel-wide figure is context: it never changes the state");
  });
});

function proposalCampaign(purchases: PurchaseRead): CampaignInput {
  return {
    eventId: "e1",
    eventCode: "NX26-LOCKLEAD",
    eventName: "Locklead",
    campaignKey: "[NX26-LOCKLEAD] On Sale",
    campaignIds: ["c1"],
    onSaleDay: "2026-11-06",
    plan: planRun({ day: "2026-11-12", eventDate: "2026-12-11", config: ONSALE_PHASE, shadow: true }),
    resultEvent: "initiate_checkout",
    weekSpend: 200,
    weekResults: 26,
    totalSpend: 300,
    totalResults: 40,
    totalFirstDay: "2026-11-06",
    ads: [],
    adSets: [],
    clusters: [],
    supply: [],
    claims: [],
    budgetGbp: 3000,
    spendToDateGbp: 300,
    ticketingLinked: false,
    ticketingProvider: null,
    last14: { ic: 96, purchases: 21, lpv: 300 },
    sinceOnSale: { ic: 93, purchases: 21, fromDay: "2026-11-06" },
    purchases,
  };
}

describe("per-event purchases: a failed read's reason goes to the evidence and the ops log, never the panel", () => {
  const REASON = "the ad sets' pixels couldn't be read: (#17) User request limit reached";
  const failed = () => readPurchases(input({ pixelError: REASON, resolved: null }));
  const campaignInput = proposalCampaign;

  it("the proposal's why, the stored panel line and the Slack post say the fixed sentence and nothing of the reason", () => {
    const proposal = buildProposal(campaignInput(failed()), ONSALE_PHASE);
    assert.equal(proposal.why.purchase, "Purchase campaign not proposed — this show's purchases couldn't be read this run. The next run tries again.");
    assert.equal(proposal.why.purchaseNarrow, "No Purchase campaign: purchases not read this run.");
    const shown = JSON.stringify({ why: proposal.why, blockers: proposal.blockers, notes: proposal.notes, watch: proposal.watch, lines: proposal.lines.map((line) => [line.title, line.detail, line.writeText, line.narrow, line.blockedReason]) });
    assert.ok(!shown.includes("#17") && !shown.includes("User request limit") && !shown.includes("couldn't be read:"), "everything the panel reads is clean");
    const slack = slackMessage({ proposalId: "p1", eventName: "Locklead", eventCode: "NX26-LOCKLEAD", eventId: "e1", campaignKey: "[NX26-LOCKLEAD] On Sale", plan: campaignInput(failed()).plan, mode: "shadow", proposal }, "https://app.example");
    assert.ok(!JSON.stringify(slack).includes("#17") && !JSON.stringify(slack).includes("User request limit"), "nor does Slack");
    assert.match(slack.text, /couldn't be read this run\. The next run tries again\./);
    // The panel draws `why` and the lines only: it has no path to the read or its reason.
    for (const file of ["components/dashboard/events/onsale-refresh-panel.tsx", "components/dashboard/events/onsale-refresh-frame-mount.tsx", "lib/onsale-refresh/read.ts", "lib/onsale-refresh/slack.ts"]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /notRead|inputs\b.*purchases/, `${file} never reads the reason`);
    }
  });

  it("the reason is in the stored evidence and in the run's ops log", () => {
    const snapshot = inputsSnapshot(campaignInput(failed())) as { purchases: { state: string; notRead: string } };
    assert.deepEqual([snapshot.purchases.state, snapshot.purchases.notRead], ["not_read", REASON], "evidence: onsale_refresh_proposals.inputs.purchases.notRead");
    const log = refreshRunLog({ events: 2, proposals: [], purchaseReads: [{ eventId: "e1", eventCode: "NX26-LOCKLEAD", read: failed() }, { eventId: "e2", eventCode: "P26-BDAY", read: readPurchases(input({ domain: { kind: "no_own_domain", cirqlinPage: true } })) }] });
    assert.deepEqual(log.detail.purchasesNotRead, [{ event: "NX26-LOCKLEAD", reason: REASON }], "ops log: the cron run's detail names the show and the reason; a show that was read is not listed");
  });

  it("a run whose Meta read fails stores the fixed sentence, keeps the reason in evidence, and logs it", async () => {
    const event = { id: "locklead", name: "Locklead", event_code: "NX26-LOCKLEAD", event_date: "2026-12-11", general_sale_at: "2026-11-06T10:00:00Z", status: "on_sale", client_id: "brixton", budget_marketing: 3000, drive_folder_id: null, signup_url: LOCKLEAD.signup_url, ticket_url: LOCKLEAD.ticket_url };
    const { db, calls } = fakeDb((call) => {
      if (call.table === "onsale_refresh_proposals" && op(call, "upsert")) return { data: { id: "p1" }, error: null };
      return { data: [], error: null };
    });
    const { graph } = fakeGraph({ multi: () => Promise.reject(new Error("(#17) User request limit reached")) });
    const warned: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => void warned.push(args.join(" "));
    let result: Awaited<ReturnType<typeof runOnsaleRefresh>>;
    try {
      result = await runOnsaleRefresh({
        env: { ENABLE_ONSALE_REFRESH: "1" },
        db,
        shadowDay: "2026-11-12",
        userId: "op",
        graph,
        fetchImpl: cirqlinFetch,
        loaders: {
          events: async () => [event],
          insights: async () => rawInsights() as never,
          aux: async () => ({ scores: [], clusters: [], launchedAdSets: [], warnings: [], ticketing: [], driveFolders: [], renderDriveIds: new Set<string>() }),
          inputs: async (args) => ({ event: args.event, plan: planRun({ day: "2026-11-12", eventDate: "2026-12-11", config: ONSALE_PHASE, shadow: true }), campaigns: [{ ...campaignInput(args.purchases!), adSets: [{ adsetId: "as-locklead", adsetIds: ["as-locklead"], name: "Retargeting", firstDay: "2026-11-06", lastDay: "2026-11-11", weekSpend: 40, weekResults: 5, totalSpend: 100, totalResults: 12, delivering: true }] }], driveCalls: 0, driveReason: null }),
        },
      });
    } finally {
      console.warn = warn;
    }
    if ("skippedReason" in result) throw new Error("enabled");
    const upsert = calls.find((call) => call.table === "onsale_refresh_proposals" && op(call, "upsert"))!;
    const row = op(upsert, "upsert")![0] as { why: Record<string, unknown>; inputs: { purchases: { notRead: string; state: string } } };
    assert.equal(row.why.purchase, "Purchase campaign not proposed — this show's purchases couldn't be read this run. The next run tries again.");
    assert.ok(!JSON.stringify(row.why).includes("#17"), "the stored why is what the panel shows");
    assert.equal(row.inputs.purchases.state, "not_read");
    assert.match(row.inputs.purchases.notRead, /\(#17\) User request limit reached/, "the stored evidence has the reason");
    assert.ok(warned.some((line) => /purchases not read event=NX26-LOCKLEAD reason=.*#17/.test(line)), "the run log names the show and the reason");
    assert.match(JSON.stringify(refreshRunLog(result as unknown as Record<string, unknown>).detail.purchasesNotRead), /NX26-LOCKLEAD.*#17/);
  });
});

describe("per-event purchases: Slack and the guards", () => {
  it("E4: the pixel line goes to ads_automation once per event and pixel pair", () => {
    const line = "Ads optimise on pixel …2763 (NX Live Skiddle); the client's stored pixel is …4565. Counts use …2763.";
    const message = pixelSlackMessage({ eventId: "e1", eventName: "Locklead", eventCode: "NX26-LOCKLEAD", lines: [line], pixelId: NX_PIXEL, storedPixelId: BRIXTON_PIXEL });
    assert.equal(message.channel, "ads_automation");
    assert.equal(message.text, `On-sale refresh · Locklead [NX26-LOCKLEAD]\n${line}`);
    assert.equal(message.dedupeKey, `onsale_refresh_pixel:e1:${NX_PIXEL}:${BRIXTON_PIXEL}`);
    assert.equal(message.dedupeWindowMs, Number.MAX_SAFE_INTEGER);
  });

  it("the refresh reads Meta and never writes it, and never writes clients", () => {
    const route = readFileSync("app/api/cron/onsale-refresh/route.ts", "utf8");
    const metaImports = [...route.matchAll(/import \{([^}]+)\} from "@\/lib\/meta\/[^"]+"/g)].flatMap((match) => match[1]!.split(",").map((name) => name.trim()));
    assert.deepEqual(metaImports.sort(), ["graphGetWithToken", "graphMultiGetByIds"], "a GET and the batch node read, nothing else from lib/meta");
    assert.match(route, /maxAttempts: 1/, "one attempt per call, so metaCalls is the true cost");
    // P2/P3: only Apply (apply.ts) and its gates may reach lib/meta, and only the gated status writes and the ledger;
    // the Graph calls themselves are injected by the apply route. Nothing in this folder posts to Graph.
    const applyFiles = new Set(["apply.ts", "apply-gates.ts"]);
    for (const file of readdirSync("lib/onsale-refresh").filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(`lib/onsale-refresh/${file}`, "utf8");
      assert.doesNotMatch(source, /graphPost|graphDelete|customconversions/, `${file}: no Meta write helper, no custom conversion`);
      if (applyFiles.has(file)) {
        for (const match of source.matchAll(/from "\.\.\/meta\/([^"]+)"/g)) assert.ok(["ad-status-write.ts", "adset-status-write.ts", "write-idempotency.ts"].includes(match[1]!), `${file}: ${match[1]}`);
      } else {
        assert.doesNotMatch(source, /from "\.\.\/meta\//, `${file}: the refresh's reads never import lib/meta`);
      }
      assert.doesNotMatch(source, /from\("clients"\)\s*\.(update|upsert|insert|delete)/, `${file}: clients is read only`);
    }
    const reader = readFileSync("lib/onsale-refresh/purchase-read.ts", "utf8");
    assert.doesNotMatch(reader, /\.(update|upsert|insert|delete)\(/, "the purchase read writes nothing");
    assert.match(reader, /"clients", "id, meta_pixel_id"/);
  });
});
