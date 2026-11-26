/**
 * The two-campaign frames (docs/design-record/2026-11-26-retargeting-two-campaigns.html,
 * TW-A to TW-D) and the funnel's RF-B and RF-C (RF5 and RF6 stand), built by
 * the rules (planRetargeting, the panel's rows, Wider's row, Today's
 * scheduled row and Claude's lines), not typed: a frame can only show what
 * the panel, Today or Claude would say for these inputs.
 *
 * NX26-RUDIMENTAL's code, venue (Newcastle) and show date (Sat 12 Dec) are
 * real, and NX's brand Pages are as Matas named them; its money, genre
 * group, ids, support acts and every figure are the record's invented ones.
 * XMPL shows are invented. No fan or staff data.
 *
 * Rudimental's daily spend is £60.00 (Broad £36.00, Interests £14.00,
 * Lookalike £10.00), folded into Wider. On Thu 26 Nov it's in the final
 * month (35 %): Retargeting £21.00 a day, Wider £39.00 a day × 17 days.
 *
 * TW-A: the Create line for Rudimental, and XMPL-CELLAR's presale Create
 *       (£40.00 a day, on sale Fri 4 Dec) with its tiers and footer.
 * TW-B: Similar with a 7-page drum & bass group (2 audiences), without one
 *       (its share to Cold), and XMPL-ATTIC with no genre.
 * TW-C: Rudimental's Wider row on Sat 28 Nov before and after the step, the
 *       step on Today (MB1), and XMPL-QUAY, where the £1.00 floor stops it.
 * TW-D: what Claude is told: Rudimental's line with its matched Pages, and
 *       XMPL-ATTIC with no venue match and no genre.
 * RF-B: Rudimental running on Sat 28 Nov (final 2 weeks, £24.00), Hot and
 *       Cold over frequency 3; RF-C: two accounts missing advertiser access.
 */

import type { PanelLine } from "@/lib/onsale-refresh/read";

import { ONSALE_PHASE } from "../../lib/onsale-refresh/phase-config.ts";
import type { PurchaseRead } from "../../lib/onsale-refresh/purchases.ts";
import { planRetargeting, type RetargetingInput, type RetargetingPlan, type RetargetingView } from "../../lib/retargeting/plan.ts";
import { audiencesToMake, type FunnelAccount, type PageGroup, type ProspectingBudget, type TierMinor } from "../../lib/retargeting/funnel.ts";
import { claudePlanLines, type MatchedPages } from "../../lib/retargeting/funnel-plan.ts";
import { funnelSourcesOf, genreWords, widerRow, type FunnelPanel, type RunningWider } from "../../lib/retargeting/funnel-view.ts";
import { scheduledRow, type LogContext, type MetaLogRow } from "../../lib/mcp/today/log.ts";
import type { ScheduledRow } from "../../lib/mcp/live/scheduled.ts";

export const FUNNEL_FRAME_IDS = ["TW-A", "TW-B", "TW-C", "TW-D", "RF-B", "RF-C"] as const;

const SHOW = "2026-12-12";
const ANNOUNCED = "2026-09-29";
const TODAY = "2026-11-26";

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

const PROSPECTING: ProspectingBudget[] = [
  { id: "120000000000000101", kind: "adset", name: "Broad · Advantage+", dailyMinor: 3600, adSets: 1 },
  { id: "120000000000000102", kind: "adset", name: "Interests · drum & bass", dailyMinor: 1400, adSets: 1 },
  { id: "120000000000000103", kind: "adset", name: "Lookalike 1 %", dailyMinor: 1000, adSets: 1 },
];

/** Both platforms of one Page, with or without advertiser access. */
const both = (pageId: string, name: string, kind: FunnelAccount["kind"], access: { fb?: boolean; ig?: boolean } = {}): FunnelAccount[] => [
  { pageId, name, platform: "facebook", kind, access: access.fb ?? true },
  { pageId, igId: `ig-${pageId}`, name, platform: "instagram", kind, access: access.ig ?? true },
];

/** TC9: the venue's Page, NX's two brand Pages and the lineup (MC Fenn's Instagram and Dawn Ray's Page without access). */
const RUDIMENTAL_ACCOUNTS: FunnelAccount[] = [
  ...both("p-venue", "NX Newcastle", "venue"),
  ...both("p-loves", "NX LOVES", "promoter"),
  ...both("p-session", "NX In Session", "promoter"),
  ...both("p-rudimental", "Rudimental", "lineup"),
  ...both("p-fenn", "MC Fenn", "lineup", { ig: false }),
  { pageId: "p-dawn", name: "Dawn Ray", platform: "facebook", kind: "lineup", access: false },
];
const RUDIMENTAL_PAGES: MatchedPages = { venue: "NX Newcastle", brands: ["NX LOVES", "NX In Session"], artists: ["Rudimental", "MC Fenn", "Dawn Ray"] };

