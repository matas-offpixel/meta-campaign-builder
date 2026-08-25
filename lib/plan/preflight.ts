import { validateGoogleSearchPlan } from "../google-search/validation.ts";
import { validateCampaignPayload } from "../meta/campaign.ts";
import { validateCreativePayload } from "../meta/creative.ts";
import { collectTikTokLaunchPreflight } from "../tiktok/write/preflight.ts";
import { planToGoogleDraft } from "./adapters/google.ts";
import { planToMetaDraft } from "./adapters/meta.ts";
import { planToTikTokDraft } from "./adapters/tiktok.ts";
import {
  budgetedLaunchAdapters,
  type CampaignPlan,
} from "./types.ts";

export type PlanAdapterName = "meta" | "tiktok" | "google";

export interface PlanPreflightIssue {
  adapter: PlanAdapterName;
  id: string;
  field: string;
  message: string;
  blocking: boolean;
}

export interface PlanPreflightResult {
  ok: boolean;
  issues: PlanPreflightIssue[];
  drafts: {
    meta: ReturnType<typeof planToMetaDraft>;
    tiktok: ReturnType<typeof planToTikTokDraft>;
    google: ReturnType<typeof planToGoogleDraft>;
  };
}

/**
 * Plan-level preflight: adapt once, then reuse each platform's existing
 * validator so the operator sees every blocker in one list before launch.
 */
export function collectPlanPreflight(plan: CampaignPlan): PlanPreflightResult {
  const drafts = {
    meta: planToMetaDraft(plan),
    tiktok: planToTikTokDraft(plan),
    google: planToGoogleDraft(plan),
  };
  const budgeted = new Set(budgetedLaunchAdapters(plan.intent.budget));
  const issues: PlanPreflightIssue[] = [];

  for (const adapter of ["meta", "tiktok", "google"] as const) {
    if (!budgeted.has(adapter)) {
      issues.push({
        adapter,
        id: `${adapter}:skipped_zero_budget`,
        field: "budget",
        message: `skipped — ${adapter} daily budget is 0`,
        blocking: false,
      });
    }
  }

  const metaCampaign = validateCampaignPayload({
    metaAdAccountId: drafts.meta.settings.metaAdAccountId || drafts.meta.settings.adAccountId,
    name: drafts.meta.settings.campaignName,
    objective: drafts.meta.settings.objective,
  });
  for (const [field, message] of Object.entries(metaCampaign.errors)) {
    issues.push({
      adapter: "meta",
      id: `meta:${field}`,
      field,
      message,
      blocking: true,
    });
  }
  for (const creative of drafts.meta.creatives) {
    const result = validateCreativePayload(creative);
    for (const [index, message] of result.errors.entries()) {
      issues.push({
        adapter: "meta",
        id: `meta:creative:${creative.id}:${index}`,
        field: "creative",
        message,
        blocking: true,
      });
    }
  }

  const tiktok = collectTikTokLaunchPreflight(drafts.tiktok);
  for (const issue of tiktok.issues) {
    issues.push({
      adapter: "tiktok",
      id: `tiktok:${issue.id}`,
      field: issue.field,
      message: issue.message,
      blocking: true,
    });
  }
  for (const warning of tiktok.warnings) {
    issues.push({
      adapter: "tiktok",
      id: `tiktok:warn:${warning.id}`,
      field: warning.field,
      message: warning.message,
      blocking: false,
    });
  }

  for (const issue of validateGoogleSearchPlan(drafts.google)) {
    issues.push({
      adapter: "google",
      id: `google:${issue.code}`,
      field: issue.code,
      message: issue.scope ? `${issue.scope}: ${issue.message}` : issue.message,
      blocking: issue.severity === "error",
    });
  }

  const blocking = issues.filter((issue) => issue.blocking);
  const launchable = [...budgeted];
  const ok =
    launchable.length > 0 &&
    launchable.every(
      (adapter) => !blocking.some((issue) => issue.adapter === adapter),
    );

  return { ok, issues, drafts };
}
