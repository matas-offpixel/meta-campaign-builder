import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import type { GoogleSearchPlanTree } from "../google-search/types.ts";
import { planToGoogleDraft } from "./adapters/google.ts";
import { planToMetaDraft } from "./adapters/meta.ts";
import { planToTikTokDraft } from "./adapters/tiktok.ts";
import { planFanoutGateState } from "./gate.ts";
import {
  budgetedLaunchAdapters,
  deriveCampaignPlanStatus,
  type CampaignPlan,
  type CampaignPlanLaunchRecord,
  type CampaignPlanLaunches,
  type PlanAdapterName,
} from "./types.ts";

export interface PlanAdapterOutcome {
  ok: boolean;
  campaignId?: string | null;
  draftId?: string | null;
  error?: string | null;
}

export interface PlanLaunchers {
  meta: (draft: CampaignDraft) => Promise<PlanAdapterOutcome>;
  tiktok: (draft: TikTokCampaignDraft) => Promise<PlanAdapterOutcome>;
  google: (tree: GoogleSearchPlanTree) => Promise<PlanAdapterOutcome>;
}

export interface OrchestratePlanLaunchInput {
  plan: CampaignPlan;
  launchers: PlanLaunchers;
  logOutgoing?: (adapter: PlanAdapterName, payload: unknown) => void;
  env?: NodeJS.ProcessEnv;
}

export interface OrchestratePlanLaunchResult {
  skippedReason: "killswitch" | null;
  plan: CampaignPlan;
}

const ADAPTER_ORDER: PlanAdapterName[] = ["meta", "tiktok", "google"];

function applyOutcome(
  previous: CampaignPlanLaunchRecord,
  outcome: PlanAdapterOutcome,
): CampaignPlanLaunchRecord {
  if (outcome.ok) {
    return {
      status: "live",
      platformCampaignId: outcome.campaignId ?? previous.platformCampaignId,
      draftId: outcome.draftId ?? previous.draftId,
      error: null,
    };
  }
  return {
    status: "failed",
    platformCampaignId: previous.platformCampaignId,
    draftId: outcome.draftId ?? previous.draftId,
    error: outcome.error ?? "adapter launch failed",
  };
}

/**
 * Sequential fan-out through injected existing launch handlers.
 * A sibling failure does not roll back a sibling success.
 * Already-live adapters are skipped (ledger / plan sub-record).
 */
export async function orchestratePlanLaunch(
  input: OrchestratePlanLaunchInput,
): Promise<OrchestratePlanLaunchResult> {
  const gate = planFanoutGateState(input.env ?? process.env);
  if (!gate.enabled) {
    return { skippedReason: "killswitch", plan: input.plan };
  }

  const budgeted = new Set(budgetedLaunchAdapters(input.plan.intent.budget));
  const launches: CampaignPlanLaunches = { ...input.plan.launches };
  const drafts = {
    meta: planToMetaDraft(input.plan),
    tiktok: planToTikTokDraft(input.plan),
    google: planToGoogleDraft(input.plan),
  };

  for (const adapter of ADAPTER_ORDER) {
    if (!budgeted.has(adapter)) {
      if (launches[adapter].status === "idle") {
        launches[adapter] = {
          ...launches[adapter],
          status: "skipped",
          error: `${adapter} daily budget is 0`,
        };
      }
      continue;
    }
    if (launches[adapter].status === "live") {
      continue;
    }

    launches[adapter] = {
      ...launches[adapter],
      status: "launching",
      error: null,
    };

    const payload = drafts[adapter];
    input.logOutgoing?.(adapter, payload);

    try {
      const outcome = await input.launchers[adapter](payload as never);
      launches[adapter] = applyOutcome(launches[adapter], outcome);
    } catch (err) {
      launches[adapter] = applyOutcome(launches[adapter], {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const status = deriveCampaignPlanStatus(launches);
  return {
    skippedReason: null,
    plan: {
      ...input.plan,
      status,
      launches,
      updatedAt: new Date().toISOString(),
    },
  };
}
