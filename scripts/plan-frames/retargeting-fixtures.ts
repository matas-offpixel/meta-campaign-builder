/**
 * The Retargeting campaign's PR A frames (docs/design-record/2026-11-17-retargeting-campaign.html),
 * built by the rules (planRetargeting), not typed: a frame can only show
 * what the panel would say for these inputs. Today is Tue 17 Nov 2026.
 *
 * RB: a new show, XMPL-ROOF, on Fri 18 Dec. Current daily spend £58.00
 *     (£406.00 over 10–16 Nov), so 10 % is £5.80, split £2.90 / £1.45 /
 *     £1.45. Tue 17 Nov to Fri 18 Dec, both included, is 32 days:
 *     £5.80 × 32 = £185.60, all from plan headroom. One retargeting ad set
 *     already runs in XMPL-ROOF · Tickets. All three missing states: no
 *     signup list, a lineup page with no role (Mira Vale, so 3 of 4 pages)
 *     and no buyers list. Before Apply every pool reads "Known after create"
 *     (RT3, revised 17 Nov).
 *     -2.html (PR B): its links come from CIRQLIN (Skiddle shown first,
 *     Fatsoma, DICE; xmpl-roof.com), every source at RT14's windows,
 *     registrations in Bottom, and today's share with no choice (RT11).
 *     The pixel is on Skiddle only, so Fatsoma and DICE read "no".
 * RA: XMPL-WHSE's running campaign, read Tue 17 Nov, with PR B's lines only
 *     (-2.html: "Each build PR is judged only on the lines it builds"):
 *     RT14's windows, the per-link sizes (Skiddle 2,100–2,500 · RA
 *     1,000–1,200 · Fixr below 1,000; xmpl-whse.com 7,000–8,200) and the
 *     pixel lines (Skiddle and RA yes, Fixr no; xmpl-whse.com yes). The
 *     tiers' figures, the hold and the move are PR C's; the steps PR D's.
 * RD: RA's show (XMPL-WHSE) on the on-sale panel: its Registrations
 *     lookalike standing default, and the one note in place of the
 *     per-campaign Retargeting default (RT9). Under it, the ten
 *     not-proposed states, one per show.
 *
 * Show names are the record's XMPL shows and Mira Vale; the figures are
 * the record's invented ones. No fan or staff data.
 */

import type { PanelLine, PanelProposal } from "@/lib/onsale-refresh/read";

import { ONSALE_PHASE } from "../../lib/onsale-refresh/phase-config.ts";
import type { PurchaseRead } from "../../lib/onsale-refresh/purchases.ts";
import type { PartnerPageLinks } from "../../lib/cirqlin/page-links.ts";
import { linkKey } from "../../lib/retargeting/audiences.ts";
import { linksFromPages, type PixelHosts } from "../../lib/retargeting/links.ts";
import { callLine, planRetargeting, retargetingBeforeOnSale, type RetargetingInput, type RetargetingView } from "../../lib/retargeting/plan.ts";
import { runsInOwnCampaign } from "../../lib/retargeting/words.ts";
import { OR6_PROPOSALS } from "./refresh-fixtures.ts";

export const RETARGETING_FRAME_IDS = ["RA", "RB", "RD", "RG"] as const;

const TODAY = "2026-11-17";

