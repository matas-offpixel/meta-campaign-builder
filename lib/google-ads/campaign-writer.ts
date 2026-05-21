/**
 * lib/google-ads/campaign-writer.ts
 *
 * Phase 3 — Google Search push adapter.
 *
 * Takes a `GoogleSearchPlanTree` and creates the campaigns on Google
 * Ads (all PAUSED) via `GoogleAdsClient.mutate()`. Mirrors the
 * proven sequential mutate chain from the Phase 0 spike
 * (PR #442) — budget → campaign → ad group → criteria → RSAs — with
 * the launch contract recommended in that session log:
 *
 *  - **Foundational triad (budget + campaign) per campaign is
 *    fatal-on-failure WITH cleanup.** If a campaign's budget mutate
 *    succeeds but the campaign mutate fails, the budget is removed
 *    so we don't leak orphaned campaignBudget rows on the account
 *    (the same campaign-then-budget remove ordering as the spike).
 *  - **Ad groups within a campaign are tolerated independently.**
 *    A single ad-group failure goes to `adGroupsFailed`; the
 *    campaign and its sibling ad groups stand. If ALL ad groups
 *    in a campaign fail to create, the campaign itself rolls back
 *    (budget + campaign remove) so we don't leave an empty
 *    keyword-less shell on the account.
 *  - **Keywords / negatives / RSAs use `partialFailure: true`** —
 *    one bad keyword does not kill the ad group.
 *  - **Auth/credentials failure aborts the whole plan.** We early
 *    return with `aborted: true` and don't bill the operator for
 *    cleanup mutate calls that will also fail.
 *
 * Idempotency uses the `pushed_resource_name` columns the Phase 1
 * schema already provides — no new migration. Any row that already
 * carries a `pushed_resource_name` is treated as "previously
 * created" and skipped (returned in `*Created` with `reused: true`).
 * Caveat: Phase 1's `saveGoogleSearchPlanTree` performs a
 * nuke-and-rewrite of campaigns / negatives, which drops the
 * `pushed_resource_name` columns on any subsequent wizard save. So
 * idempotency protects against double-clicks within one push session
 * and against re-push of a never-edited plan, but a save-after-push
 * cycle can still produce duplicate Google Ads campaigns until the
 * Phase 1 writer becomes diff-aware. The session log calls this out
 * for the next phase.
 *
 * Naming: campaigns get auto-prefixed `[event_code] ` so the
 * reporting layer's matcher scopes them. Plans without a linked
 * event push the campaign name as-is with a warning in the summary.
 *
 * Bidding:
 *  - `maximize_clicks` → `target_spend.cpc_bid_ceiling_micros` (the
 *    field name verified by the spike for the Maximise-Clicks
 *    strategy). Ceiling defaults to £2.00 (2,000,000 micros).
 *  - `manual_cpc` → `manualCpc: {}`. Untested by the spike — flagged
 *    in the launch summary warnings the first time it's used.
 */

import {
  GoogleAdsApiError,
  GoogleAdsClient,
  type GoogleAdsCustomerCredentials,
  type GoogleAdsMutateOperation,
  type GoogleAdsMutateResponse,
  type GoogleAdsMutateResult,
} from "./client.ts";
import { customerIdForGoogleAdsApi } from "./oauth.ts";
import {
  googleAdsCampaignDeepLink,
  type GoogleSearchLaunchSummary,
  type GoogleSearchPushFailure,
  type GoogleSearchPushResult,
} from "./campaign-writer-types.ts";
import {
  finalUrlBlockReason,
  isPushableRsa,
} from "../google-search/final-url-state.ts";
import type {
  GoogleSearchAdGroupNode,
  GoogleSearchBiddingStrategy,
  GoogleSearchCampaignNode,
  GoogleSearchGeoTargetType,
  GoogleSearchKeyword,
  GoogleSearchNegative,
  GoogleSearchPlanTree,
  GoogleSearchRsa,
} from "../google-search/types.ts";

// ─── Defaults (verified by the Phase 0 spike) ─────────────────────────

