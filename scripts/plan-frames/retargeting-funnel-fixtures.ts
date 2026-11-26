/**
 * The retargeting funnel's frames (docs/design-record/2026-11-26-retargeting-funnel.html,
 * RF-A, RF-B, RF-C, RF-E), built by the rules (planRetargeting, the funnel's
 * plan and Claude's lines), not typed: a frame can only show what the panel
 * or Claude would say for these inputs.
 *
 * NX26-RUDIMENTAL's code, venue (Newcastle) and show date (Sat 12 Dec) are
 * real; its money, ad set names, support artists and every figure are the
 * record's invented ones. XMPL shows are invented. No fan or staff data.
 *
 * The show's daily spend is £60.00: Broad · Advantage+ £36.00, Interests ·
 * drum & bass £14.00, Lookalike 1 % £10.00. Announced Tue 29 Sep, so
 * announce runs to Mon 12 Oct and "normally" starts Tue 13 Oct.
 *
 * RF-A: the Create line on Thu 1 Oct (announce), on Sat 5 Dec (final week),
 *       and XMPL-ROOF, whose prospecting can give £7.00 of its £10.00.
 * RF-B: the campaign running on Sat 28 Nov (final 2 weeks, £24.00): Hot at
 *       frequency 3.6 capped at £5.20, its £3.20 to Warm; Cold at 3.2
 *       capped at £3.50, its £1.30 back to Broad.
 * RF-C: the campaign made on Thu 26 Nov (final month, £21.00) with MC Fenn's
 *       Instagram and Dawn Ray's Facebook Page missing advertiser access.
 * RF-E: what Claude is told: plan_retargeting(NX26-RUDIMENTAL) on 26 Nov,
 *       the rollout's head and three skipped shows, and a paused create.
 */

import type { PanelLine } from "@/lib/onsale-refresh/read";

import { ONSALE_PHASE } from "../../lib/onsale-refresh/phase-config.ts";
import type { PurchaseRead } from "../../lib/onsale-refresh/purchases.ts";
import { planRetargeting, type RetargetingInput, type RetargetingView } from "../../lib/retargeting/plan.ts";
import type { FunnelAccount, ProspectingBudget } from "../../lib/retargeting/funnel.ts";
import { claudePlanLines, doneLine, planHead, skipLine } from "../../lib/retargeting/funnel-plan.ts";
import { funnelSourcesOf } from "../../lib/retargeting/funnel-view.ts";

export const FUNNEL_FRAME_IDS = ["RF-A", "RF-B", "RF-C", "RF-E"] as const;

const SHOW = "2026-12-12";
const ANNOUNCED = "2026-09-29";

function read(): PurchaseRead {
  return {
    state: "platform_under_bar",
    pixel: { id: "1067726194205285", source: "ad_sets", spendShare: 1, stored: "1067726194205285", matches: true },
    pixelName: "NX Newcastle Skiddle",
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
    platformShare: { purchases: 410, pixelPurchases: 512, share: 410 / 512, elsewhereHost: null, elsewherePurchases: 0 },
    attributedOnPixel: null,
    attributedPurchases: { count: 12, scope: "any_show_on_pixel" },
    ticketsSold14: null,
    notRead: null,
  } as PurchaseRead;
}

const BROAD = "Broad · Advantage+";
const PROSPECTING: ProspectingBudget[] = [
  { id: "120000000000000101", kind: "adset", name: BROAD, dailyMinor: 3600, adSets: 1 },
  { id: "120000000000000102", kind: "adset", name: "Interests · drum & bass", dailyMinor: 1400, adSets: 1 },
  { id: "120000000000000103", kind: "adset", name: "Lookalike 1 %", dailyMinor: 1000, adSets: 1 },
];

