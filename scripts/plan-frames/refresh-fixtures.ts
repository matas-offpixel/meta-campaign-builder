import type { PanelProposal } from "@/lib/onsale-refresh/read";

/**
 * OR1: F1 / F2 of docs/design-record/2026-11-12-on-sale-refresh.html as
 * drawn — a shadow run on Thu 12 Nov over the data to Wed 11 Nov, read as
 * the w/c 9 Nov cycle refresh would read it. The figures are the record's
 * (its 12 Nov read, before the budget was set), not a live read.
 */
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
    why: {
      objective: "Initiate Checkout — 111 reached the pixel since 21 Oct. Last 14 days: 96 IC.",
      purchase: "Purchase campaign not proposed — this show's own purchases aren't read yet. Attributed to these ads: 1 purchase in 14 days, any show on this pixel.",
      purchaseNarrow: "No Purchase campaign: 1 attributed purchase in 14 days, any show.",
      moves: "Budget moves stay inside each campaign.",
      ticketing: "No linked ticketing: the pixel's purchases can't be checked against real sales.",
    },
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

export const REFRESH_FRAME_IDS = ["OR1"] as const;
export const REFRESH_FRAME_WIDTHS = [1280, 393] as const;
