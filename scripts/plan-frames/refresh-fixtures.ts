import type { PanelProposal } from "@/lib/onsale-refresh/read";

import { ONSALE_PHASE } from "../../lib/onsale-refresh/phase-config.ts";
import { purchaseWhy, type PurchaseRead, type PurchaseState } from "../../lib/onsale-refresh/purchases.ts";

/**
 * The on-sale refresh frames. Every purchase sentence here is built by
 * the rule (purchaseWhy), not typed: a frame can only show what the panel
 * would say for that read.
 *
 * OR1: F1 / F2 of docs/design-record/2026-11-12-on-sale-refresh.html as
 * drawn — a shadow run on Thu 12 Nov over the data to Wed 11 Nov, read as
 * the w/c 9 Nov cycle refresh would read it. Its Objective block is
 * P26-BDAY's (OR2).
 *
 * OR2 / OR3 / OR5: the Objective block for three real shows, each as its
 * 12 Nov shadow run read it, which is the data to Wed 11 Nov, the same
 * cut as OR1 (so LOCKLEAD's 8 credited since 6 Nov is to 11 Nov; a run a
 * day later reads 11) (F2 of
 * docs/design-record/2026-11-13-ticket-platform-purchases.html). P26-BDAY
 * and NX26-LOCKLEAD sell on Skiddle and take the platform path, under the
 * bar; NX27-JULIANFIJMA sells on Universe while its ads' pixel sells on
 * skiddle.com, so its pixel sells elsewhere. The counts and shares are
 * the read's, not the record's examples.
 *
 * OR4: every purchase-line state (F2 of the per-event purchases record,
 * F1 of the ticket-platform record): the own-domain states, the three
 * platform states with the under-14-days form and the pixel with no
 * purchases, what is left with "no ticket URL" ahead of "nothing reaches",
 * and the read that failed. "Ticket site only" is retired. The failed read's fixture
 * carries a raw reason, which the frame must not show.
 */

const NX_PIXEL = "645185673672763";
const BRIXTON_PIXEL = "1283861880364565";

