import { EMPTY_IDENTITY_NAMES, type IdentityNameMap } from "../../lib/plan/identity-chips.ts";
import type { PlanLibraryItem } from "../../lib/plan/library.ts";
import type { PlanEventOption } from "../../lib/plan/event-picker.ts";
import type { PlanPreflightIssue } from "../../lib/plan/preflight.ts";
import type { BenchmarkRow } from "../../lib/plan/benchmarks.ts";
import { IDLE_PLAN_LAUNCH, type CampaignPlan, type CampaignPlanLaunches } from "../../lib/plan/types.ts";
import type { RoutingMatrixRow } from "../../lib/plan/asset-routing.ts";
import { GOOGLE_NO_ASSETS_COPY } from "../../lib/plan/asset-routing.ts";
import type { ResolvedChannelDefaults } from "../../lib/clients/channel-defaults.ts";
import type { AdjustDecisionRow } from "../../lib/plan/adjust-face.ts";
import type { CampaignPlanPrediction } from "../../lib/plan/learn-face.ts";
import type { LaunchRollupDay } from "../../lib/plan/launch-face.ts";

export const WALK_NOW = "2026-09-06T12:00:00+01:00";
export const AUG_4 = "2026-08-04T12:00:00+01:00";
export const AUG_11 = "2026-08-11T12:00:00+01:00";
export const SEP_1 = "2026-09-01T12:00:00+01:00";
export const JUL_24 = "2026-07-24T12:00:00+01:00";
export const MAR_18 = "2026-03-18T12:00:00+00:00";
export const APR_20 = "2026-04-20T12:00:00+01:00";
export const DEC_4 = "2026-12-04T12:00:00+00:00";

export const CLIENT_EB = "client-electric-brixton";
export const CLIENT_J2 = "client-junction-2";
export const CLIENT_IRW = "client-ironworks";

export const NX_ACCOUNT = "606252931141334";
export const SHEFFIELD_ACCOUNT = "1073273492854557";

export function emptyNames(meta: Record<string, string> = {}): IdentityNameMap {
  return { ...EMPTY_IDENTITY_NAMES, metaAdAccount: meta };
}

export function idleLaunches(): CampaignPlanLaunches {
  return {
    meta: { ...IDLE_PLAN_LAUNCH },
    tiktok: { ...IDLE_PLAN_LAUNCH },
    google: { ...IDLE_PLAN_LAUNCH },
  };
}

export function draftedLaunches(): CampaignPlanLaunches {
  return {
    meta: { ...IDLE_PLAN_LAUNCH, draftId: "meta-draft" },
    tiktok: { ...IDLE_PLAN_LAUNCH, draftId: "tiktok-draft" },
    google: { ...IDLE_PLAN_LAUNCH, draftId: "google-draft" },
  };
}

export function liveLaunches(at = "2026-08-27T09:00:00.000Z"): CampaignPlanLaunches {
  return {
    meta: {
      ...IDLE_PLAN_LAUNCH,
      status: "live",
      draftId: "meta-draft",
      platformCampaignId: "meta_camp",
      launchedAt: at,
      launchedAtSource: "ledger",
      platformAdAccountId: SHEFFIELD_ACCOUNT,
    },
    tiktok: { ...IDLE_PLAN_LAUNCH, status: "skipped" },
    google: { ...IDLE_PLAN_LAUNCH, status: "skipped" },
  };
}

export function pausedLaunches(at = "2026-07-24T09:00:00.000Z"): CampaignPlanLaunches {
  const live = liveLaunches(at);
  return {
    meta: { ...live.meta, status: "live" },
    tiktok: { ...live.tiktok, status: "live", draftId: "tt-draft", platformCampaignId: "tt_camp" },
    google: { ...IDLE_PLAN_LAUNCH, status: "skipped" },
  };
}

