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
 * RD: RA's show (XMPL-WHSE) on the on-sale panel: its Registrations
 *     lookalike standing default, and the one note in place of the
 *     per-campaign Retargeting default (RT9). Under it, the not-proposed
 *     states, one per show.
 *
 * Show names are the record's XMPL shows and Mira Vale; the figures are
 * the record's invented ones. No fan or staff data.
 */

import type { PanelLine, PanelProposal } from "@/lib/onsale-refresh/read";

import { ONSALE_PHASE } from "../../lib/onsale-refresh/phase-config.ts";
import type { PurchaseRead } from "../../lib/onsale-refresh/purchases.ts";
import { planRetargeting, retargetingBeforeOnSale, type RetargetingInput, type RetargetingView } from "../../lib/retargeting/plan.ts";
import { runsInOwnCampaign } from "../../lib/retargeting/words.ts";
import { OR6_PROPOSALS } from "./refresh-fixtures.ts";

export const RETARGETING_FRAME_IDS = ["RB", "RD"] as const;

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
      ticketUrl: "skiddle.com/whats-on/xmpl-roof",
      pageUrl: "xmpl-roof.example/tickets",
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
    ...overrides,
  };
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
  ];
}
