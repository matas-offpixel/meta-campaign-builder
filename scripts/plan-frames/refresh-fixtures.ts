import type { PanelApply, PanelProposal } from "@/lib/onsale-refresh/read";

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

/**
 * OR6 / OR7: P2 (Accept and apply, creatives) on P26-BDAY.
 *
 * OR6 is F1 with Accept and Reject live: the event armed Live, the
 * deployment gate on and the £4,500 budget set (Matas's ruling), so the
 * budget blocker is gone. Its figures are the 12 Nov shadow run's (data to
 * Wed 11 Nov): £650.38 · 75 IC since 30 Oct, the two Enzo quote adds, the
 * roll-call claim, and the within-campaign move. One add is accepted, one
 * is still to review, a third was rejected as the wrong creative.
 *
 * OR7 is F3: the w/c 23 Nov payday cycle after Apply, by Matas. Its
 * figures are illustrative, as the record's F3 says. P3: the bring-back
 * was applied ("Applied · on"); the drop was rejected as too early.
 *
 * OR8 (P3) is the audience and budget lines live before Accept, on the
 * w/c 7 Dec content cycle, two campaigns (both on ad-set budgets), figures
 * illustrative: £4,500 budget, £3,860.00 spent, so £640.00 left, 20 days
 * to the show and a £128.00 move cap, £100.00 of it already moved by the
 * On Sale campaign. On Sale: one bring-back acceptable (£9.10 a day × 20 =
 * £182.00), one held by the plan guard (£34.00 × 20 = £680.00), the drop
 * accepted, the move applied, and the interest cluster as a new ad set
 * copied from Adv+ (£14.50 a day from plan headroom). Purchase: the
 * retargeting standing default (£3.80 a day from plan headroom), the
 * registrations lookalike held at a seed of 64, and a move into its
 * lookalike set held by the cap (£30.00 > £28.00 free). The Purchase
 * campaign has no retargeting ad set, so nothing in it names one. Cluster
 * indexes are design's (baseline cost ÷ the cluster's, ≥ 1.2): 1.25 and
 * 1.35, i.e. stored cost indexes 0.8 and 0.74.
 *
 * OR9 (P3) is their F3 results after Apply, figures illustrative: the
 * cluster's new ad set live with 6 ads and one retired interest left out;
 * retargeting's 4 audiences made and its ad set live with 4 ads (the Purchase
 * campaign on a campaign budget, so it shares it); the lookalike's audience
 * still being built (Retry); and a second cluster live with 4 of 6 ads.
 *
 * The copy under each add is a stand-in: the frames never read the
 * campaign draft, whose own copy is what the real panel shows.
 */
const OR_COPY: NonNullable<PanelProposal["lines"][number]["copy"]> = {
  primaryText: "Puzzle turns four. Enzo Siragusa, Luke Dean and friends close the year at Puzzle — Sunday 27 December.",
  headline: "Puzzle 4th Birthday",
  cta: "buy_tickets",
  destinationUrl: "https://www.skiddle.com/whats-on/London/Puzzle/Puzzle-4th-Birthday/41234567/",
};

export const OR_APPLY_LIVE: PanelApply = { mode: "live", arm: "live", globalEnabled: true, pauseWritesEnabled: false, adsetStatusWritesEnabled: true, budgetWritesEnabled: true, audienceWritesEnabled: true, budgetSet: true };

const OR6_ADD = (id: string, title: string, state: PanelProposal["lines"][number]["state"], reason: string | null = null): PanelProposal["lines"][number] => ({
  id,
  kind: "add_creative",
  title,
  detail: "Enzo Siragusa / Videos / UGC · approved final · content cycle",
  writeText: "New ad in each delivering ad set (3) · launch path · goes in live",
  narrow: { detail: "Enzo Siragusa / Videos / UGC · content cycle", writeText: "New ad in each delivering ad set · live" },
  addsSpend: false,
  blockedReason: null,
  supply: false,
  state,
  reason,
  copy: OR_COPY,
});

