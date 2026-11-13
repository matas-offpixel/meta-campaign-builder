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
 * the w/c 9 Nov cycle refresh would read it. Its Objective block is the
 * per-event purchases record's F1 for P26-BDAY (13 Nov): the real IC pair
 * and "no domain of its own".
 *
 * OR2 / OR3: F1 of docs/design-record/2026-11-13-per-event-purchases.html,
 * the Objective block for P26-BDAY and NX26-LOCKLEAD. LOCKLEAD's domain
 * count (6) is the record's example (the 13 Nov read found none on its
 * domain: "nothing reaches", drawn in OR4). Its IC line and its pixel's
 * name are its 12 Nov read: Meta names pixel …2763 "NX Live Skiddle".
 *
 * OR4: F2 of that record — every purchase-line state in E3's order, with
 * the attributed line under each and the ticketing check where it shows.
 */

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
    attributedPurchases: { count: 21, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: null,
    ...overrides,
  };
}

/** P26-BDAY, real: crqln.com/l/puzzle-4th-birthday with no custom domain, tickets on Skiddle, 1 attributed purchase. */
const BDAY_READ = read("no_own_domain", { domainKind: "no_own_domain", cirqlinPage: true, attributedPurchases: { count: 1, scope: "any_show_on_pixel" } });

/** NX26-LOCKLEAD: its own domain and the real pixel mismatch; the count of 6 is the record's example. */
const LOCKLEAD_READ = read("under_bar", {
  pixel: { id: "645185673672763", source: "ad_sets", spendShare: 1, stored: "1283861880364565", matches: false },
  pixelName: "NX Live Skiddle",
  domain: "locklead-newcastle.com",
  domainVia: "signup_url",
  onDomain: { d14: 6, d28: 6, history: 6 },
});

export const OR2_WHY: PanelProposal["why"] = {
  objective: "Initiate Checkout — 75 reached the pixel since 30 Oct. Last 14 days: 99 IC.",
  ...purchaseWhy(BDAY_READ, false, ONSALE_PHASE),
};

export const OR3_WHY: PanelProposal["why"] = {
  objective: "Initiate Checkout — 93 reached the pixel since 6 Nov. Last 14 days: 96 IC.",
  ...purchaseWhy(LOCKLEAD_READ, false, ONSALE_PHASE),
};

const DOMAIN = "locklead-newcastle.com";
const counted = (d14: number) => ({ domain: DOMAIN, domainVia: "signup_url" as const, onDomain: { d14, d28: d14, history: d14 }, ticketsSold14: 40 });

/** F2's rows, in E3's order from the state that applies last to the one that applies first. Ticketing is linked in all of them. */
export const OR4_STATES: { label: string; why: PanelProposal["why"] }[] = (
  [
    ["Proposed", read("proposed", counted(18))],
    ["Under the bar", read("under_bar", counted(6))],
    ["Nothing reaches", read("nothing_reaches", { domain: DOMAIN, domainVia: "signup_url", landsOn: "Skiddle", onDomain: { d14: 0, d28: 0, history: 0 } })],
    ["Shared domain", read("shared_domain", { domain: DOMAIN, domainKind: "shared_domain", sharedWith: 2 })],
    ["No own domain", read("no_own_domain", { domainKind: "no_own_domain", cirqlinPage: true })],
    ["Ticket site only", read("ticket_site_only", { domainKind: "ticket_site_only" })],
    ["No page or ticket URL", read("no_url", { domainKind: "no_url", ticketSite: null })],
    ["No pixel", read("no_pixel", { pixel: null })],
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

export const REFRESH_FRAME_IDS = ["OR1", "OR2", "OR3", "OR4"] as const;
export const REFRESH_FRAME_WIDTHS = [1280, 393] as const;