/** The show's drum & bass page group: Pages the client's business can build from (invented ids), confirmed. */
const group = (n: number): PageGroup => ({ id: `pg-dnb-${n}`, genreFamily: "dnb", pageIds: Array.from({ length: n }, (_, i) => `1000000000000${i + 1}`), igIds: [], confirmed: true });

function input(overrides: Partial<RetargetingInput>): RetargetingInput {
  return {
    eventId: "nx26-rudimental",
    eventCode: "NX26-RUDIMENTAL",
    runDay: TODAY,
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
        { contextId: "p-loves", videoIds: ["v1"] },
        { contextId: "p-rudimental", videoIds: ["v2"] },
      ],
      pages: [],
      lists: [
        { metaAudienceId: "238000000000001", name: "NX26-RUDIMENTAL · Similar A", role: "similar", uploadedAt: "2026-11-01" },
        { metaAudienceId: "238000000000003", name: "NX26-RUDIMENTAL · Buyers", role: "buyers", uploadedAt: "2026-11-20" },
      ],
    },
    accounts: RUDIMENTAL_ACCOUNTS,
    existing: null,
    legacy: [],
    budgetGbp: null,
    spendToDateGbp: 0,
    committedGbp: null,
    main: null,
    ads: [{ adId: "1", name: "NX26-RUDIMENTAL · announce" }],
    geoFromAdsetId: "120000000000000101",
    where: { draftId: "00000000-0000-4000-8000-000000000001", adAccountId: "act_1", campaignIds: ["120000000000000100"] },
    today: TODAY,
    linksRead: "ok",
    prospecting: PROSPECTING,
    madeAudiences: [],
    twoCampaigns: true,
    genreFamily: "dnb",
    pageGroup: group(7),
    matchedPages: RUDIMENTAL_PAGES,
    ...overrides,
  };
}

/** XMPL-CELLAR: announced Mon 23 Nov, on sale Fri 4 Dec (presale now), on Sat 13 Feb, £40.00 a day, a 4-page drum & bass group. */
function cellar(): RetargetingInput {
  return input({
    eventId: "xmpl-cellar",
    eventCode: "XMPL-CELLAR",
    eventDate: "2027-02-13",
    onSaleDay: "2026-12-04",
    announceDay: "2026-11-23",
    prospecting: [
      { id: "120000000000000401", kind: "adset", name: "Broad", dailyMinor: 2500, adSets: 1 },
      { id: "120000000000000402", kind: "adset", name: "Interests", dailyMinor: 1500, adSets: 1 },
    ],
    sources: {
      pixelId: "1067726194205285",
      links: [{ kind: "landing", rule: "crqln.com/l/xmpl-cellar", host: "crqln.com", name: "crqln.com/l/xmpl-cellar", platform: null }],
      videos: [{ contextId: "x-presents", videoIds: ["v9"] }],
      pages: [],
      lists: [{ metaAudienceId: "238000000000101", name: "XMPL-CELLAR · Similar", role: "similar", uploadedAt: "2026-11-24" }],
    },
    accounts: [
      ...both("x-venue", "XMPL Cellar", "venue"),
      ...both("x-presents", "XMPL Presents", "promoter"),
      ...both("x-nights", "XMPL Nights", "promoter"),
      ...both("x-a1", "XMPL Artist", "lineup"),
      ...both("x-a2", "XMPL Second", "lineup"),
      { pageId: "x-a3", name: "XMPL Third", platform: "facebook", kind: "lineup", access: true },
    ],
    pageGroup: group(4),
    matchedPages: null,
  });
}