function read(state: PurchaseState, overrides: Partial<PurchaseRead> = {}): PurchaseRead {
  return {
    state,
    pixel: { id: "1067726194205285", source: "ad_sets", spendShare: 1, stored: "1067726194205285", matches: true },
    pixelName: null,
    otherPixels: [],
    domain: null,
    domainVia: null,
    domainKind: "own",
    cirqlinPage: false,
    sharedWith: 0,
    ticketSite: "Skiddle",
    landsOn: null,
    onDomain: null,
    pixelWide: null,
    historyDays: ONSALE_PHASE.purchaseHistoryDays,
    platform: null,
    platformShare: null,
    attributedOnPixel: null,
    attributedPurchases: { count: 21, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: null,
    ...overrides,
  };
}

/** T2's count on the resolved pixel: `count` from `fromDay`; `sinceOnSale` when the show has been on sale under 14 days. */
function credited(count: number, fromDay: string, sinceOnSale: boolean): PurchaseRead["attributedOnPixel"] {
  return { count, fromDay, sinceOnSale, total: { fromDay, purchases: count, spend: 0, byCampaign: [] } };
}

const NX_MISMATCH = { pixel: { id: NX_PIXEL, source: "ad_sets" as const, spendShare: 1, stored: BRIXTON_PIXEL, matches: false }, pixelName: "NX Live Skiddle" };

/** P26-BDAY, 12 Nov: crqln.com page with no custom domain, tickets on Skiddle, 1 purchase credited in 14 days, all 32 of its pixel's purchases on Skiddle. */
const BDAY_READ = read("platform_under_bar", {
  domainKind: "no_own_domain",
  cirqlinPage: true,
  platform: "Skiddle",
  platformShare: { purchases: 32, pixelPurchases: 32, share: 1, elsewhereHost: null },
  attributedOnPixel: credited(1, "2026-10-29", false),
  attributedPurchases: { count: 1, scope: "any_show_on_pixel" },
});

/** NX26-LOCKLEAD, 12 Nov: on sale 6 Nov, 8 purchases credited since, on the NX pixel whose 844 purchases are all on Skiddle. */
const LOCKLEAD_READ = read("platform_under_bar", {
  ...NX_MISMATCH,
  domain: "locklead-newcastle.com",
  domainVia: "signup_url",
  onDomain: { d14: 0, d28: 0, history: 0 },
  platform: "Skiddle",
  platformShare: { purchases: 844, pixelPurchases: 844, share: 1, elsewhereHost: null },
  attributedOnPixel: credited(8, "2026-11-06", true),
});

/** NX27-JULIANFIJMA, 12 Nov: tickets on Universe, ads on the NX pixel, none of whose 844 purchases are on Universe. */
const JULIAN_READ = read("pixel_sells_elsewhere", {
  ...NX_MISMATCH,
  domainKind: "ticket_site_only",
  ticketSite: "Universe",
  platform: "Universe",
  platformShare: { purchases: 0, pixelPurchases: 844, share: 0, elsewhereHost: "skiddle.com" },
  attributedOnPixel: credited(5, "2026-11-03", true),
});

export const OR2_WHY: PanelProposal["why"] = {
  objective: "Initiate Checkout — 75 reached the pixel since 30 Oct. Last 14 days: 99 IC.",
  ...purchaseWhy(BDAY_READ, false, ONSALE_PHASE),
};

export const OR3_WHY: PanelProposal["why"] = {
  objective: "Initiate Checkout — 93 reached the pixel since 6 Nov. Last 14 days: 96 IC.",
  ...purchaseWhy(LOCKLEAD_READ, false, ONSALE_PHASE),
};

export const OR5_WHY: PanelProposal["why"] = {
  objective: "Landing Page View — the pixel logged 5 Initiate Checkout in 14 days, under 10. Last 14 days: 1461 LPV.",
  ...purchaseWhy(JULIAN_READ, false, ONSALE_PHASE),
};

const DOMAIN = "locklead-newcastle.com";
const counted = (d14: number) => ({ domain: DOMAIN, domainVia: "signup_url" as const, onDomain: { d14, d28: d14, history: d14 }, ticketsSold14: 40 });
/** The record's F1 example: the NX pixel, 677 of its 836 purchases (81 %) on Skiddle. */
const onSkiddle = { pixel: { id: NX_PIXEL, source: "ad_sets" as const, spendShare: 1, stored: NX_PIXEL, matches: true }, platform: "Skiddle", platformShare: { purchases: 677, pixelPurchases: 836, share: 677 / 836, elsewhereHost: "ra.co" } };

/** Every state, grouped as the record's order groups them. Ticketing is linked in all of them. */
export const OR4_STATES: { label: string; why: PanelProposal["why"] }[] = (
  [
    ["Own domain · proposed", read("proposed", counted(18))],
    ["Own domain · under the bar", read("under_bar", counted(6))],
    ["Platform · proposed", read("platform_proposed", { ...onSkiddle, attributedOnPixel: credited(17, "2026-10-29", false) })],
    ["Platform · under the bar", read("platform_under_bar", { ...onSkiddle, attributedOnPixel: credited(6, "2026-10-29", false) })],
    ["Platform · on sale under 14 days", read("platform_under_bar", { ...onSkiddle, attributedOnPixel: credited(6, "2026-11-06", true) })],
    ["Platform · pixel sells elsewhere", read("pixel_sells_elsewhere", { ...onSkiddle, platformShare: { purchases: 26, pixelPurchases: 836, share: 26 / 836, elsewhereHost: "universe.com" }, attributedOnPixel: credited(6, "2026-10-29", false) })],
    ["Platform · no purchases on the pixel", read("platform_no_purchases", { ...onSkiddle, platformShare: { purchases: 0, pixelPurchases: 0, share: null, elsewhereHost: null }, attributedOnPixel: credited(0, "2026-10-29", false) })],
    ["No ticket URL", read("no_ticket_url", { domain: DOMAIN, domainVia: "signup_url", ticketSite: null, onDomain: { d14: 0, d28: 0, history: 0 } })],
    ["Nothing reaches", read("nothing_reaches", { domain: DOMAIN, domainVia: "signup_url", landsOn: "Eventbrite", ticketSite: "Eventbrite", onDomain: { d14: 0, d28: 0, history: 0 } })],
    ["Shared domain", read("shared_domain", { domain: DOMAIN, domainKind: "shared_domain", sharedWith: 2 })],
    ["No own domain", read("no_own_domain", { domainKind: "no_own_domain", cirqlinPage: true })],
    ["No page or ticket URL", read("no_url", { domainKind: "no_url", ticketSite: null })],
    ["No pixel", read("no_pixel", { pixel: null })],
    ["Not read", read("not_read", { pixel: null, domainKind: "not_read", notRead: "the ad sets' pixels couldn't be read: (#17) User request limit reached" })],
  ] as const
).map(([label, state]) => ({ label, why: { objective: "", ...purchaseWhy(state, true, ONSALE_PHASE) } }));

export const OR1_PROPOSALS: PanelProposal[] = [
  {
    id: "or1",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
    campaignSummary: "29 Oct – 11 Nov · £734.22 · 96 IC · £7.65 each",
    runKind: "shadow",
    runDay: "2026-11-12",
    cycleMonday: "2026-11-09",
    cycleKind: "content",
    windowStart: "2026-11-05",
    windowEnd: "2026-11-11",
    mode: "shadow",
    objective: "initiate_checkout",
    why: OR2_WHY,
    blockers: [{ kind: "budget", text: "This event has no marketing budget, so nothing that adds spend can be accepted.", action: "Set budget" }],
    enoughData: true,
    notEnoughData: null,
    nextCheck: "2026-11-16",
    nextCycle: "2026-11-23",
    nextCycleKind: "payday",
    watch: {
      creatives: [{ title: "Puzzle - 4th Birthday - Static", detail: "20 ads · £21.66 · 0 IC · 30 LPV · convert 23, not yet significant", narrow: "Puzzle - 4th Birthday - Static · £21.66 · 0 IC", evidence: {} }],
      audiences: [{ title: "Lineup — Primary", detail: "£28.36 · 2 IC · £14.18 each, 1.85× the campaign (drops at 2×)", narrow: "Lineup — Primary · £28.36 · 2 IC", evidence: {} }],
    },
    notes: { pauses: "No pauses: no creative has enough evidence.", drops: "No drops: none qualifies.", adds: "Files uploaded by hand in Ads Manager aren't matched." },
    lines: [
      {
        id: "l1",
        kind: "add_creative",
        title: "P26-BDAY_enzo-siragusa-1_quote-on-sale_r1_9x16",
        detail: "Enzo Siragusa / Videos / UGC · approved final · content cycle",
        writeText: "New ad in each delivering ad set · launch path · goes in live",
        narrow: { detail: "Enzo Siragusa / Videos / UGC · content cycle", writeText: "New ad in each delivering ad set · live" },
        addsSpend: false,
        blockedReason: null,
        supply: false,
        state: "to_review",
        reason: null,
      },
      {
        id: "l2",
        kind: "add_creative",
        title: "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16",
        detail: "Enzo Siragusa / Videos / UGC · approved final · content cycle",
        writeText: "New ad in each delivering ad set · launch path · goes in live",
        narrow: { detail: "Enzo Siragusa / Videos / UGC · content cycle", writeText: "New ad in each delivering ad set · live" },
        addsSpend: false,
        blockedReason: null,
        supply: false,
        state: "to_review",
        reason: null,
      },
      {
        id: "l3",
        kind: "claim_ready",
        title: "“EARLY BIRD, 1ST & 2ND RELEASE SOLD OUT / 3RD RELEASE SELLING FAST”",
        detail: "Approved · live since 11 Nov · no render yet",
        writeText: "Make it in the Lab: it joins the 23 Nov payday cycle's adds",
        narrow: { detail: "Approved · live since 11 Nov · no render yet", writeText: "Make it in the Lab: it joins the 23 Nov payday cycle's adds" },
        addsSpend: false,
        blockedReason: null,
        supply: true,
        state: "to_review",
        reason: null,
      },
      {
        id: "l4",
        kind: "bring_back_audience",
        title: "Electronic dance music, Electronic music",
        detail: "Stopped 6 Nov · £36.85 · 12 IC · £3.07 each, 0.4× the campaign",
        writeText: "Ad set status → on · its own budget",
        narrow: { detail: "£36.85 · 12 IC · £3.07 each, 0.4×", writeText: null },
        addsSpend: true,
        blockedReason: "Adds spend: set this event's budget to accept this.",
        supply: false,
        state: "to_review",
        reason: null,
      },
    ],
    createdAt: "2026-11-12T08:00:00Z",
  },
];

export const REFRESH_FRAME_IDS = ["OR1", "OR2", "OR3", "OR4", "OR5"] as const;
export const REFRESH_FRAME_WIDTHS = [1280, 393] as const;
