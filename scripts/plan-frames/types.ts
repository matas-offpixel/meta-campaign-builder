import type { PlanLibraryItem } from "../../lib/plan/library.ts";
import type { PlanEventOption } from "../../lib/plan/event-picker.ts";
import type { PlanListChromeTab } from "../../lib/plan/list.ts";
import type { CampaignPlan } from "../../lib/plan/types.ts";
import type { PlanPreflightIssue } from "../../lib/plan/preflight.ts";
import type { BenchmarkRow } from "../../lib/plan/benchmarks.ts";
import type { IdentityNameMap } from "../../lib/plan/identity-chips.ts";
import type { ResolvedChannelDefaults } from "../../lib/clients/channel-defaults.ts";
import type { RoutingMatrixRow } from "../../lib/plan/asset-routing.ts";
import type { AdjustDecisionRow, AdjustWindowReads } from "../../lib/plan/adjust-face.ts";
import type { CampaignPlanPrediction } from "../../lib/plan/learn-face.ts";
import type { LaunchRollupDay } from "../../lib/plan/launch-face.ts";
import type { ExtraFrameId, FrameId } from "./ids.ts";

export type ListFrameFixture = {
  kind: "list";
  id: FrameId;
  title: string;
  now: string;
  tab?: PlanListChromeTab | null;
  plans: PlanLibraryItem[];
  events: PlanEventOption[];
};

export type LaunchFrameFixture = {
  kind: "launch";
  id: FrameId;
  title: string;
  now: string;
  plan: CampaignPlan;
  event: PlanEventOption;
  issues?: PlanPreflightIssue[];
  facts?: { meta: { n: number; noun: string }[]; tiktok: { n: number; noun: string }[]; google: { n: number; noun: string }[] };
  benchmarkRows?: BenchmarkRow[];
  identityNames?: IdentityNameMap;
  resolved?: ResolvedChannelDefaults | null;
  assets?: RoutingMatrixRow[];
  rollupDays?: LaunchRollupDay[];
  liveSpend?: number | null;
};

export type AdjustFrameFixture = {
  kind: "adjust";
  id: FrameId;
  title: string;
  now: string;
  plan: CampaignPlan;
  event: PlanEventOption;
  role?: "operator" | "client";
  spent: number;
  planned: number;
  metaSignups?: number | null;
  metaPurchases?: number | null;
  tickets?: number | null;
  ticketSource?: "none" | "manual" | "xlsx_import" | "eventbrite" | "fourthefans" | "unknown";
  endSet?: boolean;
  trend?: number[] | null;
  decisions?: AdjustDecisionRow[];
  benchmarkRows?: BenchmarkRow[];
  identityNames?: IdentityNameMap;
  resolved?: ResolvedChannelDefaults | null;
  assets?: RoutingMatrixRow[];
  adjustReads?: AdjustWindowReads | null;
  lastCreativeSnapshotAt?: string | null;
  tagDomain?: string | null;
  readsPending?: boolean;
};

export type LearnFrameFixture = {
  kind: "learn";
  id: FrameId;
  title: string;
  now: string;
  plan: CampaignPlan;
  event: PlanEventOption;
  role?: "operator" | "client";
  prediction?: CampaignPlanPrediction | null;
  actual?: number | null;
  nextTime?: number | null;
  nextN?: number;
  nextBand?: [number, number] | null;
  locked?: { days?: number; n?: number; of?: number } | null;
  paceDaily: number;
  pacePlanSaid?: number | null;
  paceSpent?: number | null;
  extrapolatedTitle?: string | null;
  identityNames?: IdentityNameMap;
};

export type LoadingFrameFixture = {
  kind: "loading";
  id: ExtraFrameId;
  title: string;
  now: string;
  plan: CampaignPlan;
  event: PlanEventOption;
};

export type FrameFixture =
  | ListFrameFixture
  | LaunchFrameFixture
  | AdjustFrameFixture
  | LearnFrameFixture
  | LoadingFrameFixture;
