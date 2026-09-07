/**
 * `▷ resume` — the one status write this app makes.
 *
 * Fan-out creates every entity PAUSED (that is the point of `⏸ Launch`),
 * so resuming is a separate, explicit second gate. It is a NEW write and
 * therefore sits behind the same `ENABLE_PLAN_FANOUT` killswitch as the
 * launch it undoes: one flag for "this app may change things on Meta".
 *
 * Meta's `effective_status` does not roll down. Resume must walk the
 * tree — campaign, then its ad sets, then its ads — or the row reads
 * `running` and nothing serves.
 *
 * Meta only. TikTok and Google have no status-write path in this app, and
 * inventing one from a canvas button is not something to do blind — the
 * rows show `▷` disabled with the Ads Manager link instead.
 */

import type { PlanAdapterName } from "./types.ts";

export const PLAN_RESUME_SUPPORTED: readonly PlanAdapterName[] = ["meta"];

export const PLAN_RESUME_UNSUPPORTED_REASON =
  "Resume in Ads Manager — this app writes campaign status on Meta only.";

export const PLAN_RESUME_NOT_LAUNCHED_REASON =
  "Nothing to resume — this channel has no campaign on the platform.";

export function canResumeAdapter(adapter: PlanAdapterName): boolean {
  return PLAN_RESUME_SUPPORTED.includes(adapter);
}

export interface ResumeTreeNode {
  id: string;
  status: string;
}

/**
 * Injected Graph so the walk is testable without a network. `activate`
 * is the only write — GET status/list, POST `{status:"ACTIVE"}`.
 */
export interface ResumeTreeGraph {
  getCampaign: (campaignId: string) => Promise<ResumeTreeNode>;
  listAdSets: (campaignId: string) => Promise<ResumeTreeNode[]>;
  listAds: (adSetId: string) => Promise<ResumeTreeNode[]>;
  activate: (id: string) => Promise<void>;
}

export type PlanResumeOutcome =
  | { ok: true; campaignId: string; word: string }
  | { ok: false; error: string; skippedReason?: "killswitch" | "unsupported" };

export interface ResumeTreeCounts {
  campaignActivated: boolean;
  campaignAlreadyActive: boolean;
  campaignFailed: boolean;
  adSetsActivated: number;
  adSetsAlreadyActive: number;
  adSetsFailed: number;
  adSetsTotal: number;
  adsActivated: number;
  adsAlreadyActive: number;
  adsFailed: number;
  adsTotal: number;
}

function isConfiguredActive(status: string): boolean {
  return status.trim().toUpperCase() === "ACTIVE";
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Operator words for what Resume changed. Full tree: `resumed 1 campaign
 * · 5 ad sets · 5 ads`. Partial: `resumed the campaign · 2 of 5 ad sets
 * — the rest are in Ads Manager ↗`.
 */
export function formatResumeTreeSentence(counts: ResumeTreeCounts): string {
  const adSetsOk = counts.adSetsActivated + counts.adSetsAlreadyActive;
  const adsOk = counts.adsActivated + counts.adsAlreadyActive;
  const childFailed = counts.adSetsFailed > 0 || counts.adsFailed > 0 || counts.campaignFailed;

  if (childFailed && !counts.campaignFailed) {
    if (counts.adSetsFailed > 0 || counts.adSetsTotal === 0) {
      return `resumed the campaign · ${adSetsOk} of ${counts.adSetsTotal} ${plural(counts.adSetsTotal, "ad set", "ad sets")} — the rest are in Ads Manager ↗`;
    }
    return `resumed the campaign · ${adsOk} of ${counts.adsTotal} ${plural(counts.adsTotal, "ad", "ads")} — the rest are in Ads Manager ↗`;
  }
  if (counts.campaignFailed) {
    return `resumed the campaign · ${adSetsOk} of ${counts.adSetsTotal} ${plural(counts.adSetsTotal, "ad set", "ad sets")} — the rest are in Ads Manager ↗`;
  }

  return `resumed 1 campaign · ${counts.adSetsTotal} ${plural(counts.adSetsTotal, "ad set", "ad sets")} · ${counts.adsTotal} ${plural(counts.adsTotal, "ad", "ads")}`;
}

async function activateIfNeeded(
  graph: ResumeTreeGraph,
  node: ResumeTreeNode,
): Promise<"activated" | "skipped" | "failed"> {
  if (isConfiguredActive(node.status)) return "skipped";
  try {
    await graph.activate(node.id);
    return "activated";
  } catch {
    return "failed";
  }
}

/**
 * Pure resume decision + tree walk, with the Graph injected so the
 * decision is testable without a network.
 */
export async function resumePlanAdapter(input: {
  adapter: PlanAdapterName;
  campaignId: string | null;
  gateEnabled: boolean;
  graph?: ResumeTreeGraph;
}): Promise<PlanResumeOutcome> {
  if (!input.gateEnabled) {
    return { ok: false, error: "killswitch", skippedReason: "killswitch" };
  }
  if (!canResumeAdapter(input.adapter)) {
    return {
      ok: false,
      error: PLAN_RESUME_UNSUPPORTED_REASON,
      skippedReason: "unsupported",
    };
  }
  if (!input.campaignId) {
    return { ok: false, error: PLAN_RESUME_NOT_LAUNCHED_REASON };
  }
  if (!input.graph) {
    return { ok: false, error: "Resume graph is required" };
  }

  const counts: ResumeTreeCounts = {
    campaignActivated: false,
    campaignAlreadyActive: false,
    campaignFailed: false,
    adSetsActivated: 0,
    adSetsAlreadyActive: 0,
    adSetsFailed: 0,
    adSetsTotal: 0,
    adsActivated: 0,
    adsAlreadyActive: 0,
    adsFailed: 0,
    adsTotal: 0,
  };

  let campaign: ResumeTreeNode;
  try {
    campaign = await input.graph.getCampaign(input.campaignId);
  } catch {
    campaign = { id: input.campaignId, status: "" };
  }

  const campaignResult = await activateIfNeeded(input.graph, campaign);
  if (campaignResult === "failed") {
    return { ok: false, error: "Resume failed" };
  }
  counts.campaignActivated = campaignResult === "activated";
  counts.campaignAlreadyActive = campaignResult === "skipped";

  let adSets: ResumeTreeNode[];
  try {
    adSets = await input.graph.listAdSets(input.campaignId);
  } catch {
    counts.adSetsTotal = 1;
    counts.adSetsFailed = 1;
    return {
      ok: true,
      campaignId: input.campaignId,
      word: formatResumeTreeSentence(counts),
    };
  }

  counts.adSetsTotal = adSets.length;
  for (const adSet of adSets) {
    const result = await activateIfNeeded(input.graph, adSet);
    if (result === "activated") counts.adSetsActivated += 1;
    else if (result === "skipped") counts.adSetsAlreadyActive += 1;
    else counts.adSetsFailed += 1;

    let ads: ResumeTreeNode[];
    try {
      ads = await input.graph.listAds(adSet.id);
    } catch {
      counts.adsTotal += 1;
      counts.adsFailed += 1;
      continue;
    }
    counts.adsTotal += ads.length;
    for (const ad of ads) {
      const adResult = await activateIfNeeded(input.graph, ad);
      if (adResult === "activated") counts.adsActivated += 1;
      else if (adResult === "skipped") counts.adsAlreadyActive += 1;
      else counts.adsFailed += 1;
    }
  }

  return {
    ok: true,
    campaignId: input.campaignId,
    word: formatResumeTreeSentence(counts),
  };
}
