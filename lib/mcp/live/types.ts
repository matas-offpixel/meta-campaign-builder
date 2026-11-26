/**
 * lib/mcp/live/types.ts — what the M3b live tools reach (scope mcp:meta).
 *
 * Every Meta read and write the live tools make goes through McpLiveDeps.
 * The route passes the real one (lib/mcp/meta-deps.ts, the one Meta seam);
 * tests pass spies. Each write method is an existing app path:
 *   - setStatus: the ad-set status write (OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED),
 *     the ad-status write (OFFPIXEL_META_AD_STATUS_WRITES_ENABLED), and the
 *     campaign mirror behind the ad-set switch (lib/meta/campaign-status-write.ts);
 *   - setBudget: the optimisation budget write (ENABLE_OPTIMISATION_WRITES, lib/meta/budget-write.ts);
 *   - moveBudget: the on-sale refresh's move (moveAdSetDailyBudget);
 *   - rename: lib/meta/object-name-write.ts (no app path existed);
 *   - bulkAttach: the campaign tree's "Add creatives to…" (bulkAttachAs, OFFPIXEL_META_TREE_ADD_WRITES_ENABLED);
 *   - adsetAudience: the tree's "Add audience to…" (adsetAudienceAs, OFFPIXEL_META_ADSET_TARGETING_WRITES_ENABLED);
 *   - createStudy: lib/meta/ad-study.ts (#1321's ad_studies shape).
 * Every write is on meta_write_idempotency, keyed on the ask.
 *
 * Relative imports only (node:test).
 */
import type { GraphCampaign } from "../../campaign-tree/load.ts";

export type LiveKind = "campaign" | "adset" | "ad";

export interface LiveObject {
  id: string;
  kind: LiveKind;
  name: string | null;
  /** "act_…". */
  accountId: string | null;
  /** Its own configured status (ACTIVE / PAUSED / ARCHIVED / DELETED). */
  status: string | null;
  effectiveStatus: string | null;
  /** Minor units (pence, cents); null when not set on this object. */
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  budgetRemainingMinor: number | null;
  startTime: string | null;
  endTime: string | null;
  campaignId: string | null;
  adsetId: string | null;
  /** learning_stage_info.status (LEARNING, SUCCESS, FAIL) on an ad set. */
  learningStatus: string | null;
  /** Ad sets only: the targeting Meta holds. */
  targeting: Record<string, unknown> | null;
}

export interface LiveInsight {
  spendToday: number;
  spendToDate: number;
  /** The result count, by the first action type present in RESULT_ACTIONS. */
  results: number | null;
  resultType: string | null;
  costPerResult: number | null;
}

/** The ledger's draft and event for one write (meta_write_idempotency is per draft). */
export interface LedgerRef {
  draftId: string;
  eventId: string | null;
}

export interface LiveSwitches {
  adsetStatus: boolean;
  adStatus: boolean;
  budget: boolean;
  treeAdd: boolean;
  targeting: boolean;
}

/** The on-sale refresh's move plan (lib/onsale-refresh/apply.ts MovePlan). */
export interface MovePlanLite {
  fromAdsetId: string;
  toAdsetId: string;
  deltaMinor: number;
  from: { before: number; after: number };
  to: { before: number; after: number };
}

export interface McpLiveDeps {
  /** The deployment's write switches, as each path reads them. */
  switches(): LiveSwitches;
  /** The campaign tree's read (one batched GET per ≤ 50 campaigns). */
  readCampaigns(userId: string, ids: string[]): Promise<Map<string, GraphCampaign>>;
  /** One batched GET per ≤ 50 ids of one kind. A missing id is absent from the map. */
  readObjects(userId: string, kind: LiveKind, ids: string[]): Promise<{ objects: Map<string, LiveObject>; metaGets: number }>;
  /** A campaign's ad sets and ads (GETs). */
  readChildren(userId: string, campaignId: string): Promise<{ adsets: LiveObject[]; ads: LiveObject[]; metaGets: number }>;
  /** Spend today (the account's day) and to date, results and cost per result, per id (batched GETs). */
  readInsights(userId: string, ids: string[]): Promise<{ insights: Map<string, LiveInsight>; metaGets: number }>;
  /** GET /act_{id}?fields=currency,timezone_name,business. */
  accountInfo(userId: string, accountId: string): Promise<{ currency: string | null; timezone: string | null; businessId: string | null }>;
  setStatus(input: { userId: string; kind: LiveKind; id: string; status: "PAUSED" | "ACTIVE"; ledger: LedgerRef; key: string }): Promise<void>;
  setBudget(input: {
    userId: string;
    kind: "campaign" | "adset";
    id: string;
    field: "daily_budget" | "lifetime_budget";
    minor: number;
    expectedMinor: number | null;
    liveMinor: number | null;
    ledger: LedgerRef;
    key: string;
  }): Promise<void>;
  moveBudget(input: {
    userId: string;
    fromAdsetId: string;
    toAdsetId: string;
    deltaMinor: number;
    campaignId: string;
    ledger: LedgerRef;
    key: string;
    /** The plan an earlier try of this ask stored, so a side already written isn't moved twice. */
    previous?: MovePlanLite | null;
  }): Promise<{ state: "applied" | "failed"; stop?: string; written: string[]; plan?: MovePlanLite }>;
  rename(input: { userId: string; kind: LiveKind; id: string; name: string; ledger: LedgerRef; key: string }): Promise<void>;
  /** POST /api/meta/bulk-attach-ads's handler (bulkAttachAs) for this operator. */
  bulkAttach(input: { userId: string; body: Record<string, unknown> }): Promise<{ status: number; body: Record<string, unknown> }>;
  /** POST /api/meta/adset-audience's handler (adsetAudienceAs) for this operator. */
  adsetAudience(input: { userId: string; body: Record<string, unknown> }): Promise<{ status: number; body: Record<string, unknown> }>;
  /** Campaign id → study id, for studies in the business still running. */
  runningStudies(userId: string, businessId: string): Promise<Map<string, string>>;
  /** POST /{business}/ad_studies, two 50 % cells (lib/meta/ad-study.ts studyPayload). */
  createStudy(input: { userId: string; businessId: string; study: { name: string; campaignA: string; campaignB: string; start: string; end: string }; ledger: LedgerRef; key: string }): Promise<string>;
}