/** The promoter and two artists, each a Facebook Page with advertiser access (3 accounts). */
const ACCOUNTS: FunnelAccount[] = [
  { pageId: "p1", name: "NX Newcastle", platform: "facebook", kind: "promoter", access: true },
  { pageId: "p2", name: "Rudimental", platform: "facebook", kind: "lineup", access: true },
  { pageId: "p3", name: "Kara Lane", platform: "facebook", kind: "lineup", access: true },
];
const MISSING: FunnelAccount[] = [
  { pageId: "p4", name: "MC Fenn", platform: "instagram", kind: "lineup", access: false },
  { pageId: "p5", name: "Dawn Ray", platform: "facebook", kind: "lineup", access: false },
];

function input(overrides: Partial<RetargetingInput>): RetargetingInput {
  return {
    eventId: "nx26-rudimental",
    eventCode: "NX26-RUDIMENTAL",
    runDay: "2026-10-01",
    eventDate: SHOW,
    onSaleDay: "2026-09-29",
    announceDay: ANNOUNCED,
    read: read(),
    last7SpendGbp: 420,
    minDailyMinor: 100,
    sources: {
      pixelId: "1067726194205285",
      links: [
        { kind: "ticket", rule: "www.skiddle.com/whats-on/Newcastle/NX-Rudimental/1234567/", host: "www.skiddle.com", name: "Skiddle", platform: "skiddle" },
        { kind: "landing", rule: "crqln.com/l/nx26-rudimental", host: "crqln.com", name: "crqln.com/l/nx26-rudimental", platform: null },
      ],
      videos: [
        { contextId: "p1", videoIds: ["v1"] },
        { contextId: "p2", videoIds: ["v2"] },
        { contextId: "p3", videoIds: ["v3"] },
      ],
      pages: [],
      lists: [
        { metaAudienceId: "238000000000001", name: "NX26-RUDIMENTAL · Similar A", role: "similar", uploadedAt: "2026-11-01" },
        { metaAudienceId: "238000000000002", name: "NX26-RUDIMENTAL · Similar B", role: "similar", uploadedAt: "2026-11-01" },
        { metaAudienceId: "238000000000003", name: "NX26-RUDIMENTAL · Buyers", role: "buyers", uploadedAt: "2026-11-20" },
      ],
    },
    accounts: ACCOUNTS,
    existing: null,
    legacy: [],
    budgetGbp: null,
    spendToDateGbp: 0,
    committedGbp: null,
    main: null,
    ads: [{ adId: "1", name: "NX26-RUDIMENTAL · announce" }],
    geoFromAdsetId: "120000000000000101",
    where: { draftId: "00000000-0000-4000-8000-000000000001", adAccountId: "act_1", campaignIds: ["120000000000000100"] },
    today: "2026-10-01",
    linksRead: "ok",
    prospecting: PROSPECTING,
    madeAudiences: [],
    ...overrides,
  };
}

/** A Create line, To review, as the daily read writes it. */
function lineFor(view: RetargetingView, id: string): PanelLine {
  return {
    id,
    kind: "retargeting_campaign",
    title: view.title,
    detail: view.funnel?.shareLine ?? "",
    writeText: view.create?.writeText ?? "",
    narrow: { detail: view.funnel?.create?.split ?? "", writeText: null },
    addsSpend: false,
    blockedReason: null,
    supply: false,
    state: "to_review",
    reason: null,
    writeKind: "retargeting_funnel_create",
    retargeting: view,
    share: null,
  };
}