const DEFAULT_DAILY_BUDGET_POUNDS = 5;
const DEFAULT_CPC_CEILING_MICROS = 2_000_000; // £2.00 — safer default than the spike's £0.50
const DEFAULT_AD_GROUP_CPC_MICROS = 250_000; // £0.25 — matches spike
const MIN_DAILY_BUDGET_MICROS = 1_000_000; // £1.00 — Google's effective floor for GBP

// Result types live in `./campaign-writer-types.ts` (client-safe).
// Re-exported below so existing server-side imports keep working.
export type { GoogleSearchLaunchSummary, GoogleSearchPushFailure, GoogleSearchPushResult };
export { googleAdsCampaignDeepLink };

/**
 * Callback the route hands the writer to persist `pushed_resource_name`
 * back onto each row. Decoupled so tests can pass a no-op persister
 * (record-only) while the route uses the real Supabase writers.
 */
export interface GoogleSearchPushPersister {
  setBudgetResource?(campaignId: string, resourceName: string): Promise<void>;
  setCampaignResource(campaignId: string, resourceName: string): Promise<void>;
  setAdGroupResource(adGroupId: string, resourceName: string): Promise<void>;
  setKeywordResource(keywordId: string, resourceName: string): Promise<void>;
  setNegativeResource(negativeId: string, resourceName: string): Promise<void>;
  setRsaResource(rsaId: string, resourceName: string): Promise<void>;
  setPlanStatus(
    planId: string,
    status: "pushed" | "partially_pushed",
    pushedAt: string,
  ): Promise<void>;
}

export interface PushGoogleSearchPlanInput {
  tree: GoogleSearchPlanTree;
  credentials: GoogleAdsCustomerCredentials;
  /** Pulled from `events.event_code` for the campaign-name prefix. */
  eventCode: string | null;
  client?: GoogleAdsClient;
  persister?: GoogleSearchPushPersister;
}

// ─── Public entrypoint ────────────────────────────────────────────────

export async function pushGoogleSearchPlan(
  input: PushGoogleSearchPlanInput,
): Promise<GoogleSearchLaunchSummary> {
  const { tree, credentials, eventCode, persister } = input;
  const client = input.client ?? new GoogleAdsClient();
  const customerId = customerIdForGoogleAdsApi(credentials.customerId);

  const summary = createEmptySummary(tree.plan.id, customerId);

  if (!eventCode) {
    summary.warnings.push(
      "Plan is not linked to an event with an event_code — campaigns will be pushed without the [event_code] prefix that the reporting matcher relies on.",
    );
  }
  if (tree.plan.bidding_strategy === "manual_cpc") {
    summary.warnings.push(
      "Manual CPC was not exercised by the Phase 0 spike — keep an eye on the first launch and report back any v23 surprises so this warning can be removed.",
    );
  }

  for (const campaign of tree.campaigns) {
    try {
      await pushSingleCampaign({
        client,
        credentials,
        customerId,
        campaign,
        planTree: tree,
        eventCode,
        persister,
        summary,
      });
    } catch (err) {
      // Auth / unexpected failures abort the whole plan — record the
      // campaign as failed and mark `aborted` so the caller knows not
      // to claim partial success.
      if (isAuthLikeError(err)) {
        summary.aborted = true;
        summary.abortReason = `auth_failed: ${errorMessage(err)}`;
        summary.campaignsFailed.push({
          localId: campaign.id,
          name: campaign.name,
          error: errorMessage(err),
        });
        break;
      }
      // Unexpected throw — record + continue to the next campaign so
      // one anomaly doesn't lose the rest of the plan.
      summary.campaignsFailed.push({
        localId: campaign.id,
        name: campaign.name,
        error: `unexpected: ${errorMessage(err)}`,
      });
    }
  }

  // Final status decision + persister callback.
  const anyCampaignSuccess = summary.campaignsCreated.length > 0;
  const anyFailure =
    summary.campaignsFailed.length > 0 ||
    summary.adGroupsFailed.length > 0 ||
    summary.keywordsFailed.length > 0 ||
    summary.negativesFailed.length > 0 ||
    summary.rsasFailed.length > 0;

  summary.partialFailure = anyFailure;
  summary.ok = !summary.aborted && anyCampaignSuccess;
  summary.planStatusUpdate = !anyCampaignSuccess
    ? "draft"
    : anyFailure
      ? "partially_pushed"
      : "pushed";

  if (persister && summary.planStatusUpdate !== "draft") {
    try {
      await persister.setPlanStatus(
        tree.plan.id,
        summary.planStatusUpdate,
        new Date().toISOString(),
      );
    } catch (err) {
      summary.warnings.push(`Failed to persist plan status: ${errorMessage(err)}`);
    }
  }

  return summary;
}

