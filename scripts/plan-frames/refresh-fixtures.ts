import type { PanelApply, PanelProposal } from "@/lib/onsale-refresh/read";

import { ONSALE_PHASE } from "../../lib/onsale-refresh/phase-config.ts";
import { mainRow, planPurchaseCampaign, planSentence, runningForm, type PcMain } from "../../lib/onsale-refresh/purchase-campaign.ts";
import { appliedText, failedBeforeLive } from "../../lib/onsale-refresh/apply-purchase.ts";
import { NO_AUDIENCE_TO_COPY, scaleAppliedText, scalePurchase } from "../../lib/onsale-refresh/purchase-scale.ts";
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
 * copied from Adv+ (starts at £14.50 a day from plan headroom). Purchase: the
 * retargeting standing default (starts at £3.80 a day from plan headroom), the
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
  write: "New ad set: a copy of Adv+ (£6.10 per IC) with these interests · 6 creatives reused · starts at £14.50 a day, Adv+'s daily budget, from plan headroom · goes in live",
  narrowWrite: "New ad set from Adv+ · starts at £14.50 a day from plan headroom · live",
};
export const OR8_RETARGETING = {
  detail: "This campaign has no retargeting ad set.",
  extra: "Builds 4 audiences, targeted together: landing-page visitors 1840 · ticket-link visitors 412 · video viewers · registrations 3105 (our counts, last 30–180 days)",
  write: "New audience and ad set: a copy of Broad — Primary aimed at this audience only · 4 creatives reused · starts at £3.80 a day, Broad — Primary's daily budget, from plan headroom · goes in live",
  narrowWrite: "New audience and ad set from Broad — Primary · starts at £3.80 a day from plan headroom · live",
};
export const OR8_LOOKALIKE = {
  detail: "The registrations lookalike isn't in its own ad set.",
  extra: "Seed: 64 registrations on the pixel · 1 % lookalike in GB",
  write: "New audience and ad set: a copy of Broad — Primary aimed at this audience only · 4 creatives reused · starts at £3.80 a day, Broad — Primary's daily budget, from plan headroom · goes in live",
  narrowWrite: "New audience and ad set from Broad — Primary · starts at £3.80 a day from plan headroom · live",
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

/**
 * PF1–PF3 (P4, docs/design-record/2026-11-14-purchase-campaigns.html): the
 * Objective and Budget blocks only, built by the rules (purchaseWhy,
 * planPurchaseCampaign, planSentence, mainRow), never typed.
 *
 * PF1 (and PF3a at 393): P26-BDAY as the record reads it — data to Thu 12
 * Nov, the On Sale campaign's 30 Oct – 12 Nov at £669.95 and 76 IC, 1
 * attributed purchase, the £4,500 budget and £2,025.66 spent to 12 Nov (PC11: the
 * day shown is the last day the figure covers; £2,051.30 is to 13 Nov). Skiddle's
 * share (74 % of 389) is the record's example.
 *
 * PF2 (and PF3b at 393): NX26-LOCKLEAD Proposed. Real: On Sale's ad sets
 * 6 – 12 Nov (Lineup - Suggested 8 attributed purchases for £217.77 and 80
 * IC; Venue 13 IC for £18.72), its £247.32 and 97 IC, its spend to date
 * £272.41, the pixel and its name, the 11 Dec show and no event budget.
 * The record's examples: the count of 17, On Sale's £1,500 lifetime (so
 * the cap, £245.52), Skiddle's 81 % of 836, and the ads' convert scores.
 */
const PF_BDAY_READ = read("platform_under_bar", {
  domainKind: "no_own_domain",
  cirqlinPage: true,
  platform: "Skiddle",
  platformShare: { purchases: 288, pixelPurchases: 389, share: 288 / 389, elsewhereHost: null },
  attributedOnPixel: credited(1, "2026-10-30", false),
  attributedPurchases: { count: 1, scope: "any_show_on_pixel" },
});

const PF_BDAY_MAIN: PcMain = {
  campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale",
  campaignId: null,
  resultEvent: "initiate_checkout",
  from: "2026-10-30",
  to: "2026-11-12",
  spend: 669.95,
  results: 76,
  purchases: 1,
  adSets: [],
  ads: [],
  spentToDate: 669.95,
  last7Daily: 0,
  lifetimeGbp: null,
  draftId: null,
  adAccountId: null,
};

export const PF1_WHY: PanelProposal["why"] = {
  objective: "Initiate Checkout — 76 reached the pixel since 30 Oct. Last 14 days: 76 IC.",
  ...purchaseWhy(PF_BDAY_READ, false, ONSALE_PHASE),
  purchaseCampaign: { state: "not_proposed", sentence: null, sentenceNarrow: null },
  budget: { plan: planSentence(4500, 2025.66, "2026-11-12"), main: mainRow(PF_BDAY_MAIN, "platform") },
};

const PF_LOCKLEAD_READ = read("platform_proposed", {
  ...NX_MISMATCH,
  domain: "locklead-newcastle.com",
  domainVia: "signup_url",
  onDomain: { d14: 0, d28: 0, history: 0 },
  platform: "Skiddle",
  platformShare: { purchases: 677, pixelPurchases: 836, share: 677 / 836, elsewhereHost: "ra.co" },
  attributedOnPixel: credited(17, "2026-11-06", true),
});

const set = (name: string, spend: number, results: number, purchases: number, adsetId: string) => ({ adsetId, adsetIds: [adsetId], name, spend, results, purchases, delivering: true });
const ad = (name: string, convertScore: number, adId: string) => ({ adId, adsetId: "120252504502750755", name, convertScore, deliveringNow: true });

export const PF_LOCKLEAD_MAIN: PcMain = {
  campaignKey: "[NX26-LOCKLEAD] On Sale",
  campaignId: "120252504416990755",
  resultEvent: "initiate_checkout",
  from: "2026-11-06",
  to: "2026-11-12",
  spend: 247.32,
  results: 97,
  purchases: 8,
  adSets: [
    set("Lineup - Suggested", 217.77, 80, 8, "120252504502750755"),
    set("Venue", 18.72, 13, 0, "120252504417580755"),
    set("Tech House Pages", 2.74, 1, 0, "120252504419380755"),
    set("Disco Pages", 2.54, 1, 0, "120252504418370755"),
    set("Electronic dance music (music), Disco", 1.56, 1, 0, "120252504421700755"),
    set("Lineup - direct", 0.37, 0, 0, "120252504417890755"),
  ],
  ads: [ad("Artist - UGC 3", 71, "a1"), ad("Artist - Static", 64, "a2"), ad("Artist - UGC 2", 58, "a3"), ad("Artist - UGC 1", 41, "a4"), ad("Venue - Static", 37, "a5"), ad("Lineup - Static", 30, "a6")],
  spentToDate: 272.41,
  last7Daily: Math.round((247.32 / 7) * 100) / 100,
  lifetimeGbp: 1500,
  draftId: "fixture",
  adAccountId: "act_1073273492854557",
};

export const PF2_PLAN = planPurchaseCampaign({
  eventCode: "NX26-LOCKLEAD",
  eventName: "Locklead",
  runDay: "2026-11-16",
  eventDate: "2026-12-11",
  read: PF_LOCKLEAD_READ,
  existing: null,
  main: PF_LOCKLEAD_MAIN,
  budgetGbp: null,
  spendToDateGbp: 349.53,
  committedGbp: null,
});

export const PF2_WHY: PanelProposal["why"] = {
  objective: "Initiate Checkout — 97 reached the pixel since 6 Nov. Last 14 days: 97 IC.",
  ...purchaseWhy(PF_LOCKLEAD_READ, false, ONSALE_PHASE),
  purchaseCampaign: { state: PF2_PLAN.state, sentence: PF2_PLAN.sentence, sentenceNarrow: PF2_PLAN.sentenceNarrow },
  budget: { plan: null, main: mainRow(PF_LOCKLEAD_MAIN, "platform") },
};

const PF2_CARD = PF2_PLAN.card!;
const PF2_LINE: PanelProposal["lines"][number] = {
  id: "pf2",
  kind: "purchase_campaign",
  title: PF2_CARD.campaignName,
  detail: PF2_CARD.optimises,
  writeText: PF2_CARD.byRate[String(PF2_CARD.defaultRate)]!.writes,
  narrow: { detail: PF2_CARD.optimisesNarrow, writeText: null },
  addsSpend: false,
  blockedReason: null,
  supply: false,
  state: "to_review",
  reason: null,
  writeKind: "purchase_campaign_create",
  card: PF2_CARD,
  dailyGbp: null,
};

const PF_WEEK = { runKind: "shadow" as const, runDay: "2026-11-14", cycleMonday: "2026-11-16", cycleKind: "content" as const, windowStart: "2026-11-06", windowEnd: "2026-11-12", nextCheck: "2026-11-16", nextCycle: "2026-11-23", nextCycleKind: "payday" as const };
const PF_EMPTY = { createdAt: "2026-11-14T08:00:00Z", blockers: [], enoughData: true, notEnoughData: null, watch: { creatives: [], audiences: [] }, notes: { pauses: "", drops: "", adds: "" }, mode: "shadow" as const, objective: "initiate_checkout" as const };

export const PF1_PROPOSALS: PanelProposal[] = [{ id: "pf1", campaignKey: "[P26-BDAY] Puzzle - 27 Dec - On Sale", campaignSummary: null, ...PF_WEEK, ...PF_EMPTY, why: PF1_WHY, lines: [] }];
export const PF2_PROPOSALS: PanelProposal[] = [{ id: "pf2", campaignKey: "[NX26-LOCKLEAD] On Sale", campaignSummary: null, ...PF_WEEK, ...PF_EMPTY, why: PF2_WHY, lines: [PF2_LINE] }];

/**
 * PF4 (P4 PR C): Locklead two weeks later, every figure the record's
 * example. The Mon 30 Nov mid-cycle check: the Purchase campaign has run
 * 14 days at £5 a day, £70 of its £130 spent for 6 attributed purchases;
 * On Sale £560 for 14 since Mon 16 Nov, £850 spent to date at £40 a day,
 * lifetime £1,370. The Scale line is built by scalePurchase; then the same
 * lines after Apply, in F3's form.
 */
const PF4_SCALE = scalePurchase({
  running: { campaignId: "120253000000000755", campaignName: "[NX26-LOCKLEAD] Locklead - Purchase", mainCampaignId: "120252504416990755", mainCampaignKey: "[NX26-LOCKLEAD] On Sale", mainShort: "On Sale", startedOn: "2026-11-16", lastStepOn: null, rate: 5, copied: { ids: [], names: [] }, ads: [], pixelId: NX_PIXEL, path: "platform" },
  runDay: "2026-11-30",
  windowEnd: "2026-11-29",
  eventDate: "2026-12-11",
  signalHolds: true,
  purchase: { spend: 70, purchases: 6, spentToDate: 70, lifetime: 130 },
  main: { spend: 560, purchases: 14, spentToDate: 850, lifetime: 1370, last7Daily: 40 },
  budgetGbp: null,
  spendToDateGbp: 920,
  committedGbp: null,
});
if (PF4_SCALE.kind !== "line") throw new Error("PF4's figures must step up");

const PF4_RUNNING_READ = read("platform_proposed", { ...NX_MISMATCH, pixel: { id: NX_PIXEL, source: "ad_sets" as const, spendShare: 1, stored: NX_PIXEL, matches: true }, platform: "Skiddle", platformShare: { purchases: 677, pixelPurchases: 836, share: 677 / 836, elsewhereHost: "ra.co" }, attributedOnPixel: credited(31, "2026-11-16", false) });
const PF4_WHY_BASE = purchaseWhy(PF4_RUNNING_READ, false, ONSALE_PHASE);
export const PF4_WHY: PanelProposal["why"] = {
  ...PF4_WHY_BASE,
  ...runningForm(PF4_WHY_BASE.purchase, PF4_WHY_BASE.purchaseNarrow),
  objective: "",
  ticketing: null,
  pixel: [],
  pixelNarrow: [],
  purchaseCampaign: { state: "running", sentence: null, sentenceNarrow: null },
  budget: { plan: null, main: null },
};

const PF4_LINE = (over: Partial<PanelProposal["lines"][number]> & Pick<PanelProposal["lines"][number], "id" | "kind" | "title" | "state">): PanelProposal["lines"][number] => ({
  detail: "",
  writeText: "",
  narrow: { detail: "", writeText: null },
  addsSpend: false,
  blockedReason: null,
  supply: false,
  reason: null,
  ...over,
});

const PF4_WEEK = { runKind: "mid_cycle" as const, runDay: "2026-11-30", cycleMonday: "2026-11-23", cycleKind: "payday" as const, windowStart: "2026-11-23", windowEnd: "2026-11-29", nextCheck: "2026-12-07", nextCycle: "2026-12-07", nextCycleKind: "content" as const };
const PF4_BASE = { createdAt: "2026-11-30T06:00:00Z", blockers: [], enoughData: true, notEnoughData: null, watch: { creatives: [], audiences: [] }, mode: "live" as const, objective: "initiate_checkout" as const, campaignSummary: null, campaignKey: "[NX26-LOCKLEAD] On Sale" };

export const PF4_PROPOSALS: PanelProposal[] = [
  {
    id: "pf4",
    ...PF4_WEEK,
    ...PF4_BASE,
    why: PF4_WHY,
    notes: { pauses: "", drops: "", adds: "", purchase: { hold: null, copy: NO_AUDIENCE_TO_COPY, cap: PF4_SCALE.capText } },
    lines: [PF4_LINE({ id: "pf4-scale", kind: "scale_purchase", title: PF4_SCALE.title, detail: PF4_SCALE.detail, writeText: PF4_SCALE.writeText, narrow: { detail: PF4_SCALE.narrowDetail, writeText: PF4_SCALE.narrowWrite }, state: "accepted", writeKind: "purchase_scale" })],
  },
];

export const PF4_AFTER: PanelProposal[] = [
  {
    id: "pf4-after",
    ...PF4_WEEK,
    ...PF4_BASE,
    why: { ...PF4_WHY, purchase: "", purchaseNarrow: "", attributed: null, context: null, contextNarrow: null, moves: "", purchaseCampaign: { state: "running", sentence: null, sentenceNarrow: null } },
    notes: { pauses: "", drops: "", adds: "" },
    lines: [
      PF4_LINE({ id: "pf4-pc", kind: "purchase_campaign", title: "[NX26-LOCKLEAD] Locklead - Purchase", state: "applied", reason: appliedText({ adSets: 2, ads: 3, rate: 5, lifetime: 130, endDay: "2026-12-11", headroom: 0, moved: 130, mainShort: "On Sale" }), appliedAt: "2026-11-16T08:37:00Z", card: PF2_CARD, endDay: "2026-12-11", writeKind: "purchase_campaign_create" }),
      PF4_LINE({ id: "pf4-pc-failed", kind: "purchase_campaign", title: "[NX26-LOCKLEAD] Locklead - Purchase", state: "failed", reason: failedBeforeLive("Meta refused an ad set: its audience is too small", { campaignId: "c" }, "On Sale"), card: PF2_CARD, endDay: "2026-12-11", writeKind: "purchase_campaign_create" }),
      PF4_LINE({ id: "pf4-scale-applied", kind: "scale_purchase", title: PF4_SCALE.title, state: "applied", reason: scaleAppliedText(PF4_SCALE.write, "On Sale"), appliedAt: "2026-11-30T08:44:00Z", writeKind: "purchase_scale" }),
    ],
  },
];

export const OR_APPLY_P4: PanelApply = { ...OR_APPLY_LIVE, campaignCreateEnabled: true, lifetimeBudgetWritesEnabled: true };

export const REFRESH_FRAME_IDS = ["OR1", "OR2", "OR3", "OR4", "OR5", "OR6", "OR7", "OR8", "OR9", "OR10", "PF1", "PF2", "PF4"] as const;
export const REFRESH_FRAME_WIDTHS = [1280, 393] as const;