export const OR6_PROPOSALS: PanelProposal[] = [
  {
    ...OR1_PROPOSALS[0]!,
    id: "or6",
    mode: "live",
    campaignSummary: "30 Oct – 11 Nov · £650.38 · 75 IC · £8.67 each",
    blockers: [],
    watch: {
      creatives: [{ title: "Puzzle - 4th Birthday - Static", detail: "20 ads · £26.20 · 0 IC · convert 23, not yet significant", narrow: "Puzzle - 4th Birthday - Static · £26.20 · 0 IC", evidence: {} }],
      audiences: [],
    },
    notes: { pauses: "No pauses: no creative has enough evidence.", drops: "No drops: none qualifies.", adds: "Files uploaded by hand in Ads Manager aren't matched." },
    lines: [
      OR6_ADD("l1", "P26-BDAY_enzo-siragusa-4_quote-on-sale_r1_9x16", "accepted"),
      OR6_ADD("l2", "P26-BDAY_enzo-siragusa-3_quote-on-sale_r1_9x16", "to_review"),
      { ...OR6_ADD("l3", "P26-BDAY_enzo-siragusa_roll-call-cta_r1_9x16", "rejected", "Wrong creative"), detail: "Enzo Siragusa / Videos / CTA · approved final · content cycle", narrow: { detail: "Enzo Siragusa / Videos / CTA · content cycle", writeText: "New ad in each delivering ad set · live" } },
      { ...OR1_PROPOSALS[0]!.lines[2]!, id: "l4" },
      {
        id: "l5",
        kind: "move_budget",
        title: "Lineup — Primary → Adv+",
        detail: "£14.18 per IC (1.72×) to £5.80 per IC (0.7×) · £14.18 a week · cap £501.17 (20 % of £2,505.85 remaining)",
        writeText: "Ad-set budget write, both sides",
        narrow: { detail: "£14.18 a week · cap £501.17", writeText: null },
        addsSpend: false,
        blockedReason: null,
        supply: false,
        state: "to_review",
        reason: null,
        writeKind: "adset_budget_move",
      },
    ],
  },
];

export const OR7_PROPOSALS: PanelProposal[] = [
  {
    ...OR6_PROPOSALS[0]!,
    id: "or7",
    runKind: "cycle",
    runDay: "2026-11-23",
    cycleMonday: "2026-11-23",
    cycleKind: "payday",
    windowStart: "2026-11-16",
    windowEnd: "2026-11-22",
    nextCheck: "2026-11-30",
    nextCycle: "2026-12-07",
    nextCycleKind: "content",
    campaignSummary: "30 Oct – 22 Nov · £1,148.60 · 131 IC · £8.77 each",
    watch: { creatives: [], audiences: [] },
    notes: { pauses: "No pauses: no creative has enough evidence.", drops: "", adds: "Files uploaded by hand in Ads Manager aren't matched." },
    lines: [
      {
        ...OR6_ADD("f1", "P26-BDAY_luke-dean_artist-card-3_on-sale_9x16_v1", "applied", "6 ads live"),
        detail: "Luke Dean / Statics / CTA · approved final · payday cycle",
        narrow: { detail: "Luke Dean / Statics / CTA · payday cycle", writeText: "New ad in each delivering ad set · live" },
        appliedAt: "2026-11-23T08:41:00Z",
        appliedBy: "Matas",
      },
      {
        ...OR6_ADD("f2", "P26-BDAY_enzo-siragusa-5_caption-artist-on-sale_r1_9x16", "failed", "Meta didn't take this file — the video is still processing."),
        detail: "Enzo Siragusa / Videos / UGC · approved final · payday cycle",
        narrow: { detail: "Enzo Siragusa / Videos / UGC · payday cycle", writeText: "New ad in each delivering ad set · live" },
      },
      {
        id: "f3",
        kind: "bring_back_audience",
        title: "Electronic dance music, Electronic music",
        detail: "Stopped 6 Nov · £36.85 · 12 IC · £3.07 each, 0.4× the campaign",
        writeText: "Ad set status → on · its own budget",
        narrow: { detail: "£36.85 · 12 IC · £3.07 each, 0.4×", writeText: null },
        addsSpend: true,
        blockedReason: null,
        supply: false,
        state: "applied",
        reason: "on",
        appliedAt: "2026-11-23T08:41:00Z",
        appliedBy: "Matas",
        writeKind: "adset_status",
      },
      {
        id: "f4",
        kind: "drop_audience",
        title: "Lineup — Primary",
        detail: "£41.20 · 2 IC · £20.60 each, 2.35× the campaign · live 24 days",
        writeText: "Ad set status → off",
        narrow: { detail: "£41.20 · 2 IC · £20.60 each, 2.35×", writeText: null },
        addsSpend: false,
        blockedReason: null,
        supply: false,
        state: "rejected",
        reason: "Too early",
        writeKind: "adset_status",
      },
    ],
  },
];