// ─── Per-campaign sequence ────────────────────────────────────────────

interface PushSingleCampaignArgs {
  client: GoogleAdsClient;
  credentials: GoogleAdsCustomerCredentials;
  customerId: string;
  campaign: GoogleSearchCampaignNode;
  planTree: GoogleSearchPlanTree;
  eventCode: string | null;
  persister?: GoogleSearchPushPersister;
  summary: GoogleSearchLaunchSummary;
}

async function pushSingleCampaign(args: PushSingleCampaignArgs): Promise<void> {
  const { client, credentials, campaign, planTree, eventCode, persister, summary } = args;

  // ── Idempotency: already-pushed campaign ──────────────────────────
  if (campaign.pushed_resource_name) {
    summary.campaignsCreated.push({
      localId: campaign.id,
      resourceName: campaign.pushed_resource_name,
      name: prefixCampaignName(campaign.name, eventCode),
      reused: true,
    });
    // Walk into ad groups so any half-pushed children still get attempted.
    await pushAdGroupsForCampaign({
      ...args,
      campaignResourceName: campaign.pushed_resource_name,
    });
    return;
  }

  // ── Triad step 1: campaign budget ─────────────────────────────────
  const budgetOp = buildBudgetOp(campaign, args.customerId);
  let budgetResource: string;
  try {
    const res = await client.mutate(credentials, "campaignBudgets", [budgetOp]);
    budgetResource = pickResourceName(res, 0);
  } catch (err) {
    // Auth-like failures must bubble so `pushGoogleSearchPlan` can
    // mark the whole plan aborted instead of silently moving to the
    // next campaign (which will hit the same 401 anyway).
    if (isAuthLikeError(err)) throw err;
    summary.campaignsFailed.push({
      localId: campaign.id,
      name: campaign.name,
      error: `budget_create_failed: ${errorMessage(err)}`,
    });
    return;
  }
  summary.budgetsCreated.push({
    localId: campaign.id,
    resourceName: budgetResource,
    name: budgetOp.create.name as string,
  });

  // ── Triad step 2: campaign ────────────────────────────────────────
  const campaignOp = buildCampaignOp({
    campaign,
    budgetResource,
    customerId: args.customerId,
    biddingStrategy: planTree.plan.bidding_strategy,
    geoTargetType: planTree.plan.geo_target_type,
    eventCode,
  });

  let campaignResource: string;
  try {
    const res = await client.mutate(credentials, "campaigns", [campaignOp]);
    campaignResource = pickResourceName(res, 0);
  } catch (err) {
    // Even on auth abort we try to remove the budget we just created
    // so the operator doesn't end up with an orphan after a
    // credentials-rotation failure.
    await tryRemove(client, credentials, "campaignBudgets", budgetResource, summary, "budget");
    if (isAuthLikeError(err)) throw err;
    summary.campaignsFailed.push({
      localId: campaign.id,
      name: campaign.name,
      error: `campaign_create_failed: ${errorMessage(err)}`,
    });
    return;
  }
  summary.campaignsCreated.push({
    localId: campaign.id,
    resourceName: campaignResource,
    name: campaignOp.create.name as string,
  });
  if (persister) {
    try {
      await persister.setCampaignResource(campaign.id, campaignResource);
      if (persister.setBudgetResource) {
        await persister.setBudgetResource(campaign.id, budgetResource);
      }
    } catch (err) {
      summary.warnings.push(
        `Persisted budget/campaign on Google Ads but failed to write back local pushed_resource_name: ${errorMessage(err)}`,
      );
    }
  }

  // ── Triad step 3: ad groups (per-ad-group fatal, campaign survives) ─
  const adGroupSuccessCount = await pushAdGroupsForCampaign({
    ...args,
    campaignResourceName: campaignResource,
  });

  // If the campaign has ad groups planned but ZERO succeeded, the
  // campaign is unusable — roll back budget + campaign.
  if (campaign.ad_groups.length > 0 && adGroupSuccessCount === 0) {
    summary.warnings.push(
      `Campaign "${campaign.name}" had all ${campaign.ad_groups.length} ad group(s) fail to create — rolling back the campaign + budget so no empty shell is left on the account.`,
    );
    await tryRemove(client, credentials, "campaigns", campaignResource, summary, "campaign");
    await tryRemove(client, credentials, "campaignBudgets", budgetResource, summary, "budget");

    // Demote from campaignsCreated → campaignsFailed.
    summary.campaignsCreated = summary.campaignsCreated.filter(
      (c) => c.resourceName !== campaignResource,
    );
    summary.campaignsFailed.push({
      localId: campaign.id,
      name: campaign.name,
      error: "all_ad_groups_failed: rolled back campaign + budget to avoid empty shell.",
    });
  }
}