export function planOf(partial: {
  id: string;
  name?: string;
  status?: CampaignPlan["status"];
  eventId: string;
  unit?: CampaignPlan["intent"]["target"]["unit"];
  value?: number;
  budget?: Partial<CampaignPlan["intent"]["budget"]>;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  launches?: CampaignPlanLaunches;
  createdAt?: string;
}): CampaignPlan {
  const now = partial.createdAt ?? "2026-08-01T09:00:00.000Z";
  return {
    id: partial.id,
    userId: "user-frames",
    name: partial.name ?? "",
    status: partial.status ?? "draft",
    intent: {
      eventId: partial.eventId,
      objectiveIntent: partial.unit === "view" ? "awareness" : "registration",
      target: { value: partial.value ?? 1.6, unit: partial.unit ?? "reg" },
      budget: {
        totalDaily: partial.budget?.totalDaily ?? 40,
        metaDaily: partial.budget?.metaDaily ?? 28,
        tiktokDaily: partial.budget?.tiktokDaily ?? 8,
        googleDaily: partial.budget?.googleDaily ?? 4,
      },
      destinationUrl: "",
      audienceClusterRef: null,
      creativeSetRef: null,
      startDate: partial.startDate ?? "2026-08-20",
      endDate: partial.endDate ?? "2026-09-06",
      startTime: partial.startTime ?? "12:00",
      endTime: partial.endTime ?? "23:00",
    },
    launches: partial.launches ?? draftedLaunches(),
    createdAt: now,
    updatedAt: now,
  };
}

export function eventOf(partial: PlanEventOption): PlanEventOption {
  return {
    clientId: CLIENT_EB,
    clientName: "Electric Brixton",
    venueName: "NX Newcastle",
    venueKey: "nx newcastle",
    kind: "event",
    metaAdAccountId: SHEFFIELD_ACCOUNT,
    eventMetaAdAccountId: NX_ACCOUNT,
    ticketUrl: "https://dod-newcastle.com/tickets",
    signupUrl: "https://dod-newcastle.com",
    ...partial,
  };
}

export function listItem(
  plan: CampaignPlan,
  event: PlanEventOption,
  extra: Partial<PlanLibraryItem> = {},
): PlanLibraryItem {
  return {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    eventId: event.id,
    eventName: event.name,
    eventCode: event.eventCode ?? null,
    venueName: event.venueName ?? null,
    eventDate: event.eventDate ?? null,
    presaleAt: event.presaleAt ?? null,
    generalSaleAt: event.generalSaleAt ?? null,
    thumbUrl: null,
    objectiveIntent: plan.intent.objectiveIntent,
    totalDaily: plan.intent.budget.totalDaily,
    startDate: plan.intent.startDate,
    endDate: plan.intent.endDate,
    startTime: plan.intent.startTime,
    endTime: plan.intent.endTime,
    createdAt: plan.createdAt,
    spent: extra.spent ?? null,
    drawerFix: extra.drawerFix ?? null,
    launches: plan.launches,
    updatedAt: plan.updatedAt,
    ...extra,
  };
}

export function nxSignupRows(): BenchmarkRow[] {
  return [
    row(CLIENT_EB, "nx newcastle", "mf", "NX26-MF", "2026-10-16", "signup", 2.75),
    row(CLIENT_EB, "nx newcastle", "eed", "NX26-EED", "2026-11-13", "signup", 1.32),
    row(CLIENT_EB, "nx newcastle", "folamour", "NX26-FOLAMOUR", "2026-10-23", "signup", 0.87),
    row(CLIENT_EB, "nx newcastle", "djez", "NX26-DJEZ", "2026-10-02", "signup", 1.67),
    row(CLIENT_EB, "nx newcastle", "ipc", "NX26-IPC", "2026-11-21", "signup", 0.54),
  ];
}

export function nxPurchaseRows(): BenchmarkRow[] {
  return [
    row(CLIENT_EB, "nx newcastle", "djez", "NX26-DJEZ", "2026-10-02", "purchase", 22.11),
    row(CLIENT_EB, "nx newcastle", "mf", "NX26-MF", "2026-10-16", "purchase", 25.47),
    row(CLIENT_EB, "nx newcastle", "folamour", "NX26-FOLAMOUR", "2026-10-23", "purchase", 41.65),
    row(CLIENT_EB, "nx newcastle", "eed", "NX26-EED", "2026-11-13", "purchase", 76),
  ];
}

export function j2TicketRows(unit: BenchmarkRow["unit"] = "ticket"): BenchmarkRow[] {
  return [
    row(CLIENT_J2, "boston manor park", "fabric", "UTB0042-New", "2026-04-20", unit, 0.63, "all"),
    row(CLIENT_J2, "boston manor park", "melodic", "UTB0043-New", "2026-04-20", unit, 6.46, "all"),
    row(CLIENT_J2, "boston manor park", "fragrance", "UTB0044-New", "2026-04-20", unit, 2.38, "all"),
    row(CLIENT_J2, "boston manor park", "innervisions", "UTB0045-New", "2026-04-20", unit, 3.31, "all"),
  ];
}