/** RF-A: the three Create lines. */
export function rfaPanels(): { caption: string; view: RetargetingView; line: PanelLine }[] {
  const announce = planRetargeting(input({ runDay: "2026-10-01", today: "2026-10-01" })).view;
  const finalWeek = planRetargeting(input({ runDay: "2026-12-05", today: "2026-12-05" })).view;
  const roof = planRetargeting(
    input({
      eventId: "xmpl-roof",
      eventCode: "XMPL-ROOF",
      runDay: "2026-10-01",
      today: "2026-10-01",
      prospecting: [
        { id: "120000000000000201", kind: "adset", name: BROAD, dailyMinor: 500, adSets: 1 },
        { id: "120000000000000202", kind: "adset", name: "Lookalike 1 %", dailyMinor: 300, adSets: 1 },
        { id: "120000000000000203", kind: "adset", name: "Interests", dailyMinor: 200, adSets: 1 },
        { id: "120000000000000204", kind: "campaign", name: "XMPL-ROOF · Brand", dailyMinor: 3000, adSets: 30 },
      ],
    }),
  ).view;
  // The captions are the record's frame captions.
  return [
    { caption: "Announce: as it would have read on Thu 1 Oct", view: announce, line: lineFor(announce, "rf-a-1") },
    { caption: "Final week: created on or after Sat 5 Dec", view: finalWeek, line: lineFor(finalWeek, "rf-a-2") },
    { caption: "A show prospecting can’t fully cover (take what’s there)", view: roof, line: lineFor(roof, "rf-a-3") },
  ];
}

const BUILT_B = {
  state: "live",
  mode: "live" as const,
  campaignId: "120000000000000300",
  tiers: { similar: 0, cold: 480, warm: 1080, hot: 840 },
  took: [{ id: "120000000000000101", kind: "adset" as const, name: BROAD, beforeMinor: 3600, afterMinor: 1200 }],
};

/** RF-B: a tier at its frequency ceiling, on Sat 28 Nov. */
export function rfbView(): RetargetingView {
  return planRetargeting(
    input({
      runDay: "2026-11-28",
      today: "2026-11-28",
      prospecting: [{ ...PROSPECTING[0]!, dailyMinor: 1200 }, PROSPECTING[1]!, PROSPECTING[2]!],
      funnelBuilt: BUILT_B,
      funnelWeek: { cold: { frequency: 3.2, spendMinor: 2450 }, warm: { frequency: 2.1, spendMinor: 7000 }, hot: { frequency: 3.6, spendMinor: 3640 } },
    }),
  ).view;
}

/** RF-C: a show missing advertiser access, made on Thu 26 Nov (no figures yet). */
export function rfcView(): RetargetingView {
  return planRetargeting(
    input({
      runDay: "2026-11-26",
      today: "2026-11-26",
      accounts: [...ACCOUNTS, ...MISSING],
      prospecting: [{ ...PROSPECTING[0]!, dailyMinor: 1500 }, PROSPECTING[1]!, PROSPECTING[2]!],
      funnelBuilt: { state: "paused", mode: "paused", campaignId: "120000000000000300", tiers: { similar: 0, cold: 630, warm: 945, hot: 525 }, took: [{ id: "120000000000000101", kind: "adset", name: BROAD, beforeMinor: 3600, afterMinor: 1500 }] },
    }),
  ).view;
}

/** RF-E: what Claude is told, in three blocks. */
export function rfeBlocks(): { call: string; lines: string[] }[] {
  const planInput = input({ runDay: "2026-11-26", today: "2026-11-26", accounts: [...ACCOUNTS, ...MISSING], madeAudiences: ["rf:visitors:60", "rf:ticket:30", "rf:checkout:30", "rf:registrations:180"] });
  const plan = planRetargeting(planInput);
  const lines = claudePlanLines(plan.funnel!, funnelSourcesOf(planInput.sources, planInput.accounts));
  return [
    { call: "plan_retargeting(NX26-RUDIMENTAL)", lines },
    { call: 'plan_retargeting("live")', lines: [planHead({ shows: 14, build: 11, skipped: 3 }), "…", skipLine("XMPL-ATTIC", "no_link"), skipLine("XMPL-DOCKS", "soon"), skipLine("XMPL-ROOF", "built")] },
    { call: "create_retargeting, paused", lines: [doneLine({ code: "NX26-RUDIMENTAL", live: false, made: 6, takenMinor: plan.funnel!.take.takenMinor })] },
  ];
}