interface PushAdGroupsArgs extends PushSingleCampaignArgs {
  campaignResourceName: string;
}

async function pushAdGroupsForCampaign(args: PushAdGroupsArgs): Promise<number> {
  const { client, credentials, campaign, planTree, persister, summary, campaignResourceName } =
    args;
  let successCount = 0;

  for (const adGroup of campaign.ad_groups) {
    let adGroupResource: string;

    if (adGroup.pushed_resource_name) {
      adGroupResource = adGroup.pushed_resource_name;
      summary.adGroupsCreated.push({
        localId: adGroup.id,
        resourceName: adGroupResource,
        name: adGroup.name,
        reused: true,
      });
      successCount += 1;
    } else {
      const adGroupOp = buildAdGroupOp({
        adGroup,
        campaignResource: campaignResourceName,
        customerId: args.customerId,
      });
      try {
        const res = await client.mutate(credentials, "adGroups", [adGroupOp]);
        adGroupResource = pickResourceName(res, 0);
      } catch (err) {
        summary.adGroupsFailed.push({
          localId: adGroup.id,
          name: adGroup.name,
          error: errorMessage(err),
          scope: `${campaign.name} → ${adGroup.name}`,
        });
        continue;
      }
      summary.adGroupsCreated.push({
        localId: adGroup.id,
        resourceName: adGroupResource,
        name: adGroup.name,
      });
      successCount += 1;
      if (persister) {
        try {
          await persister.setAdGroupResource(adGroup.id, adGroupResource);
        } catch (err) {
          summary.warnings.push(
            `Ad group "${adGroup.name}" created but failed to persist resource name: ${errorMessage(err)}`,
          );
        }
      }
    }

    // ── Fan-out: keywords + negatives (one partial-failure mutate) ──
    await pushAdGroupCriteria({
      client,
      credentials,
      customerId: args.customerId,
      campaign,
      adGroup,
      adGroupResource,
      planTree,
      persister,
      summary,
    });

    // ── Fan-out: RSAs (one partial-failure mutate per ad group) ─────
    await pushAdGroupRsas({
      client,
      credentials,
      customerId: args.customerId,
      campaign,
      adGroup,
      adGroupResource,
      persister,
      summary,
    });
  }

  return successCount;
}

// ─── Criteria fan-out (keywords + negatives) ──────────────────────────

interface PushCriteriaArgs {
  client: GoogleAdsClient;
  credentials: GoogleAdsCustomerCredentials;
  customerId: string;
  campaign: GoogleSearchCampaignNode;
  adGroup: GoogleSearchAdGroupNode;
  adGroupResource: string;
  planTree: GoogleSearchPlanTree;
  persister?: GoogleSearchPushPersister;
  summary: GoogleSearchLaunchSummary;
}