const OR8_LINE = (line: Partial<PanelProposal["lines"][number]> & Pick<PanelProposal["lines"][number], "id" | "kind" | "title" | "detail" | "writeText">): PanelProposal["lines"][number] => ({
  narrow: { detail: line.detail, writeText: null },
  addsSpend: false,
  blockedReason: null,
  supply: false,
  state: "to_review",
  reason: null,
  ...line,
});

/** OR8's and OR9's sentences are the rules' own (pinned by lib/onsale-refresh/__tests__/p3.test.ts against planGuard, moveGuard and new-adset.ts). */
export const OR8_PLAN_GUARD = "Turning it on would spend about £680.00 before the show, more than the £640.00 left in the plan.";
export const OR8_MOVE_CAP = "Moving £30.00 would pass this refresh's 20 % cap: £128.00 of the £640.00 left, £28.00 still free.";
export const OR8_SEED = "Too few registrations for a lookalike yet: 64 of 100.";
export const OR8_CLUSTER = {
  detail: "Interest cluster · index 1.25 · confidence ok · not on this event",
  extra: "Interests: Disc Genre, Minimal techno, Deep house +4",
  narrow: "Cluster · index 1.25 · 7 interests",
  write: "New ad set: a copy of Adv+ (£6.10 per IC) with these interests · 6 creatives reused · £14.50 a day from plan headroom · goes in live",
  narrowWrite: "New ad set from Adv+ · £14.50 a day from plan headroom · live",
};
export const OR8_RETARGETING = {
  detail: "This campaign has no retargeting ad set.",
  extra: "Builds 4 audiences, targeted together: landing-page visitors 1840 · ticket-link visitors 412 · video viewers · registrations 3105 (our counts, last 30–180 days)",
  write: "New audience and ad set: a copy of Broad — Primary aimed at this audience only · 4 creatives reused · £3.80 a day from plan headroom · goes in live",
  narrowWrite: "New audience and ad set from Broad — Primary · £3.80 a day from plan headroom · live",
};
export const OR8_LOOKALIKE = {
  detail: "The registrations lookalike isn't in its own ad set.",
  extra: "Seed: 64 registrations on the pixel · 1 % lookalike in GB",
  write: "New audience and ad set: a copy of Broad — Primary aimed at this audience only · 4 creatives reused · £3.80 a day from plan headroom · goes in live",
  narrowWrite: "New audience and ad set from Broad — Primary · £3.80 a day from plan headroom · live",
};

const OR8_WEEK = { runKind: "cycle" as const, runDay: "2026-12-07", cycleMonday: "2026-12-07", cycleKind: "content" as const, windowStart: "2026-11-30", windowEnd: "2026-12-06", nextCheck: "2026-12-14", nextCycle: null, nextCycleKind: null, watch: { creatives: [], audiences: [] } };

