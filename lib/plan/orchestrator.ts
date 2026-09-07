import type { ResolvedChannelDefaults } from "../clients/channel-defaults.ts";
import type { CampaignDraft } from "../types.ts";
import type { TikTokCampaignDraft } from "../types/tiktok-draft.ts";
import type { GoogleSearchPlanTree } from "../google-search/types.ts";
import { googleCustomerIdForLedger } from "./ads-manager-links.ts";
import { planFanoutGateState } from "./gate.ts";
import {
  buildPlanLaunchDrafts,
  type PlanLaunchLinkedDrafts,
} from "./launch-drafts.ts";
import {
  budgetedLaunchAdapters,
  deriveCampaignPlanStatus,
  type CampaignPlan,
  type CampaignPlanLaunchRecord,
  type CampaignPlanLaunches,
  type PlanAdapterName,
} from "./types.ts";

/** Matches `export const maxDuration = 800` on the launch route. */
export const PLAN_LAUNCH_MAX_DURATION_MS = 800_000;

export type AdapterSkipReason = "already live" | "already launching";
export type AdapterRetryReason = "stale launching";

export interface PlanAdapterOutcome {
  ok: boolean;
  campaignId?: string | null;
  draftId?: string | null;
  error?: string | null;
  advisory?: string | null;
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
  linkedDrafts?: PlanLaunchLinkedDrafts;
  /** Same resolved stack preflight used — required for an identical draft. */
  resolved?: ResolvedChannelDefaults | null;
  persistLaunch?: (
    adapter: PlanAdapterName,
    record: CampaignPlanLaunchRecord,
  ) => Promise<void>;
  logOutgoing?: (adapter: PlanAdapterName, payload: unknown) => void;
  env?: NodeJS.ProcessEnv;
  /** Joined `google_ads_accounts.google_customer_id`. Never the uuid FK. */
  googleCustomerId?: string | null;
  now?: Date;
  maxDurationMs?: number;
}

export interface OrchestratePlanLaunchResult {
  skippedReason: "killswitch" | null;
  plan: CampaignPlan;
  skips: Partial<Record<PlanAdapterName, AdapterSkipReason>>;
  retried: Partial<Record<PlanAdapterName, AdapterRetryReason>>;
  advisories: string[];
}

const ADAPTER_ORDER: PlanAdapterName[] = ["meta", "tiktok", "google"];

export function adapterLaunchDecision(
  record: CampaignPlanLaunchRecord,
  now: Date,
  maxDurationMs: number,
):
  | { action: "skip"; reason: AdapterSkipReason }
  | { action: "launch"; reason?: AdapterRetryReason } {
  if (record.status === "live") {
    return { action: "skip", reason: "already live" };
  }
  if (record.status !== "launching") {
    return { action: "launch" };
  }
  const stamped = record.updatedAt ?? record.createdAt ?? null;
  if (!stamped) {
    return { action: "skip", reason: "already launching" };
  }
  const ageMs = now.getTime() - Date.parse(stamped);
  if (!Number.isFinite(ageMs) || ageMs <= maxDurationMs) {
    return { action: "skip", reason: "already launching" };
  }
  return { action: "launch", reason: "stale launching" };
}

function platformAccountFromDraft(
  adapter: PlanAdapterName,
  payload: CampaignDraft | TikTokCampaignDraft | GoogleSearchPlanTree,
  googleCustomerId?: string | null,
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
  return (
    googleCustomerIdForLedger(googleCustomerId) ??
    googleCustomerIdForLedger((payload as GoogleSearchPlanTree).plan?.google_ads_account_id)
  );
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
      createdAt: previous.createdAt,
      updatedAt: previous.updatedAt,
    };
  }
  return {
    status: "failed",
    platformCampaignId: outcome.campaignId ?? previous.platformCampaignId,
    draftId: outcome.draftId ?? previous.draftId,
    error: outcome.error ?? "adapter launch failed",
    platformAdAccountId: account,
    createdAt: previous.createdAt,
    updatedAt: previous.updatedAt,
  };
}

/**
 * Sequential fan-out through injected existing launch handlers.
 * A sibling failure does not roll back a sibling success.
 * Already-live / in-flight adapters are skipped from the ledger record
 * the caller passed — never from a stale browser body.
 */
export async function orchestratePlanLaunch(
  input: OrchestratePlanLaunchInput,
): Promise<OrchestratePlanLaunchResult> {
  const gate = planFanoutGateState(input.env ?? process.env);
  if (!gate.enabled) {
    return {
      skippedReason: "killswitch",
      plan: input.plan,
      skips: {},
      retried: {},
      advisories: [],
    };
  }

  const now = input.now ?? new Date();
  const maxDurationMs = input.maxDurationMs ?? PLAN_LAUNCH_MAX_DURATION_MS;
  const budgeted = new Set(budgetedLaunchAdapters(input.plan.intent.budget));
  const launches: CampaignPlanLaunches = { ...input.plan.launches };
  const drafts = buildPlanLaunchDrafts(input.plan, input.linkedDrafts, input.resolved);
  const skips: OrchestratePlanLaunchResult["skips"] = {};
  const retried: OrchestratePlanLaunchResult["retried"] = {};
  const advisories: string[] = [];

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

    const decision = adapterLaunchDecision(launches[adapter], now, maxDurationMs);
    if (decision.action === "skip") {
      skips[adapter] = decision.reason;
      continue;
    }
    if (decision.reason === "stale launching") {
      retried[adapter] = "stale launching";
    }

    launches[adapter] = {
      ...launches[adapter],
      status: "launching",
      error: null,
    };
    await input.persistLaunch?.(adapter, launches[adapter]);

    const payload = drafts[adapter];
    input.logOutgoing?.(adapter, payload);
    const account = platformAccountFromDraft(adapter, payload, input.googleCustomerId);

    try {
      const outcome = await input.launchers[adapter](payload as never);
      launches[adapter] = applyOutcome(launches[adapter], outcome, account);
      if (outcome.advisory) advisories.push(outcome.advisory);
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
    skips,
    retried,
    advisories,
    plan: {
      ...input.plan,
      status,
      launches,
      updatedAt: new Date().toISOString(),
    },
  };
}