async function pushAdGroupCriteria(args: PushCriteriaArgs): Promise<void> {
  const { client, credentials, campaign, adGroup, adGroupResource, planTree, persister, summary } =
    args;

  // Filter out already-pushed rows (idempotency).
  const pendingKeywords = adGroup.keywords.filter((k) => !k.pushed_resource_name);
  const negativeSources = collectNegativesForCampaign(planTree, campaign);
  const pendingNegatives = negativeSources.filter((n) => !n.pushed_resource_name);

  // Record reused ones immediately.
  for (const k of adGroup.keywords) {
    if (k.pushed_resource_name) {
      summary.keywordsCreated.push({
        localId: k.id,
        resourceName: k.pushed_resource_name,
        name: k.keyword,
        reused: true,
      });
    }
  }
  for (const n of negativeSources) {
    if (n.pushed_resource_name && !summary.negativesCreated.some((x) => x.localId === n.id)) {
      summary.negativesCreated.push({
        localId: n.id,
        resourceName: n.pushed_resource_name,
        name: n.keyword,
        reused: true,
      });
    }
  }

  if (pendingKeywords.length === 0 && pendingNegatives.length === 0) return;

  const keywordOps = pendingKeywords.map((kw) => buildKeywordOp(kw, adGroupResource));
  const negativeOps = pendingNegatives.map((neg) => buildNegativeOp(neg, adGroupResource));
  const operations: GoogleAdsMutateOperation[] = [...keywordOps, ...negativeOps];

  let res: GoogleAdsMutateResponse | null = null;
  try {
    res = await client.mutate(credentials, "adGroupCriteria", operations, {
      partialFailure: true,
    });
  } catch (err) {
    // A non-partial-failure error means the whole batch was rejected
    // (typically auth or quota). Mark every pending criterion as failed.
    const failureMessage = errorMessage(err);
    for (const kw of pendingKeywords) {
      summary.keywordsFailed.push({
        localId: kw.id,
        name: kw.keyword,
        error: failureMessage,
        scope: `${campaign.name} → ${adGroup.name}`,
      });
    }
    for (const neg of pendingNegatives) {
      summary.negativesFailed.push({
        localId: neg.id,
        name: neg.keyword,
        error: failureMessage,
        scope: campaign.name,
      });
    }
    return;
  }

  // Walk results in operation order; partial-failure responses use
  // `null` slots in `results` for failed ops + carry the per-op errors
  // in `partialFailureError.details`.
  const results = res.results ?? [];
  const failureDetails = parsePartialFailureMessages(res.partialFailureError);

  for (let i = 0; i < pendingKeywords.length; i += 1) {
    const kw = pendingKeywords[i];
    const result = results[i];
    if (result?.resourceName) {
      summary.keywordsCreated.push({
        localId: kw.id,
        resourceName: result.resourceName,
        name: kw.keyword,
      });
      if (persister) {
        try {
          await persister.setKeywordResource(kw.id, result.resourceName);
        } catch (err) {
          summary.warnings.push(
            `Keyword "${kw.keyword}" created but failed to persist resource name: ${errorMessage(err)}`,
          );
        }
      }
    } else {
      summary.keywordsFailed.push({
        localId: kw.id,
        name: kw.keyword,
        error: failureDetails.get(i) ?? "partial_failure (no detail)",
        scope: `${campaign.name} → ${adGroup.name}`,
      });
    }
  }

  for (let i = 0; i < pendingNegatives.length; i += 1) {
    const neg = pendingNegatives[i];
    const resultIndex = pendingKeywords.length + i;
    const result = results[resultIndex];
    if (result?.resourceName) {
      // Negatives are pushed once per ad group; the SAME negative row
      // can land in multiple ad groups. Dedupe by localId so the
      // summary reflects a one-row-per-negative count and persist the
      // first resource name on the row.
      if (!summary.negativesCreated.some((x) => x.localId === neg.id)) {
        summary.negativesCreated.push({
          localId: neg.id,
          resourceName: result.resourceName,
          name: neg.keyword,
        });
        if (persister) {
          try {
            await persister.setNegativeResource(neg.id, result.resourceName);
          } catch (err) {
            summary.warnings.push(
              `Negative "${neg.keyword}" created but failed to persist resource name: ${errorMessage(err)}`,
            );
          }
        }
      }
    } else if (!summary.negativesFailed.some((x) => x.localId === neg.id)) {
      summary.negativesFailed.push({
        localId: neg.id,
        name: neg.keyword,
        error: failureDetails.get(resultIndex) ?? "partial_failure (no detail)",
        scope: campaign.name,
      });
    }
  }
}

// ─── RSA fan-out ──────────────────────────────────────────────────────