/** A Create line, To review, as the daily read writes it. */
function lineFor(view: RetargetingView, id: string): PanelLine {
  return {
    id,
    kind: "retargeting_campaign",
    title: view.title,
    detail: view.funnel?.create?.lines[0] ?? "",
    writeText: view.create?.writeText ?? "",
    narrow: { detail: view.funnel?.create?.lines[1] ?? "", writeText: null },
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

export type CaptionedPanel = { caption: string; view: RetargetingView; line: PanelLine | null };

/** TW-A: Rudimental's Create line, and XMPL-CELLAR's presale Create with its tiers. */
export function twaPanels(): CaptionedPanel[] {
  const rudimental = planRetargeting(input({})).view;
  const presale = planRetargeting(cellar()).view;
  // The captions are the record's frame captions.
  return [
    { caption: "On sale: Rudimental, final month", view: rudimental, line: lineFor(rudimental, "tw-a-1") },
    { caption: "Presale: a show not on sale yet", view: presale, line: lineFor(presale, "tw-a-2") },
  ];
}

/** Only these tiers of a panel (TW-B draws Similar and Cold). */
function only(view: RetargetingView, tiers: readonly string[]): RetargetingView {
  if (!view.funnel) return view;
  const funnel: FunnelPanel = { ...view.funnel, create: null, notes: [], next: null, access: null, wider: null, tiers: view.funnel.tiers.filter((row) => tiers.includes(row.tier)) };
  return { ...view, create: null, signal: null, funnel };
}

/** TW-B: Similar with a 7-page group, without one, and a show with no genre. */
export function twbPanels(): CaptionedPanel[] {
  const withGroup = planRetargeting(input({})).view;
  const without = planRetargeting(input({ pageGroup: null })).view;
  const noGenre = planRetargeting(input({ eventId: "xmpl-attic", eventCode: "XMPL-ATTIC", genreFamily: null, pageGroup: null, matchedPages: null })).view;
  return [
    { caption: "With a drum & bass page group", view: only(withGroup, ["similar", "cold"]), line: null },
    { caption: "Without one: Similar’s share goes to Cold", view: only(without, ["similar", "cold"]), line: null },
    { caption: "A show with no genre", view: only(noGenre, ["similar"]), line: null },
  ];
}

/** Rudimental as Create made it on Thu 26 Nov: Wider's lifetime and its steps. */
function madeOn26(): RetargetingPlan {
  return planRetargeting(input({}));
}

const TIERS_FINAL_MONTH: TierMinor = { similar: 315, cold: 525, warm: 735, hot: 525 };

function running(day: string, remainingMinor: number, doneDays: string[]): RetargetingView {
  const made = madeOn26().wider!;
  const wider: RunningWider = { lifetimeMinor: made.lifetimeMinor, dailyMinor: made.dailyMinor, daysLeft: made.daysLeft, endDay: made.endDay, steps: made.steps, remainingMinor, adSets: made.adSets.length, doneDays, showDailyMinor: 6000 };
  return planRetargeting(input({ runDay: day, today: day, funnelBuilt: { state: "live", mode: "live", campaignId: "120000000000000300", tiers: TIERS_FINAL_MONTH, took: [], wider } })).view;
}

export type WiderFrame = { caption: string; wider: NonNullable<FunnelPanel["wider"]>; next: string | null };

/** TW-C: Wider's row before and after the step, the step on Today, and the floor. */
export function twcFrames(): { widers: WiderFrame[]; today: MetaLogRow; floor: WiderFrame } {
  // Sat 28 Nov, 00:00, before the scheduled change runs: £585.00 left (£39.00 × 15 days).
  const before = running("2026-11-28", 58500, []);
  // After it: £45.00 lower.
  const after = running("2026-11-28", 54000, ["2026-11-28"]);
  const widers: WiderFrame[] = [
    { caption: "Wider, just before the step", wider: before.funnel!.wider!, next: before.funnel!.next },
    { caption: "After it (Sat 28 Nov)", wider: after.funnel!.wider!, next: after.funnel!.next },
  ];
  // The step as funnel-apply's stepChanges stores it: Wider's lifetime_budget, as Meta holds it.
  const step = madeOn26().wider!.steps[0]!;
  const ctx: LogContext = { codes: new Map([["nx26-rudimental", "NX26-RUDIMENTAL"]]), clientNames: new Map(), draftNames: new Map(), viewerName: "Matas", since: "2026-11-28T00:00:00Z" };
  const row: ScheduledRow = {
    id: "s-wider-1",
    user_id: "u-matas",
    event_id: "nx26-rudimental",
    client_id: null,
    kind: "set_budget",
    object_kind: "campaign",
    object_id: "120253311904770755",
    object_name: "NX26-RUDIMENTAL · Wider",
    field: "lifetime_budget",
    amount_minor: step.afterMinor,
    expected_minor: step.beforeMinor,
    currency: "GBP",
    raises_spend: false,
    run_at: "2026-11-28T00:00:00Z",
    ledger_draft_id: "00000000-0000-4000-8000-000000000001",
    call_key: "rf:nx26-rudimental:2026-11-28:wider",
    approval_asked: "Create NX26-RUDIMENTAL · Wider and NX26-RUDIMENTAL · Retargeting, live, with the stretch steps as scheduled changes?",
    approval_answer: "yes",
    status: "applied",
    outcome: { before: step.beforeMinor, after: step.afterMinor },
    applied_at: "2026-11-28T00:00:00Z",
    cancelled_at: null,
    created_at: "2026-11-26T16:10:00Z",
  };
  const today = scheduledRow(row, ctx)!;
  // XMPL-QUAY on Fri 27 Nov: £44.00 of £300.00 left to Mon 30 Nov, four Wider ad sets; a step wants £9.00 a day today.
  const quay: RunningWider = { lifetimeMinor: 30000, dailyMinor: 1100, daysLeft: 4, endDay: "2026-11-30", remainingMinor: 4400, adSets: 4, doneDays: [], steps: [{ day: "2026-11-27", beforeMinor: 30000, afterMinor: 30000, wantDailyMinor: 900, givenDailyMinor: 900, atFloor: false }] };
  const floored = widerRow(quay, { today: "2026-11-27", stretchOf: () => "final_week" });
  return { widers, today, floor: { caption: "When the floor stops a full step", wider: { row: floored.row, line: floored.line }, next: null } };
}

/** TW-D: what Claude is told — Rudimental with its matched Pages, and XMPL-ATTIC (no venue match, no genre). */
export function twdBlocks(): { caption: string | null; call: string; lines: string[] }[] {
  // Six of the show's audiences already made (the pixel ones, from an earlier build's read).
  const madeKeys = audiencesToMake(madeOn26().funnel!.specs).map((aud) => aud.key).slice(0, 6);
  const ru = input({ madeAudiences: madeKeys });
  const ruPlan = planRetargeting(ru);
  const attic = input({
    eventId: "xmpl-attic",
    eventCode: "XMPL-ATTIC",
    // Read on Mon 14 Dec ("normally": not a payday week), on sale Mon 28 Dec.
    runDay: "2026-12-14",
    today: "2026-12-14",
    eventDate: "2027-03-20",
    onSaleDay: "2026-12-28",
    announceDay: "2026-10-20",
    genreFamily: null,
    pageGroup: null,
    prospecting: [
      { id: "120000000000000501", kind: "adset", name: "Broad", dailyMinor: 2500, adSets: 1 },
      { id: "120000000000000502", kind: "adset", name: "Interests", dailyMinor: 1500, adSets: 1 },
    ],
    accounts: [...both("a-presents", "XMPL Presents", "promoter"), ...both("a-artist", "XMPL Artist", "lineup")],
    matchedPages: { venue: null, brands: ["XMPL Presents"], artists: ["XMPL Artist"] },
    sources: {
      pixelId: "1067726194205285",
      links: [{ kind: "landing", rule: "crqln.com/l/xmpl-attic", host: "crqln.com", name: "crqln.com/l/xmpl-attic", platform: null }],
      videos: [{ contextId: "a-presents", videoIds: ["v7"] }],
      pages: [],
      lists: [],
    },
  });
  const atticPlan = planRetargeting(attic);
  // plan_retargeting's lines, as lib/mcp/tools/retargeting.ts linesFor builds them.
  const lines = (i: RetargetingInput, plan: RetargetingPlan, presale: boolean) =>
    claudePlanLines(plan.funnel!, funnelSourcesOf(i.sources, i.accounts), { wider: plan.wider!, pages: i.matchedPages ?? null, genre: genreWords(i.genreFamily ?? null), presale, presaleSignups: null, existing: [] });
  return [
    { caption: null, call: "plan_retargeting(NX26-RUDIMENTAL)", lines: lines(ru, ruPlan, false) },
    { caption: "A show with no venue match and no genre", call: "plan_retargeting(XMPL-ATTIC)", lines: lines(attic, atticPlan, true) },
  ];
}

/** RF-B: a tier at its frequency ceiling, on Sat 28 Nov (final 2 weeks, £24.00). */
export function rfbView(): RetargetingView {
  const made = madeOn26().wider!;
  return planRetargeting(
    input({
      runDay: "2026-11-28",
      today: "2026-11-28",
      funnelBuilt: {
        state: "live",
        mode: "live",
        campaignId: "120000000000000300",
        tiers: { similar: 240, cold: 360, warm: 960, hot: 840 },
        took: [],
        wider: { lifetimeMinor: made.lifetimeMinor, dailyMinor: made.dailyMinor, daysLeft: made.daysLeft, endDay: made.endDay, steps: made.steps, remainingMinor: 54000, adSets: made.adSets.length, doneDays: ["2026-11-28"], showDailyMinor: 6000 },
      },
      funnelWeek: { cold: { frequency: 3.2, spendMinor: 1750 }, warm: { frequency: 2.1, spendMinor: 7000 }, hot: { frequency: 3.6, spendMinor: 3640 } },
    }),
  ).view;
}

/** RF-C: missing advertiser access, made on Thu 26 Nov (no figures yet). */
export function rfcView(): RetargetingView {
  const made = madeOn26().wider!;
  return planRetargeting(
    input({
      funnelBuilt: { state: "paused", mode: "paused", campaignId: "120000000000000300", tiers: TIERS_FINAL_MONTH, took: [], wider: { lifetimeMinor: made.lifetimeMinor, dailyMinor: made.dailyMinor, daysLeft: made.daysLeft, endDay: made.endDay, steps: made.steps, remainingMinor: made.lifetimeMinor, adSets: made.adSets.length, doneDays: [], showDailyMinor: 6000 } },
    }),
  ).view;
}