export const OR8_PROPOSALS: PanelProposal[] = [
  {
    ...OR6_PROPOSALS[0]!,
    ...OR8_WEEK,
    id: "or8a",
    campaignSummary: "30 Oct – 6 Dec · £2,870.40 · 318 IC · £9.03 each",
    notes: { pauses: "No pauses: no creative has enough evidence.", drops: "", adds: "Files uploaded by hand in Ads Manager aren't matched." },
    lines: [
      OR8_LINE({ id: "a1", kind: "bring_back_audience", title: "Electronic dance music, Electronic music", detail: "Stopped 6 Nov · £36.85 · 12 IC · £3.07 each, 0.34× the campaign", narrow: { detail: "£36.85 · 12 IC · £3.07 each, 0.34×", writeText: null }, writeText: "Ad set status → on · its own budget", addsSpend: true, writeKind: "adset_status" }),
      OR8_LINE({ id: "a2", kind: "bring_back_audience", title: "Lineup Suggestion — Primary", detail: "Stopped 3 Nov · £41.77 · 12 IC · £3.48 each, 0.39× the campaign", narrow: { detail: "£41.77 · 12 IC · £3.48 each, 0.39×", writeText: null }, writeText: "Ad set status → on · its own budget", addsSpend: true, blockedReason: OR8_PLAN_GUARD, writeKind: "adset_status" }),
      OR8_LINE({ id: "a5", kind: "bring_back_audience", title: "Disc Genre", detail: OR8_CLUSTER.detail, extra: OR8_CLUSTER.extra, narrow: { detail: OR8_CLUSTER.narrow, writeText: OR8_CLUSTER.narrowWrite }, writeText: OR8_CLUSTER.write, writeKind: "new_adset" }),
      OR8_LINE({ id: "a3", kind: "drop_audience", title: "1% Lookalike – Data — Primary", detail: "£46.20 · 2 IC · £23.10 each, 2.56× the campaign · live 38 days", narrow: { detail: "£46.20 · 2 IC · £23.10 each, 2.56×", writeText: null }, writeText: "Ad set status → off", state: "accepted", writeKind: "adset_status" }),
      OR8_LINE({ id: "a4", kind: "move_budget", title: "Lineup — Primary → Adv+", detail: "£14.80 per IC (1.64×) to £6.10 per IC (0.68×) · £100.00 a week · cap £128.00 (20 % of £640.00 remaining)", narrow: { detail: "£100.00 a week · cap £128.00", writeText: null }, writeText: "Ad-set budget write, both sides", state: "applied", reason: "£100.00 a week moved", appliedAt: "2026-12-07T08:52:00Z", appliedBy: "Matas", writeKind: "adset_budget_move" }),
    ],
  },
  {
    ...OR6_PROPOSALS[0]!,
    ...OR8_WEEK,
    id: "or8b",
    campaignKey: "[P26-BDAY] Puzzle - 27 Dec - Purchase",
    campaignSummary: "16 Nov – 6 Dec · £1,309.60 · 141 IC · £9.29 each",
    notes: { pauses: "No pauses: no creative has enough evidence.", drops: "No drops: none qualifies.", adds: "" },
    lines: [
      OR8_LINE({ id: "b3", kind: "missing_default", title: "Retargeting", detail: OR8_RETARGETING.detail, extra: OR8_RETARGETING.extra, narrow: { detail: OR8_RETARGETING.detail, writeText: OR8_RETARGETING.narrowWrite }, writeText: OR8_RETARGETING.write, writeKind: "new_adset" }),
      OR8_LINE({ id: "b4", kind: "missing_default", title: "Registrations lookalike", detail: OR8_LOOKALIKE.detail, extra: OR8_LOOKALIKE.extra, narrow: { detail: OR8_LOOKALIKE.detail, writeText: OR8_LOOKALIKE.narrowWrite }, writeText: OR8_LOOKALIKE.write, blockedReason: OR8_SEED, writeKind: "new_adset" }),
      OR8_LINE({ id: "b2", kind: "move_budget", title: "Broad — Primary → Lookalike 2% — Primary", detail: "£16.40 per IC (1.77×) to £5.20 per IC (0.56×) · £30.00 a week · cap £128.00 (20 % of £640.00 remaining)", narrow: { detail: "£30.00 a week · cap £128.00", writeText: null }, writeText: "Ad-set budget write, both sides", blockedReason: OR8_MOVE_CAP, writeKind: "adset_budget_move" }),
    ],
  },
];

/** OR9's F3 sentences (design's ruling), pinned against new-adset.ts. */
export const OR9_RESULTS = {
  cluster: "new ad set live, 6 ads. Left out, no longer offered by Meta: Minimal techno.",
  retargeting: "4 audiences made, new ad set live, 4 ads",
  building: "Meta didn't take this — the audience is still being built. Retry in a few hours.",
  partial: "Ad set live · 4 of 6 ads — Meta didn't take this — it's limiting calls on this account. Retry in a few minutes.",
};