interface PushRsasArgs {
  client: GoogleAdsClient;
  credentials: GoogleAdsCustomerCredentials;
  customerId: string;
  campaign: GoogleSearchCampaignNode;
  adGroup: GoogleSearchAdGroupNode;
  adGroupResource: string;
  persister?: GoogleSearchPushPersister;
  summary: GoogleSearchLaunchSummary;
}

async function pushAdGroupRsas(args: PushRsasArgs): Promise<void> {
  const { client, credentials, campaign, adGroup, adGroupResource, persister, summary } = args;

  for (const rsa of adGroup.rsas) {
    if (rsa.pushed_resource_name) {
      summary.rsasCreated.push({
        localId: rsa.id,
        resourceName: rsa.pushed_resource_name,
        reused: true,
      });
      continue;
    }
  }

  // Defence in depth: an RSA with no / invalid `final_url` cannot be
  // pushed — Google Ads rejects `adGroupAds:mutate` without finalUrls.
  // The Review step hard-blocks this case at the wizard level, but if
  // a stale tab or programmatic edit slips through, partial-fail the
  // bad RSAs here so the rest of the ad group still ships.
  for (const rsa of adGroup.rsas) {
    if (rsa.pushed_resource_name) continue;
    const reason = finalUrlBlockReason(rsa);
    if (reason) {
      summary.rsasFailed.push({
        localId: rsa.id,
        error: reason,
        scope: `${campaign.name} → ${adGroup.name}`,
      });
    }
  }

  const pending = adGroup.rsas.filter(
    (r) => !r.pushed_resource_name && isPushableRsa(r),
  );
  if (pending.length === 0) return;

  const operations: GoogleAdsMutateOperation[] = pending.map((rsa) =>
    buildRsaOp(rsa, adGroupResource),
  );

  let res: GoogleAdsMutateResponse | null = null;
  try {
    res = await client.mutate(credentials, "adGroupAds", operations, { partialFailure: true });
  } catch (err) {
    const message = errorMessage(err);
    for (const rsa of pending) {
      summary.rsasFailed.push({
        localId: rsa.id,
        error: message,
        scope: `${campaign.name} → ${adGroup.name}`,
      });
    }
    return;
  }

  const results = res.results ?? [];
  const failureDetails = parsePartialFailureMessages(res.partialFailureError);

  for (let i = 0; i < pending.length; i += 1) {
    const rsa = pending[i];
    const result = results[i];
    if (result?.resourceName) {
      summary.rsasCreated.push({
        localId: rsa.id,
        resourceName: result.resourceName,
      });
      if (persister) {
        try {
          await persister.setRsaResource(rsa.id, result.resourceName);
        } catch (err) {
          summary.warnings.push(
            `RSA created but failed to persist resource name: ${errorMessage(err)}`,
          );
        }
      }
    } else {
      summary.rsasFailed.push({
        localId: rsa.id,
        error: failureDetails.get(i) ?? "partial_failure (no detail)",
        scope: `${campaign.name} → ${adGroup.name}`,
      });
    }
  }
}

// ─── Payload builders (exported for unit tests) ───────────────────────

export function buildBudgetOp(
  campaign: GoogleSearchCampaignNode,
  customerId: string,
): { create: Record<string, unknown> } {
  const daily = resolveDailyBudgetMicros(campaign);
  return {
    create: {
      resourceName: `customers/${customerId}/campaignBudgets/-1`,
      name: `${campaign.name} Budget`.slice(0, 255),
      amountMicros: String(daily),
      deliveryMethod: "STANDARD",
      explicitlyShared: false,
    },
  };
}

