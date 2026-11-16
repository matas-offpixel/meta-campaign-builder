/**
 * lib/dashboard/objective-budget/types.ts
 *
 * What HE6 (design record 2026-11-13-dashboard-v2-phase-2, E6) reads,
 * already fetched, and what it returns. The pure calc (`objectives.ts`,
 * `budget.ts`) takes `ObjectiveBudgetInput` and nothing else.
 *
 * Every day is an ISO calendar day. Every money figure is pounds.
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import type { MessageRate, StoredStatsRow } from "../../d2c/stats-ingest/summary.ts";
import type { Platform, RollupDay } from "../sales-calc/types.ts";

/** E6's four objectives. */
export type Objective = "registration" | "purchase" | "traffic" | "awareness_engagement";
export const OBJECTIVES: readonly Objective[] = ["registration", "purchase", "traffic", "awareness_engagement"];
export const OBJECTIVE_LABEL: Record<Objective, string> = {
  registration: "Registration",
  purchase: "Purchase",
  traffic: "Traffic",
  awareness_engagement: "Awareness & engagement",
};
/** A row whose spend has no stored objective (no ad-level row, or a platform that doesn't store one). */
export const NOT_STORED_LABEL = "Objective not stored";

export type Channel = Platform;
export const CHANNELS: readonly Channel[] = ["meta", "tiktok", "google"];

/** Each objective's own metric (E6): registrations, purchases, landing page views, reach. */
export type ResultMetric = "registrations" | "purchases" | "landing_page_views" | "clicks" | "reach";

/** How the cost per result is labelled, per result (design fix (d) on #1256). */
export const COST_LABEL: Record<ResultMetric, string> = {
  registrations: "£ / signup",
  purchases: "£ / purchase",
  landing_page_views: "£ / landing page view",
  clicks: "£ / click",
  reach: "£ / person reached",
};

/** What a Meta ad set's objective was read from. */
export type MetaObjectiveBasis = "optimization_goal" | "campaign_objective";

/** A figure and where it came from. A null value is "no figure", never £0. */
export interface Figure {
  value: number | null;
  source: string;
}

/** A show or a brand campaign (events.kind = 'brand_campaign', which may have no date). */
export interface ScopeEvent {
  eventId: string;
  code: string;
  name: string;
  /** Show day; null for an undated brand campaign. */
  showDate: string | null;
  kind: "event" | "brand_campaign";
  /** events.meta_campaign_id, split. */
  linkedCampaignIds: string[];
  /** events.budget_marketing; null when not set. */
  budgetMarketing: number | null;
}

/** One ad on one day (ad_daily_insights). */
export interface MetaAdDay {
  campaignId: string;
  campaignName: string;
  adSetId: string | null;
  day: string;
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  landingPageViews: number;
  registrations: number;
  leads: number;
  purchases: number;
  campaignObjective: string | null;
  optimizationGoal: string | null;
  promotedEvent: string | null;
}

/** One Google campaign on one day (google_ads_daily_snapshots). */
export interface GoogleObjectiveDay {
  eventCode: string;
  campaignId: string | null;
  channelType: string | null;
  day: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValue: number;
}

/** additional_spend_entries (044, 053). */
export interface AdditionalSpendRow {
  eventId: string;
  scope: "event" | "venue";
  day: string;
  amount: number;
}

export type BudgetEntryKind = "season_budget" | "credit" | "sub_budget" | "sms_cost";

/** marketing_budget_entries (migration 250). */
export interface BudgetEntry {
  id: string;
  eventId: string | null;
  kind: BudgetEntryKind;
  label: string;
  amount: number;
  spent: number | null;
  day: string | null;
}

export interface ObjectiveBudgetInput {
  client: { id: string; name: string };
  /** Every dated show and brand campaign of the client, cancelled ones left out. */
  events: ScopeEvent[];
  metaAdDays: MetaAdDay[];
  googleDays: GoogleObjectiveDay[];
  rollups: RollupDay[];
  /** campaign_event_overrides (migration 240), campaign id → event id. */
  overrides: { meta: Record<string, string>; google: Record<string, string> };
  additionalSpend: AdditionalSpendRow[];
  /** Null when migration 250 isn't applied yet. */
  entries: BudgetEntry[] | null;
  d2c: { rows: StoredStatsRow[]; rate: MessageRate };
}

export interface Period {
  /** Inclusive; null = since launch. */
  from: string | null;
  /** Inclusive. */
  to: string;
}

export interface ObjectiveRow {
  objective: Objective | null;
  label: string;
  channel: Channel;
  spend: Figure;
  /** Of the scope's paid spend (D12) over the period. */
  shareOfSpend: Figure;
  impressions: Figure;
  reach: Figure;
  clicks: Figure;
  landingPageViews: Figure;
  resultMetric: ResultMetric | null;
  result: Figure;
  costPerResult: Figure;
  /** "£ / signup", "£ / purchase", …; null on a row with no result metric. */
  costLabel: string | null;
  /** Purchase rows only; null value ("—") until purchase value is stored. */
  roas: Figure | null;
}

/** Meta ad-days by what their objective was read from, over the scope and period. */
export interface MetaClassification {
  /** optimization_goal stored: the objective is the goal's. */
  byGoal: { adDays: number; spend: number };
  /** optimization_goal NULL: read from the campaign objective (the shared mapping), per objective. */
  goalMissing: { adDays: number; spend: number; byObjective: Record<Objective | "none", number> };
  /** A goal stored but none of the four (a custom or unknown conversion event, an unknown goal). */
  unmapped: { adDays: number; spend: number; what: string[] };
}

export interface SubBudgetLine {
  label: string;
  allocation: number;
  spent: number | null;
}

export interface BudgetPicture {
  plan: Figure;
  /** The parts of the plan when it's not a season budget. */
  planParts: { budgetMarketing: Figure; additionalSpend: Figure; seasonBudget: Figure };
  paid: Figure;
  paidByChannel: Record<Channel, Figure>;
  credits: Figure;
  subBudgets: Figure;
  subBudgetLines: SubBudgetLine[];
  d2c: Figure;
  d2cParts: { whatsapp: Figure; sms: Figure };
  /** plan − paid + credits. */
  variance: Figure;
  /** paid + sub-budgets + D2C (E6, PH5). A credit isn't subtracted; it enters only the variance. */
  totalMarketing: Figure;
  /** D12 paid on brand campaigns in the scope, and on shows. They add up to `paid`. */
  paidBrand: Figure;
  paidShows: Figure;
  /** What the total leaves out, in words ("WhatsApp"). */
  totalExcludes: string[];
}

export interface ObjectiveBudgetResult {
  scope: { kind: "show" | "client"; eventIds: string[]; label: string };
  period: Period;
  rows: ObjectiveRow[];
  /** D12 paid spend over the period, per channel and in all. */
  paidInPeriod: Record<Channel | "all", number>;
  /** Brand campaigns (events.kind = 'brand_campaign') in the scope: their own line in the client total. */
  brand: { eventIds: string[]; paidInPeriod: Record<Channel | "all", number> };
  /** What each Meta ad-day's objective was read from. */
  metaClassification: MetaClassification;
  budget: BudgetPicture;
}
