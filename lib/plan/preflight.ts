import { validateGoogleSearchPlan } from "../google-search/validation.ts";
import { validateCampaignPayload } from "../meta/campaign.ts";
import { validateCreativePayload } from "../meta/creative.ts";
import { collectTikTokLaunchPreflight } from "../tiktok/write/preflight.ts";
import {
  annotateChannelDefaultCures,
  applyGoogleChannelDefaults,
  applyMetaChannelDefaults,
  applyTikTokChannelDefaults,
  resolveChannelDefaults,
  type ClientChannelDefaultsRow,
  type ChannelDefaultOverrides,
  type ResolvedChannelDefaults,
} from "../clients/channel-defaults.ts";
import { planToGoogleDraft } from "./adapters/google.ts";
import { planToMetaDraft } from "./adapters/meta.ts";
import { planToTikTokDraft } from "./adapters/tiktok.ts";
import {
  budgetedLaunchAdapters,
  type CampaignPlan,
  type PlanAdapterName,
} from "./types.ts";

export type { PlanAdapterName };

export interface PlanPreflightIssue {
  adapter: PlanAdapterName;
  id: string;
  field: string;
  message: string;
  blocking: boolean;
  /** Client settings path when a missing channel default is the cure. */
  href?: string;
}

export interface PlanPreflightResult {
  ok: boolean;
  issues: PlanPreflightIssue[];
  drafts: {
    meta: ReturnType<typeof planToMetaDraft>;
    tiktok: ReturnType<typeof planToTikTokDraft>;
    google: ReturnType<typeof planToGoogleDraft>;
  };
  /** Same M.1 stack Prepare applies — identity chips + preview share it. */
  resolved: ResolvedChannelDefaults;
}

/**
 * Plan-level preflight: adapt once, then reuse each platform's existing
 * validator so the operator sees every blocker in one list before launch.
 */
export function collectPlanPreflight(
  plan: CampaignPlan,
  linked?: {
    meta?: ReturnType<typeof planToMetaDraft> | null;
    tiktok?: ReturnType<typeof planToTikTokDraft> | null;
    google?: ReturnType<typeof planToGoogleDraft> | null;
  },
  channel?: {
    stored: ClientChannelDefaultsRow | null;
    overrides?: ChannelDefaultOverrides;
  } | null,
): PlanPreflightResult {
  const resolved = resolveChannelDefaults(channel?.stored ?? null, channel?.overrides ?? {});
  const drafts = {
    meta: linked?.meta ?? applyMetaChannelDefaults(planToMetaDraft(plan), resolved),
    tiktok: linked?.tiktok ?? applyTikTokChannelDefaults(planToTikTokDraft(plan), resolved),
    google: linked?.google ?? applyGoogleChannelDefaults(planToGoogleDraft(plan), resolved),
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

  const cured = annotateChannelDefaultCures(
    issues,
    channel?.stored
      ? { id: channel.stored.clientId, name: channel.stored.clientName }
      : null,
  );
  const blocking = cured.filter((issue) => issue.blocking);
  const launchable = [...budgeted];
  const ok =
    launchable.length > 0 &&
    launchable.every(
      (adapter) => !blocking.some((issue) => issue.adapter === adapter),
    );

  return { ok, issues: cured, drafts, resolved };
}