function row(
  client_id: string,
  venue_key: string,
  event_id: string,
  event_code: string,
  event_date: string,
  unit: string,
  cost: number,
  channel = unit === "ticket" ? "all" : "meta",
): BenchmarkRow {
  return { client_id, venue_key, event_id, event_code, event_date, unit, channel, cost };
}

export function issues(count: number, adapter: PlanPreflightIssue["adapter"] = "tiktok"): PlanPreflightIssue[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${adapter}-${i + 1}`,
    adapter,
    field: adapter === "tiktok" ? "video" : "audiences",
    message: `Fix ${i + 1}`,
    blocking: true,
    href: `/${adapter}`,
  }));
}

export function posterAsset(filename = "dod-lineup.jpg"): RoutingMatrixRow {
  return {
    asset: {
      id: "asset-1",
      userId: "user-frames",
      contentHash: "abc",
      byteSize: 12000,
      filename,
      mediaKind: "image",
      aspectRatio: "4:5",
      durationSeconds: null,
      storageBucket: "creative-assets",
      storagePath: filename,
      thumbnailUrl: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    },
    caption: "",
    creativeName: filename,
    meta: { present: true, platformId: "img_1" },
    tiktok: {
      enabled: false,
      disabled: true,
      disabledReason: "TikTok image ads not supported by the launcher yet",
      uploadStatus: "idle",
      uploadError: null,
      derivedCreativeId: null,
    },
    google: { copy: GOOGLE_NO_ASSETS_COPY },
  };
}

export function resolvedMetaOnly(): ResolvedChannelDefaults {
  return {
    clientId: CLIENT_EB,
    clientName: "Electric Brixton",
    metaAdAccount: { value: `act_${SHEFFIELD_ACCOUNT}`, provenance: "client-default" },
    metaPixel: { value: null, provenance: "unset" },
    facebookPage: { value: null, provenance: "unset" },
    instagramActor: { value: null, provenance: "unset" },
    tiktokAccount: { value: null, provenance: "unset" },
    tiktokAdvertiser: { value: null, provenance: "unset" },
    tiktokIdentity: { value: null, provenance: "unset" },
    googleAdsAccount: { value: null, provenance: "unset" },
    googleAdsCustomer: { value: null, provenance: "unset" },
  };
}

export function resolvedAll(): ResolvedChannelDefaults {
  return {
    ...resolvedMetaOnly(),
    tiktokAdvertiser: { value: "tt_adv", provenance: "client-default" },
    googleAdsCustomer: { value: "3244108450", provenance: "client-default" },
  };
}

export function raiseDecision(): AdjustDecisionRow {
  return {
    decidedAt: "2026-09-06T08:00:00.000Z",
    action: "scale_up",
    reasonText: "under your usual",
    resultCount: 38,
    applied: true,
    dryRun: false,
    adsetName: "Tech House Pages",
    budgetBeforePence: 10000,
    budgetAfterPence: 11500,
    metricValue: 1.1,
    metricWindow: "7d",
  };
}

export function refusalDecision(): AdjustDecisionRow {
  return {
    decidedAt: "2026-09-06T08:00:00.000Z",
    action: "insufficient_conversions",
    reasonText: "3 of 5 signups needed",
    resultCount: 3,
    applied: false,
    dryRun: true,
    adsetName: "Disco Pages",
    budgetBeforePence: 8000,
    budgetAfterPence: 8000,
  };
}

export function leftAloneDecisions(count: number): AdjustDecisionRow[] {
  return Array.from({ length: count }, () => ({
    decidedAt: "2026-09-06T08:00:00.000Z",
    action: "maintain",
    reasonText: "in band",
    resultCount: 12,
    applied: false,
    dryRun: true,
    adsetName: "left",
  }));
}

export function predictionRow(): CampaignPlanPrediction {
  return {
    planId: "plan-dod",
    metric: "cost_per_unit",
    unit: "reg",
    value: 2.03,
    n: 5,
    runsUsed: ["NX26-DJEZ", "NX26-MF", "NX26-FOLAMOUR", "NX26-EED", "NX26-IPC"],
    actual: 0.51,
  };
}

export function signupDays(): LaunchRollupDay[] {
  return [
    { date: "2026-08-27", ad_spend: 56, meta_regs: 110, meta_purchases: 0, meta_reach: 8000, tiktok_spend: 0, tiktok_results: 0, google_ads_spend: 0, google_ads_conversions: 0 },
    { date: "2026-09-03", ad_spend: 56, meta_regs: 108, meta_purchases: 0, meta_reach: 7500, tiktok_spend: 0, tiktok_results: 0, google_ads_spend: 0, google_ads_conversions: 0 },
    { date: "2026-09-04", ad_spend: 56, meta_regs: 20, meta_purchases: 8, meta_reach: 4000, tiktok_spend: 0, tiktok_results: 0, google_ads_spend: 0, google_ads_conversions: 0 },
    { date: "2026-09-06", ad_spend: 56, meta_regs: 10, meta_purchases: 8, meta_reach: 2000, tiktok_spend: 0, tiktok_results: 0, google_ads_spend: 0, google_ads_conversions: 0 },
  ];
}

export const EVENTS = {
  schak: eventOf({
    id: "evt-schak",
    name: "Schak",
    eventCode: "NX26-SCHAK",
    eventDate: "2026-12-18",
    presaleAt: null,
    generalSaleAt: null,
  }),
  eed: eventOf({
    id: "evt-eed",
    name: "East End Dubs",
    eventCode: "NX26-EED",
    eventDate: "2026-11-13",
    presaleAt: "2026-08-14T09:00:00.000Z",
    generalSaleAt: "2026-08-14T11:00:00.000Z",
  }),
  mf: eventOf({
    id: "evt-mf",
    name: "Modern Funktion",
    eventCode: "NX26-MF",
    eventDate: "2026-10-16",
    presaleAt: "2026-08-05T10:30:00.000Z",
    generalSaleAt: "2026-08-06T11:00:00.000Z",
  }),
  folamour: eventOf({
    id: "evt-folamour",
    name: "Folamour",
    eventCode: "NX26-FOLAMOUR",
    eventDate: "2026-10-23",
    presaleAt: null,
    generalSaleAt: "2026-09-03T13:00:00.000Z",
  }),
  dod: eventOf({
    id: "evt-dod",
    name: "D.O.D",
    eventCode: "NX26-DOD",
    eventDate: "2026-12-04",
    announcementAt: "2026-06-27T10:00:00.000Z",
    presaleAt: "2026-08-14T13:00:00.000Z",
    generalSaleAt: "2026-09-04T13:00:00.000Z",
  }),
  jamie: eventOf({
    id: "evt-jamie",
    name: "Jamie Jones",
    clientId: CLIENT_IRW,
    clientName: "IRONWORKS",
    venueName: "Ironworks",
    venueKey: "ironworks",
    eventCode: "IRW0001",
    eventDate: "2026-10-03",
    ticketUrl: "https://ironworks.example/tickets",
    signupUrl: "https://ironworks.example",
    eventMetaAdAccountId: null,
  }),
  hardTechno: eventOf({
    id: "evt-ht",
    name: "Junction 2: Hard Techno",
    clientId: CLIENT_J2,
    clientName: "Junction 2",
    venueName: "Boston Manor Park",
    venueKey: "boston manor park",
    eventCode: "UTB0046-New",
    eventDate: "2026-08-02",
    presaleAt: null,
    generalSaleAt: null,
    ticketUrl: "https://junction2.example/tickets",
    signupUrl: null,
  }),
  melodic: eventOf({
    id: "evt-melodic",
    name: "Junction 2: Melodic",
    clientId: CLIENT_J2,
    clientName: "Junction 2",
    venueName: "Boston Manor Park",
    venueKey: "boston manor park",
    eventCode: "UTB0043-New",
    eventDate: "2026-07-26",
    ticketUrl: "https://junction2.example/tickets",
    signupUrl: null,
  }),
  brand: eventOf({
    id: "evt-brand",
    name: "Brand Awareness (Always-On)",
    clientId: CLIENT_IRW,
    clientName: "IRONWORKS",
    venueName: "Ironworks",
    venueKey: "ironworks",
    eventCode: "IRWOHD",
    eventDate: null,
    kind: "brand_campaign",
    presaleAt: null,
    generalSaleAt: null,
    ticketUrl: null,
    signupUrl: "https://ironworks.example",
  }),
} as const;