export function buildCampaignOp(args: {
  campaign: GoogleSearchCampaignNode;
  budgetResource: string;
  customerId: string;
  biddingStrategy: GoogleSearchBiddingStrategy;
  /** Defaults to PRESENCE — recommended for ticketed events. */
  geoTargetType?: GoogleSearchGeoTargetType;
  eventCode: string | null;
}): { create: Record<string, unknown> } {
  const {
    campaign,
    budgetResource,
    customerId,
    biddingStrategy,
    geoTargetType = "PRESENCE",
    eventCode,
  } = args;
  const create: Record<string, unknown> = {
    resourceName: `customers/${customerId}/campaigns/-2`,
    name: prefixCampaignName(campaign.name, eventCode),
    advertisingChannelType: "SEARCH",
    status: "PAUSED",
    campaignBudget: budgetResource,
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    },
    // PRESENCE: only target people physically in / regularly in the
    // location. Recommended for ticketed events — someone abroad who
    // is merely "interested" in London can't attend. Operator toggles
    // to PRESENCE_OR_INTEREST in the Targeting step when appropriate
    // (brand awareness, lookalike geo).
    geoTargetTypeSetting: {
      positiveGeoTargetType: geoTargetType,
      negativeGeoTargetType: "PRESENCE",
    },
    // v23 HARD REQUIREMENT — see PR #442 session log.
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  };
  if (biddingStrategy === "maximize_clicks") {
    create.targetSpend = { cpcBidCeilingMicros: String(DEFAULT_CPC_CEILING_MICROS) };
  } else {
    create.manualCpc = {};
  }
  return { create };
}

export function buildAdGroupOp(args: {
  adGroup: GoogleSearchAdGroupNode;
  campaignResource: string;
  customerId: string;
}): { create: Record<string, unknown> } {
  const { adGroup, campaignResource, customerId } = args;
  const cpcMicros =
    adGroup.default_cpc != null
      ? Math.max(MIN_DAILY_BUDGET_MICROS, Math.round(adGroup.default_cpc * 1_000_000))
      : DEFAULT_AD_GROUP_CPC_MICROS;
  return {
    create: {
      resourceName: `customers/${customerId}/adGroups/-3`,
      campaign: campaignResource,
      name: adGroup.name.slice(0, 255),
      status: "PAUSED",
      type: "SEARCH_STANDARD",
      cpcBidMicros: String(cpcMicros),
    },
  };
}

export function buildKeywordOp(
  keyword: GoogleSearchKeyword,
  adGroupResource: string,
): { create: Record<string, unknown> } {
  return {
    create: {
      adGroup: adGroupResource,
      status: "ENABLED",
      keyword: { text: keyword.keyword, matchType: keyword.match_type },
    },
  };
}

export function buildNegativeOp(
  negative: GoogleSearchNegative,
  adGroupResource: string,
): { create: Record<string, unknown> } {
  return {
    create: {
      adGroup: adGroupResource,
      negative: true,
      keyword: { text: negative.keyword, matchType: negative.match_type },
    },
  };
}

export function buildRsaOp(
  rsa: GoogleSearchRsa,
  adGroupResource: string,
): { create: Record<string, unknown> } {
  const ad: Record<string, unknown> = {
    responsiveSearchAd: {
      headlines: rsa.headlines.map((h) =>
        h.pin_position
          ? { text: h.text, pinnedField: pinnedFieldForHeadline(h.pin_position) }
          : { text: h.text },
      ),
      descriptions: rsa.descriptions.map((d) =>
        d.pin_position
          ? { text: d.text, pinnedField: pinnedFieldForDescription(d.pin_position) }
          : { text: d.text },
      ),
    },
  };
  if (rsa.final_url) ad.finalUrls = [rsa.final_url];
  if (rsa.path1 || rsa.path2) {
    const responsiveSearchAd = ad.responsiveSearchAd as Record<string, unknown>;
    if (rsa.path1) responsiveSearchAd.path1 = rsa.path1;
    if (rsa.path2) responsiveSearchAd.path2 = rsa.path2;
  }
  return {
    create: {
      adGroup: adGroupResource,
      status: "PAUSED",
      ad,
    },
  };
}

// ─── Helpers (exported where useful for tests / the wizard) ──────────

export function prefixCampaignName(name: string, eventCode: string | null): string {
  if (!eventCode) return name;
  const tag = `[${eventCode}]`;
  if (name.startsWith(tag)) return name;
  return `${tag} ${name}`.slice(0, 255);
}

export function poundsToMicros(pounds: number): number {
  return Math.round(pounds * 1_000_000);
}

function resolveDailyBudgetMicros(campaign: GoogleSearchCampaignNode): number {
  if (campaign.daily_budget != null && campaign.daily_budget > 0) {
    return Math.max(MIN_DAILY_BUDGET_MICROS, poundsToMicros(campaign.daily_budget));
  }
  if (campaign.monthly_budget != null && campaign.monthly_budget > 0) {
    const daily = campaign.monthly_budget / 30;
    return Math.max(MIN_DAILY_BUDGET_MICROS, poundsToMicros(daily));
  }
  return poundsToMicros(DEFAULT_DAILY_BUDGET_POUNDS);
}

