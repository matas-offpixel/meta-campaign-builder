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
  /** When set, fan-out launches these drafts instead of a fresh adapter output. */
  linkedDrafts?: {
    meta?: CampaignDraft | null;
    tiktok?: TikTokCampaignDraft | null;
    google?: GoogleSearchPlanTree | null;
  };
  persistLaunch?: (
    adapter: PlanAdapterName,
    record: CampaignPlanLaunchRecord,
  ) => Promise<void>;
  logOutgoing?: (adapter: PlanAdapterName, payload: unknown) => void;
  env?: NodeJS.ProcessEnv;
}

export interface OrchestratePlanLaunchResult {
  skippedReason: "killswitch" | null;
  plan: CampaignPlan;
}

const ADAPTER_ORDER: PlanAdapterName[] = ["meta", "tiktok", "google"];

function platformAccountFromDraft(
  adapter: PlanAdapterName,
  payload: CampaignDraft | TikTokCampaignDraft | GoogleSearchPlanTree,
): string | null {
  if (adapter === "meta") {
    const draft = payload as CampaignDraft;
    const id = draft.settings?.adAccountId || draft.settings?.metaAdAccountId || null;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  if (adapter === "tiktok") {
    const draft = payload as TikTokCampaignDraft;
    const id = draft.accountSetup?.advertiserId || null;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  const tree = payload as GoogleSearchPlanTree;
  const id = tree.plan?.google_ads_account_id ?? null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function applyOutcome(
  previous: CampaignPlanLaunchRecord,
  outcome: PlanAdapterOutcome,
  platformAdAccountId?: string | null,
): CampaignPlanLaunchRecord {
  const account = platformAdAccountId ?? previous.platformAdAccountId ?? null;
  if (outcome.ok) {
    return {
      status: "live",
      platformCampaignId: outcome.campaignId ?? previous.platformCampaignId,
      draftId: outcome.draftId ?? previous.draftId,
      error: null,
      platformAdAccountId: account,
    };
  }
  return {
    status: "failed",
    platformCampaignId: previous.platformCampaignId,
    draftId: outcome.draftId ?? previous.draftId,
    error: outcome.error ?? "adapter launch failed",
    platformAdAccountId: account,
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
    meta: input.linkedDrafts?.meta ?? planToMetaDraft(input.plan),
    tiktok: input.linkedDrafts?.tiktok ?? planToTikTokDraft(input.plan),
    google: input.linkedDrafts?.google ?? planToGoogleDraft(input.plan),
  };

  for (const adapter of ADAPTER_ORDER) {
    if (!budgeted.has(adapter)) {
      if (launches[adapter].status === "idle") {
        launches[adapter] = {
          ...launches[adapter],
          status: "skipped",
          error: `${adapter} daily budget is 0`,
        };
        await input.persistLaunch?.(adapter, launches[adapter]);
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
    const account = platformAccountFromDraft(adapter, payload);

    try {
      const outcome = await input.launchers[adapter](payload as never);
      launches[adapter] = applyOutcome(launches[adapter], outcome, account);
    } catch (err) {
      launches[adapter] = applyOutcome(
        launches[adapter],
        {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
        account,
      );
    }
    await input.persistLaunch?.(adapter, launches[adapter]);
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