function read(overrides: Partial<PurchaseRead> = {}): PurchaseRead {
  return {
    state: "platform_under_bar",
    pixel: { id: "1067726194205285", source: "ad_sets", spendShare: 1, stored: "1067726194205285", matches: true },
    pixelName: "Warehouse Skiddle",
    otherPixels: [],
    domain: null,
    domainVia: null,
    domainKind: "no_own_domain",
    cirqlinPage: false,
    sharedWith: 0,
    ticketSite: "skiddle.com",
    landsOn: null,
    onDomain: null,
    pixelWide: null,
    historyDays: ONSALE_PHASE.purchaseHistoryDays,
    platform: "Skiddle",
    platformShare: { purchases: 410, pixelPurchases: 512, share: 410 / 512, elsewhereHost: "universe.com", elsewherePurchases: 60 },
    attributedOnPixel: null,
    attributedPurchases: { count: 12, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: null,
    ...overrides,
  };
}

/** RB's page on CIRQLIN: xmpl-roof.com, with Skiddle shown first, then Fatsoma and DICE. */
const ROOF_PAGES: PartnerPageLinks[] = [
  {
    page_id: "pg-roof",
    slug: "xmpl-roof",
    crm_base_tag: "XMPL-ROOF",
    title: "XMPL Rooftop",
    landing_url: "https://xmpl-roof.com/",
    ticket_links: [
      { platform: "skiddle", url: "https://www.skiddle.com/whats-on/London/XMPL-Rooftop/1234567/", label: "Tickets", shop_name: null, shown_first: true },
      { platform: "fatsoma", url: "https://www.fatsoma.com/e/abc123/xmpl-rooftop", label: "Tickets", shop_name: null, shown_first: false },
      { platform: "dice", url: "https://dice.fm/event/xyz-xmpl-rooftop", label: "Tickets", shop_name: null, shown_first: false },
    ],
  },
];

/** The pixel's hosts in 28 days (GET /{pixel}/stats?aggregation=host): any event on Skiddle and the show's own domain, checkouts on Skiddle, registrations on its own page. */
const ROOF_HOSTS: PixelHosts = { any: ["www.skiddle.com", "xmpl-roof.com"], pageView: ["www.skiddle.com", "xmpl-roof.com"], checkout: ["www.skiddle.com"], registration: ["xmpl-roof.com"] };

function input(overrides: Partial<RetargetingInput>): RetargetingInput {
  return {
    eventId: "xmpl-roof",
    eventCode: "XMPL-ROOF",
    runDay: TODAY,
    eventDate: "2026-12-18",
    onSaleDay: "2026-11-06",
    read: read(),
    last7SpendGbp: 406,
    minDailyMinor: 100,
    sources: {
      pixelId: "1067726194205285",
      // RT13: CIRQLIN's page for the show (cirqlin#653's shape), Skiddle shown first.
      links: linksFromPages(ROOF_PAGES),
      videos: [{ contextId: "", videoIds: ["pending"] }],
      pages: [
        { id: "p1", name: "XMPL Promotions", igId: "ig1", kind: "promoter", hasRole: true },
        { id: "p2", name: "The Roof", igId: "ig2", kind: "venue", hasRole: true },
        { id: "p3", name: "Ada North", igId: "ig3", kind: "lineup", hasRole: true },
        { id: "p4", name: "Mira Vale", igId: null, kind: "lineup", hasRole: false },
      ],
      lists: [],
    },
    existing: null,
    legacy: [{ campaign: "XMPL-ROOF · Tickets", adSets: 1 }],
    budgetGbp: 4000,
    spendToDateGbp: 1500,
    committedGbp: 1000,
    main: { campaignKey: "XMPL-ROOF · Tickets", campaignId: "120000000000000001", lifetimeGbp: null, spentToDate: 1500, last7Daily: 58 },
    ads: [{ adId: "1", name: "XMPL-ROOF Lineup" }],
    geoFromAdsetId: "120000000000000002",
    where: { draftId: "00000000-0000-4000-8000-000000000001", adAccountId: "act_1", campaignIds: ["120000000000000001"] },
    today: TODAY,
    linksRead: "ok",
    pixelHosts: ROOF_HOSTS,
    ...overrides,
  };
}

/** RA's page on CIRQLIN: xmpl-whse.com with Skiddle shown first, RA and Fixr. */
const WHSE_PAGES: PartnerPageLinks[] = [
  {
    page_id: "pg-whse",
    slug: "xmpl-whse",
    crm_base_tag: "XMPL-WHSE",
    title: "XMPL Warehouse",
    landing_url: "https://xmpl-whse.com",
    ticket_links: [
      { platform: "skiddle", url: "https://www.skiddle.com/whats-on/London/XMPL-Warehouse/7654321/", label: "Tickets", shop_name: null, shown_first: true },
      { platform: "ra", url: "https://ra.co/events/7654321", label: "Tickets", shop_name: null, shown_first: false },
      { platform: "fixr", url: "https://fixr.co/event/xmpl-warehouse-7654321", label: "Tickets", shop_name: null, shown_first: false },
    ],
  },
];

/** RA: the running campaign's rows with PR B's lines. */
export function raView(): RetargetingView {
  const links = linksFromPages(WHSE_PAGES);
  const size = (rule: string, lower: number, upper: number) => [rule, { lower, upper }] as const;
  const [skiddle, ra, fixr, whse] = links.map((link) => link.rule);
  const linkSizes = Object.fromEntries([
    [`bottom:ticket:30:${linkKey(skiddle!)}`, size(skiddle!, 2100, 2500)[1]],
    [`bottom:ticket:30:${linkKey(ra!)}`, size(ra!, 1000, 1200)[1]],
    [`bottom:ticket:30:${linkKey(fixr!)}`, size(fixr!, 400, 800)[1]],
    [`mid_bottom:page:60:${linkKey(whse!)}`, size(whse!, 7000, 8200)[1]],
  ]);
  return planRetargeting(
    input({
      eventId: "xmpl-whse",
      eventCode: "XMPL-WHSE",
      eventDate: "2026-12-19",
      last7SpendGbp: 1680,
      pixelHosts: { any: ["www.skiddle.com", "ra.co", "xmpl-whse.com"], pageView: ["www.skiddle.com", "ra.co", "xmpl-whse.com"], checkout: ["www.skiddle.com"], registration: ["xmpl-whse.com"] },
      linkSizes,
      sources: raSources(links),
      existing: { campaignId: "120000000000000010", since: "2026-11-10", totalMinor: 2400, share: 10, tiers: { bottom: 1200, mid_bottom: 600, mid: 600 }, status: "ACTIVE" },
      legacy: [],
    }),
  ).view;
}

/** RA's (and RG's) source set: XMPL-WHSE's links, four pages, a signup list, two similar lists and a buyers list. */
function raSources(links = linksFromPages(WHSE_PAGES)) {
  return {
        pixelId: "1067726194205285",
        links,
        videos: [{ contextId: "", videoIds: ["pending"] }],
        pages: [
          { id: "p1", name: "XMPL Promotions", igId: "ig1", kind: "promoter", hasRole: true },
          { id: "p2", name: "The Warehouse", igId: "ig2", kind: "venue", hasRole: true },
          { id: "p3", name: "Ada North", igId: "ig3", kind: "lineup", hasRole: true },
          { id: "p4", name: "Mira Vale", igId: "ig4", kind: "lineup", hasRole: true },
        ],
        lists: [
          { metaAudienceId: "l1", name: "XMPL-WHSE signups", role: "signups", uploadedAt: "2026-11-12T10:00:00Z" },
          { metaAudienceId: "l2", name: "Tech house data", role: "similar", uploadedAt: "2026-11-09T10:00:00Z" },
          { metaAudienceId: "l3", name: "House data", role: "similar", uploadedAt: "2026-11-09T10:00:00Z" },
          { metaAudienceId: "l4", name: "XMPL-WHSE buyers", role: "buyers", uploadedAt: "2026-11-14T10:00:00Z" },
        ],
  } satisfies RetargetingInput["sources"];
}

/**
 * RG: RA's show in the layout test, read Tue 1 Dec (-2.html RT17, PR E's
 * lines): £36.00 a day, £18.00 to each arm split £9.00 / £4.50 / £4.50.
 * The arms' 7 days (24–30 Nov): A £63.00 ÷ 9, £31.50 ÷ 4, £31.50 ÷ 4
 * (£126.00 ÷ 17 = £7.41); B £63.00 ÷ 7, £31.50 ÷ 3, £31.50 ÷ 3
 * (£126.00 ÷ 13 = £9.69). The test, every show (Tue 17 – Mon 30 Nov, 14
 * days, 6 shows): A £2,184.00 ÷ 168 = £13.00, B £2,179.40 ÷ 130 = £16.76,
 * 22 % cheaper: the call is made. The header's stretch wording is PR D's.
 */
export function rgPlan() {
  const tier = (budgetMinor: number, spendMinor: number, purchases: number, frequency: number, pool: string) => ({ budgetMinor, spendMinor, purchases, frequency, pool });
  const pooledRead = {
    from: "2026-11-17",
    to: "2026-11-30",
    days: 14,
    shows: 6,
    arms: { A: { shows: 6, spend: 2184, purchases: 168, cost: 13 }, B: { shows: 6, spend: 2179.4, purchases: 130, cost: 16.76 } },
  };
  const plan = planRetargeting(
    input({
      eventId: "xmpl-whse",
      eventCode: "XMPL-WHSE",
      eventDate: "2026-12-19",
      runDay: "2026-12-01",
      today: "2026-12-01",
      last7SpendGbp: 1680,
      pixelHosts: { any: ["www.skiddle.com", "ra.co", "xmpl-whse.com"], pageView: ["www.skiddle.com", "ra.co", "xmpl-whse.com"], checkout: ["www.skiddle.com"], registration: ["xmpl-whse.com"] },
      sources: raSources(),
      existing: { campaignId: null, since: "2026-11-18", totalMinor: 3600, share: 15, tiers: { bottom: 1800, mid_bottom: 900, mid: 900 }, status: "ACTIVE" },
      test: {
        arms: {
          A: { bottom: tier(900, 6300, 9, 3.1, "4,100–4,800"), mid_bottom: tier(450, 3150, 4, 2.0, "6,600–7,800"), mid: tier(450, 3150, 4, 1.4, "184,000–216,000") },
          B: { bottom: tier(900, 6300, 7, 2.2, "38,000–45,000"), mid_bottom: tier(450, 3150, 3, 1.8, "52,000–61,000"), mid: tier(450, 3150, 3, 1.3, "141,000–166,000") },
        },
        pooled: pooledRead,
      },
      legacy: [],
    }),
  );
  const call = callLine(pooledRead)!;
  const line: PanelLine = {
    id: "rg-call",
    kind: "retargeting_test_call",
    title: call.title,
    detail: call.detail,
    writeText: call.writeText,
    narrow: { detail: call.narrow, writeText: call.narrowSub },
    addsSpend: false,
    blockedReason: null,
    supply: false,
    state: "to_review",
    reason: null,
    retargetingCall: { onAccept: call.onAccept },
  };
  return { view: plan.view, line };
}

/** RB: the Create line with all three missing states, before Apply. */
export function rbView(): RetargetingView {
  return planRetargeting(input({})).view;
}

/** RB's stored line, To review, as the daily read writes it. */
export function rbLine(view: RetargetingView): PanelLine {
  const option = view.create!.options.find((row) => row.share === view.create!.defaultShare)!;
  return {
    id: "rb-create",
    kind: "retargeting_campaign",
    title: view.title,
    detail: option.line,
    writeText: view.create!.writeText,
    narrow: { detail: option.split, writeText: null },
    addsSpend: false,
    blockedReason: null,
    supply: false,
    state: "to_review",
    reason: null,
    writeKind: "retargeting_campaign_create",
    retargeting: view,
    share: null,
  };
}

/** RD 1280: RA's show on the on-sale panel — the lookalike default, and the one Retargeting note. */
export const RD_PROPOSALS: PanelProposal[] = [
  {
    ...OR6_PROPOSALS[0]!,
    id: "rd",
    mode: "shadow",
    // The record's XMPL show, not OR6's: an invented Objective with RA's pixel.
    why: { objective: "Initiate Checkout — 240 reached the pixel since 10 Nov. Last 14 days: 240 IC.", purchase: "Attributed purchases on the Warehouse Skiddle pixel, shared with its other shows' sales.", purchaseNarrow: "Warehouse Skiddle pixel, shared with its other shows.", moves: "", ticketing: null },
    campaignKey: "XMPL-WHSE · Tickets",
    campaignSummary: null,
    notEnoughData: null,
    blockers: [],
    notes: { pauses: "No pauses: no creative has enough evidence.", drops: "No drops: none qualifies.", adds: "", retargeting: runsInOwnCampaign("XMPL-WHSE") },
    watch: { creatives: [], audiences: [] },
    lines: [
      {
        id: "rd-lal",
        kind: "missing_default",
        title: "Registrations lookalike",
        detail: "The registrations lookalike isn't in its own ad set.",
        writeText: "New audience and ad set through the launch path",
        narrow: { detail: "The registrations lookalike isn't in its own ad set.", writeText: null },
        addsSpend: false,
        blockedReason: null,
        supply: false,
        state: "to_review",
        reason: null,
        writeKind: "new_adset",
      },
    ],
  },
];

/** RD 393: the not-proposed states, one per show, each replacing the Create line. */
export function rdStates(): RetargetingView[] {
  return [
    retargetingBeforeOnSale("XMPL-FRI", "2026-11-20"),
    planRetargeting(input({ eventCode: "XMPL-NOPX", read: read({ state: "no_pixel", pixel: null }) })).view,
    planRetargeting(input({ eventCode: "XMPL-UNIV", read: read({ state: "pixel_sells_elsewhere", platformShare: { purchases: 133, pixelPurchases: 512, share: 133 / 512, elsewhereHost: "universe.com", elsewherePurchases: 379 } }) })).view,
    planRetargeting(input({ eventCode: "XMPL-READ", read: read({ state: "not_read", notRead: "rate limited" }) })).view,
    planRetargeting(input({ eventCode: "XMPL-QUIET", last7SpendGbp: 0 })).view,
    // #1299 6ec5353: three more shows that can't take the campaign.
    planRetargeting(input({ eventCode: "XMPL-OWN", read: read({ state: "nothing_reaches", domain: "xmpl-roof.com", domainKind: "own", platform: null, platformShare: null, onDomain: { d14: 0, d28: 0, history: 0 }, pixelWide: { d14: 40, d28: 90, history: 90, topHost: "skiddle.com" } }) })).view,
    planRetargeting(input({ eventCode: "XMPL-NONE", read: read({ state: "platform_no_purchases", platformShare: { purchases: 0, pixelPurchases: 0, share: null, elsewhereHost: null, elsewherePurchases: 0 } }) })).view,
    planRetargeting(input({ eventCode: "XMPL-NOURL", read: read({ state: "no_url", platform: null, platformShare: null, domainKind: "no_url" }) })).view,
    // -2.html RT13: CIRQLIN's page isn't published (404 no_page), and the links read failed.
    planRetargeting(input({ eventCode: "XMPL-PEND", linksRead: "no_page" })).view,
    planRetargeting(input({ eventCode: "XMPL-LINK", linksRead: "failed" })).view,
  ];
}
