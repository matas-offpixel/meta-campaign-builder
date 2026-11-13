import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import { fakeDb, op } from "../../launched-ads/__tests__/fake-db.ts";
import { ONSALE_PHASE } from "../phase-config.ts";
import { canonicalHost, fetchAdSetPixels, fetchPurchaseHosts, loadPurchaseReads, resolveCirqlinDomain, type RefreshGraph } from "../purchase-read.ts";
import {
  classifyDomain,
  countOn,
  hostOf,
  isCirqlinLink,
  purchaseWhy,
  readPurchases,
  resolvePixel,
  ticketSiteFor,
  ticketSiteOf,
  unreadPurchases,
  UNLINKED_TICKETING,
  type CirqlinLookup,
  type DomainClass,
  type DomainEvent,
  type HostDay,
  type PurchaseRead,
  type ReadPurchasesInput,
} from "../purchases.ts";
import { pixelSlackMessage } from "../slack.ts";

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
    assert.equal(readPurchases(input({ ticketSite: null, stats: { rows: hosts(["2026-11-03", "www.skiddle.com", 473], ["2026-11-03", "ra.co", 2]) } })).landsOn, "Skiddle", "no ticket link: the host the pixel's purchases mostly come from");
    assert.equal(readPurchases(input({ ticketSite: null, stats: { rows: hosts(["2026-11-03", "shop.example.org", 5]) } })).landsOn, "shop.example.org");
    assert.equal(readPurchases(input({ stats: { rows: [] } })).state, "under_bar", "an empty pixel is not 'they land elsewhere'");
    // A purchase on the domain before the 14 days is still a purchase that reached it.
    assert.equal(readPurchases(input({ stats: { rows: hosts(["2026-10-20", "locklead-newcastle.com", 1], ["2026-11-03", "www.skiddle.com", 473]) } })).state, "under_bar");
  });

  it("E3's order: the first state that applies wins", () => {
    const state = (overrides: Partial<ReadPurchasesInput>) => readPurchases(input(overrides)).state;
    const everything = { resolved: null, domain: { kind: "no_url" } as DomainClass };
    assert.equal(state(everything), "no_pixel", "1 · no pixel, before the URLs are looked at");
    assert.equal(state({ domain: { kind: "no_url" } }), "no_url", "2");
    assert.equal(state({ domain: { kind: "ticket_site_only", ticketSite: "Skiddle" } }), "ticket_site_only", "3");
    assert.equal(state({ domain: { kind: "no_own_domain", cirqlinPage: true } }), "no_own_domain", "4");
    assert.equal(state({ domain: { kind: "shared_domain", domain: "julianfijma.com", others: 2 } }), "shared_domain", "5");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "skiddle.com", 9]) } }), "nothing_reaches", "6");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 6]) } }), "under_bar", "7");
    assert.equal(state({ stats: { rows: hosts(["2026-11-03", "locklead-newcastle.com", 18]) } }), "proposed", "7");
    // The states before 6 need no count, so they hold even when the count could not be read.
    assert.equal(state({ domain: { kind: "ticket_site_only", ticketSite: "Skiddle" }, stats: { error: "rate limited" } }), "ticket_site_only");
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
        readPurchases(input({ domain: { kind: "ticket_site_only", ticketSite: "Universe" } })),
        "Purchase campaign not proposed — tickets sell on Universe, which sells every show, so this show's purchases can't be told apart.",
        "No Purchase campaign: tickets sell on Universe.",
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

  it("a read that failed says so in both widths", () => {
    const lines = why(readPurchases(input({ pixelError: "META_ACCESS_TOKEN is not configured", resolved: null })));
    assert.equal(lines.purchase, "Purchase campaign not proposed — this show's purchases couldn't be read this run (META_ACCESS_TOKEN is not configured).");
    assert.equal(lines.purchaseNarrow, "No Purchase campaign: purchases not read this run.");
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

const EVENTS = [
  { ...LOCKLEAD, event_code: "NX26-LOCKLEAD", client_id: "brixton", event_date: "2026-12-11" },
  { ...BDAY, event_code: "P26-BDAY", client_id: "puzzle", event_date: "2026-12-27" },
  { ...FEVER105, event_code: "ES26-FEVER105", client_id: "brixton", event_date: "2026-12-06" },
  { ...MALLGRAB, event_code: "ES26-MALLGRAB", client_id: "brixton", event_date: "2026-12-04" },
  { ...TRANCOSO, event_code: "DHB26-TRANCOSO", client_id: "dhb", event_date: "2026-12-27" },
];

/** One delivering ad set per show, with the pixel its ads really use; TRANCOSO's is a traffic ad set with none. */
const AD_SETS: Record<string, { event: string; pixel: string | null }> = {
  "as-locklead": { event: "locklead", pixel: NX_PIXEL },
  "as-bday": { event: "bday", pixel: PUZZLE_PIXEL },
  "as-fever": { event: "fever", pixel: STUDIOS_PIXEL },
  "as-mallgrab": { event: "mallgrab", pixel: STUDIOS_PIXEL },
  "as-trancoso": { event: "trancoso", pixel: null },
};

function rawInsights() {
  const rows = Object.entries(AD_SETS).flatMap(([adsetId, set]) => [
    { meta_ad_id: `ad-${adsetId}`, meta_adset_id: adsetId, campaign_name: null, ad_account_id: null, date: "2026-11-10", spend: 40, purchases: set.event === "locklead" ? 21 : set.event === "bday" ? 1 : 0 },
    // Outside the 14 days to the window end: neither spend nor attributed purchases count.
    { meta_ad_id: `ad-${adsetId}`, meta_adset_id: adsetId, campaign_name: null, ad_account_id: null, date: "2026-10-20", spend: 999, purchases: 50 },
    { meta_ad_id: `ad-${adsetId}`, meta_adset_id: adsetId, campaign_name: null, ad_account_id: null, date: "2026-11-12", spend: 999, purchases: 50 },
  ]);
  const launchedAdSets = new Map(Object.entries(AD_SETS).map(([adsetId, set]) => [adsetId, { clientId: null, eventId: set.event }]));
  return { rows, context: { launchedAds: new Map(), launchedAdSets, codedEvents: [] } };
}

function purchaseDb(tickets: { event_id: string; date: string; tickets_sold: number }[] = []) {
  return fakeDb((call) => {
    const columns = String(op(call, "select")?.[0] ?? "");
    if (call.table === "clients" && columns.includes("meta_pixel_id")) return { data: [{ id: "brixton", meta_pixel_id: BRIXTON_PIXEL }, { id: "puzzle", meta_pixel_id: PUZZLE_PIXEL }, { id: "dhb", meta_pixel_id: "361462699910737" }], error: null };
    if (call.table === "events") return { data: EVENTS.map((event) => ({ id: event.id, signup_url: event.signup_url, ticket_url: event.ticket_url, client_id: event.client_id })), error: null };
    if (call.table === "event_daily_rollups") return { data: tickets, error: null };
    return { data: [], error: null };
  });
}

const cirqlinFetch = (async (url: string) => {
  const html = String(url).includes("fever105") ? '<link rel="canonical" href="https://fever105-sheffield.com"/>' : '<link rel="canonical" href="https://crqln.com/puzzle-4th-birthday"/>';
  return new Response(html, { status: 200 });
}) as unknown as typeof fetch;

function liveGraph(statsFor: Record<string, unknown> = {}) {
  return fakeGraph({
    multi: (params) =>
      params.fields === "name"
        ? Object.fromEntries(params.ids.split(",").map((id) => [id, { name: id === NX_PIXEL ? "NX Live Skiddle" : "Electric Studios Universe Pixel" }]))
        : Object.fromEntries(params.ids.split(",").map((id) => [id, AD_SETS[id]!.pixel ? { promoted_object: { pixel_id: AD_SETS[id]!.pixel } } : {}])),
    get: (path) => statsFor[path.split("/")[1]!] ?? { data: [{ start_time: "2026-11-03T10:00:00+0000", data: [{ value: "www.skiddle.com", count: 473 }] }] },
  });
}

describe("per-event purchases: HE1's read across a run", () => {
  it("the acceptance cases, on the shows' own links and pixels", async () => {
    const { db, calls } = purchaseDb();
    const { graph, calls: graphCalls } = liveGraph();
    const result = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch, now: new Date("2026-11-12T08:00:00Z") });
    const read = (id: string) => result.reads.get(id)!;

    // NX shows resolve to 645185673672763 and flag the mismatch.
    assert.deepEqual(read("locklead").pixel, { id: NX_PIXEL, source: "ad_sets", spendShare: 1, stored: BRIXTON_PIXEL, matches: false });
    assert.equal(read("locklead").pixelName, "NX Live Skiddle");
    assert.deepEqual([read("locklead").state, read("locklead").domain, read("locklead").domainVia], ["nothing_reaches", "locklead-newcastle.com", "signup_url"]);
    assert.deepEqual(read("locklead").onDomain, { d14: 0, d28: 0, history: 0 });
    assert.deepEqual(read("locklead").attributedPurchases, { count: 21, scope: "any_show_on_pixel" }, "the 14 days to the window end only");
    assert.deepEqual(purchaseWhy(read("locklead"), false, ONSALE_PHASE).pixel, ["Ads optimise on pixel …2763 (NX Live Skiddle); the client's stored pixel is …4565. Counts use …2763."]);

    // P26-BDAY reads "no domain of its own"; its pixel is the stored one, so no setup line.
    assert.deepEqual([read("bday").state, read("bday").cirqlinPage, read("bday").pixel!.matches], ["no_own_domain", true, true]);
    assert.equal(purchaseWhy(read("bday"), false, ONSALE_PHASE).purchaseNarrow, "No Purchase campaign: no domain of its own.");
    assert.deepEqual(purchaseWhy(read("bday"), false, ONSALE_PHASE).pixel, []);

    // ES26-FEVER105 resolves to fever105-sheffield.com through its CIRQLIN page.
    assert.deepEqual([read("fever").domain, read("fever").domainVia, read("fever").domainKind], ["fever105-sheffield.com", "cirqlin_custom_domain", "own"]);

    // ES26-MALLGRAB reads "ticket site only".
    assert.deepEqual([read("mallgrab").state, read("mallgrab").ticketSite], ["ticket_site_only", "Skiddle"]);

    // A show whose only delivering ad set optimises on no pixel: no pixel comes first.
    assert.deepEqual([read("trancoso").state, read("trancoso").pixel, read("trancoso").domainKind], ["no_pixel", null, "ticket_site_only"]);

    // Reads only, counted: one ad-set batch, the domain breakdown of the two pixels an own-domain show counts on, one names batch.
    assert.equal(result.metaCalls, graphCalls.length);
    assert.deepEqual(graphCalls.map((call) => (call.kind === "multi" ? `batch:${call.params.fields}` : call.path)).sort(), ["batch:name", "batch:promoted_object", `/${NX_PIXEL}/stats`, `/${STUDIOS_PIXEL}/stats`].sort());
    assert.equal(result.cirqlinReads, 2, "one page read per crqln.com link");
    assert.ok(calls.every((call) => !op(call, "insert") && !op(call, "update") && !op(call, "upsert") && !op(call, "delete")), "nothing is written: clients.meta_pixel_id least of all");
  });

  it("purchases on the own domain are counted on the resolved pixel; ticketing sold in the 14 days joins when the rollups have it", async () => {
    const { db } = purchaseDb([
      { event_id: "locklead", date: "2026-11-03", tickets_sold: 30 },
      { event_id: "locklead", date: "2026-11-10", tickets_sold: 10 },
      { event_id: "locklead", date: "2026-10-20", tickets_sold: 500 },
    ]);
    const stats = { [NX_PIXEL]: { data: [{ start_time: "2026-11-04T20:00:00+0000", data: [{ value: "www.locklead-newcastle.com", count: 18 }, { value: "www.skiddle.com", count: 400 }] }] } };
    const { graph } = liveGraph(stats);
    const result = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch, now: new Date("2026-11-12T08:00:00Z") });
    const read = result.reads.get("locklead")!;
    assert.deepEqual([read.state, read.onDomain!.d14, read.ticketsSold14], ["proposed", 18, 40]);
    assert.equal(purchaseWhy(read, true, ONSALE_PHASE).ticketing, "Ticketing: 40 sold in 14 days · the pixel saw 18 on locklead-newcastle.com (45 % of sales).");
    assert.equal(purchaseWhy(read, true, ONSALE_PHASE).purchase, "Purchase campaign proposed — 18 purchases on locklead-newcastle.com in 14 days.");
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

  it("everyPixel reads the breakdown of every resolved pixel for the table; the run reads only what an own-domain show needs", async () => {
    const { db } = purchaseDb();
    const { graph, calls } = liveGraph();
    const result = await loadPurchaseReads({ db, events: EVENTS, raw: rawInsights(), day: "2026-11-12", shadow: true, config: ONSALE_PHASE, graph, fetchImpl: cirqlinFetch, everyPixel: true });
    assert.deepEqual(calls.filter((call) => call.kind === "get").map((call) => call.path).sort(), [`/${NX_PIXEL}/stats`, `/${PUZZLE_PIXEL}/stats`, `/${STUDIOS_PIXEL}/stats`].sort());
    assert.equal(result.reads.get("bday")!.pixelWide!.history, 473);
    assert.equal(result.reads.get("bday")!.state, "no_own_domain", "the pixel-wide figure is context: it never changes the state");
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
    for (const file of readdirSync("lib/onsale-refresh").filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(`lib/onsale-refresh/${file}`, "utf8");
      assert.doesNotMatch(source, /graphPost|graphDelete|customconversions|from "\.\.\/meta\//, `${file}: no Meta write helper, no custom conversion`);
      assert.doesNotMatch(source, /from\("clients"\)\s*\.(update|upsert|insert|delete)/, `${file}: clients is read only`);
    }
    const reader = readFileSync("lib/onsale-refresh/purchase-read.ts", "utf8");
    assert.doesNotMatch(reader, /\.(update|upsert|insert|delete)\(/, "the purchase read writes nothing");
    assert.match(reader, /"clients", "id, meta_pixel_id"/);
  });
});