function collectNegativesForCampaign(
  tree: GoogleSearchPlanTree,
  campaign: GoogleSearchCampaignNode,
): GoogleSearchNegative[] {
  // Order: plan-scoped first, then campaign-scoped. Stable so the
  // index → row mapping in pushAdGroupCriteria is deterministic.
  return [...tree.plan_negatives, ...campaign.negatives];
}

function pinnedFieldForHeadline(position: 1 | 2 | 3): string {
  return `HEADLINE_${position}` as const;
}

function pinnedFieldForDescription(position: 1 | 2): string {
  return `DESCRIPTION_${position}` as const;
}

function pickResourceName(res: GoogleAdsMutateResponse, index: number): string {
  const name = res.results?.[index]?.resourceName;
  if (!name) {
    throw new Error(
      `Google Ads mutate returned no resourceName for index ${index}. Response: ${JSON.stringify(res)}`,
    );
  }
  return name;
}

async function tryRemove(
  client: GoogleAdsClient,
  credentials: GoogleAdsCustomerCredentials,
  resource: string,
  resourceName: string,
  summary: GoogleSearchLaunchSummary,
  kind: "budget" | "campaign",
): Promise<void> {
  try {
    await client.mutate(credentials, resource, [{ remove: resourceName }]);
    if (kind === "budget") summary.budgetsRolledBack.push(resourceName);
    else summary.campaignsRolledBack.push(resourceName);
  } catch (err) {
    summary.warnings.push(
      `Cleanup ${resource}:remove ${resourceName} failed: ${errorMessage(err)}`,
    );
  }
}

function parsePartialFailureMessages(
  partialFailureError: GoogleAdsMutateResponse["partialFailureError"] | null | undefined,
): Map<number, string> {
  const out = new Map<number, string>();
  if (!partialFailureError?.details) return out;
  for (const detail of partialFailureError.details) {
    const failure = detail as { errors?: unknown };
    if (!Array.isArray(failure.errors)) continue;
    for (const errRow of failure.errors) {
      const e = errRow as {
        message?: string;
        location?: { fieldPathElements?: Array<{ index?: number; fieldName?: string }> };
      };
      const idxFromPath = e.location?.fieldPathElements?.find(
        (p) => p.fieldName === "operations" && typeof p.index === "number",
      )?.index;
      if (typeof idxFromPath === "number" && e.message) {
        const existing = out.get(idxFromPath);
        out.set(idxFromPath, existing ? `${existing}; ${e.message}` : e.message);
      }
    }
  }
  return out;
}

function errorMessage(err: unknown): string {
  if (err instanceof GoogleAdsApiError) {
    return `${err.status ?? "ERR"}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return safeStringify(err);
}

function isAuthLikeError(err: unknown): boolean {
  if (err instanceof GoogleAdsApiError) {
    if (err.httpStatus === 401 || err.httpStatus === 403) return true;
    if (err.status === "UNAUTHENTICATED" || err.status === "PERMISSION_DENIED") return true;
  }
  if (err instanceof Error) {
    const m = err.message.toLowerCase();
    return m.includes("refresh token") || m.includes("access token");
  }
  return false;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createEmptySummary(planId: string, customerId: string): GoogleSearchLaunchSummary {
  return {
    ok: false,
    planId,
    customerId,
    campaignsCreated: [],
    campaignsFailed: [],
    adGroupsCreated: [],
    adGroupsFailed: [],
    keywordsCreated: [],
    keywordsFailed: [],
    negativesCreated: [],
    negativesFailed: [],
    rsasCreated: [],
    rsasFailed: [],
    budgetsCreated: [],
    budgetsRolledBack: [],
    campaignsRolledBack: [],
    warnings: [],
    partialFailure: false,
    aborted: false,
    planStatusUpdate: "draft",
  };
}

// Result type re-export so the route + wizard see one source of truth.
export type { GoogleAdsMutateOperation, GoogleAdsMutateResponse, GoogleAdsMutateResult };