export const OR9_PROPOSALS: PanelProposal[] = [
  {
    ...OR8_PROPOSALS[0]!,
    id: "or9a",
    lines: [
      { ...OR8_PROPOSALS[0]!.lines.find((line) => line.id === "a5")!, state: "applied", reason: OR9_RESULTS.cluster, appliedAt: "2026-12-07T09:04:00Z", appliedBy: "Matas" },
      OR8_LINE({
        id: "a6",
        kind: "bring_back_audience",
        title: "Melodic Techno",
        detail: "Interest cluster · index 1.35 · confidence ok · not on this event",
        extra: "Interests: Melodic techno, Afterlife, Tale Of Us +2",
        narrow: { detail: "Cluster · index 1.35 · 5 interests", writeText: "New ad set from Adv+ · £14.50 a day from plan headroom · live" },
        writeText: "New ad set: a copy of Adv+ (£6.10 per IC) with these interests · 6 creatives reused · £14.50 a day from plan headroom · goes in live",
        state: "failed",
        reason: OR9_RESULTS.partial,
        writeKind: "new_adset",
      }),
    ],
  },
  {
    ...OR8_PROPOSALS[1]!,
    id: "or9b",
    campaignSummary: "16 Nov – 6 Dec · £1,309.60 · 141 IC · £9.29 each",
    lines: [
      { ...OR8_PROPOSALS[1]!.lines.find((line) => line.id === "b3")!, writeText: "New audience and ad set: a copy of Broad — Primary aimed at this audience only · 4 creatives reused · shares the campaign budget · goes in live", narrow: { detail: OR8_RETARGETING.detail, writeText: "New audience and ad set from Broad — Primary · shares the campaign budget · live" }, state: "applied", reason: OR9_RESULTS.retargeting, appliedAt: "2026-12-07T09:04:00Z", appliedBy: "Matas" },
      {
        ...OR8_PROPOSALS[1]!.lines.find((line) => line.id === "b4")!,
        extra: "Seed: 3105 registrations on the pixel · 1 % lookalike in GB",
        writeText: "New audience and ad set: a copy of Broad — Primary aimed at this audience only · 4 creatives reused · shares the campaign budget · goes in live",
        narrow: { detail: OR8_LOOKALIKE.detail, writeText: "New audience and ad set from Broad — Primary · shares the campaign budget · live" },
        blockedReason: null,
        state: "failed",
        reason: OR9_RESULTS.building,
      },
    ],
  },
];

/**
 * OR10 (P5): the refresh learning from its own moves, on OR6's live panel.
 * The move's rule has a low track record for this client (right 3 of 10:
 * under 40 %), so it sorts last and says "low track record" (the record's
 * words). Two rules are stopped for the client, and the panel says so:
 * pauses on their hit rate (right 4 of 21: under 25 % over 20) and
 * interest-cluster bring-backs on a rejection streak (Too early, 5 times
 * in a row). Design's words (#1229 verdict), pinned against stoppedText by
 * lib/onsale-refresh/__tests__/scoring.test.ts. Each notice has its
 * "Propose again" action under it.
 */
export const OR10_STOPPED = [
  { ruleId: "pause.significant_bottom_third", text: "Pause creative lines stopped for this client: right 4 of 21 times." },
  { ruleId: "bring_back.client_cluster", text: "Bring back an interest cluster lines stopped for this client: rejected as “Too early” 5 times in a row." },
];

export const OR10_PROPOSALS: PanelProposal[] = [
  {
    ...OR6_PROPOSALS[0]!,
    id: "or10",
    notes: { ...OR6_PROPOSALS[0]!.notes, stopped: OR10_STOPPED },
    // The move sorts last among the lines (it already was) and carries the record's words.
    lines: OR6_PROPOSALS[0]!.lines.map((line) => (line.kind === "move_budget" ? { ...line, trackRecord: "low" as const } : line)),
  },
];

export const REFRESH_FRAME_IDS = ["OR1", "OR2", "OR3", "OR4", "OR5", "OR6", "OR7", "OR8", "OR9", "OR10"] as const;
export const REFRESH_FRAME_WIDTHS = [1280, 393] as const;
