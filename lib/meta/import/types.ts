/**
 * Live Meta → creator import. Read-only against Meta. The source
 * campaign is never written. Launch is the existing gated writer.
 *
 * Graph paths the importer is allowed to call. `{campaign_id}` is a
 * placeholder — the recorder stores the concrete path that went on
 * the wire (`/52522388611107/adsets`). `"/"` is the Batch API POST
 * that replaced `GET /?ids=` in Graph v26.0; it carries
 * `CREATIVE_BATCH_FIELDS` as sub-request fields, not a new Graph
 * edge.
 */

export const META_IMPORT_PATHS = [
  "/{campaign_id}",
  "/{campaign_id}/adsets",
  "/{campaign_id}/ads",
  "/",
] as const;

export type MetaImportPath = (typeof META_IMPORT_PATHS)[number];

/** Map a concrete Graph path onto the allowlist template. */
export function classifyMetaImportPath(path: string): MetaImportPath | null {
  if (path === "/" || path === "") return "/";
  if (/^\/[^/]+$/.test(path)) return "/{campaign_id}";
  if (/^\/[^/]+\/adsets$/.test(path)) return "/{campaign_id}/adsets";
  if (/^\/[^/]+\/ads$/.test(path)) return "/{campaign_id}/ads";
  return null;
}

export const META_IMPORT_CAMPAIGN_FIELDS = [
  "id",
  "account_id",
  "name",
  "objective",
  "status",
  "effective_status",
  "buying_type",
  "special_ad_categories",
  "daily_budget",
  "lifetime_budget",
  "bid_strategy",
  "pacing_type",
  "start_time",
  "stop_time",
  "created_time",
  "updated_time",
].join(",");

/**
 * Full `targeting`, not the picker subset. That type throws
 * `cities[].key` away; this read exists to prove whether Meta
 * actually returns it.
 */
export const META_IMPORT_ADSET_FIELDS = [
  "id",
  "name",
  "campaign_id",
  "status",
  "effective_status",
  "optimization_goal",
  "billing_event",
  "daily_budget",
  "lifetime_budget",
  "bid_strategy",
  "bid_amount",
  "start_time",
  "end_time",
  "promoted_object",
  "destination_type",
  "attribution_spec",
  "targeting",
  "targeting_automation",
  "created_time",
  "updated_time",
].join(",");

export const META_IMPORT_AD_FIELDS = [
  "id",
  "name",
  "adset_id",
  "campaign_id",
  "status",
  "effective_status",
  "creative{id}",
  "created_time",
  "updated_time",
].join(",");

export const META_IMPORT_PAGE_LIMIT = 50;
export const META_IMPORT_EXTRA_PAGE_SLEEP_MS = 1000;

export type MetaImportGraphGet = (
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<unknown>;

export type MetaImportGraphPost = (
  path: string,
  body: Record<string, unknown>,
  token: string,
) => Promise<unknown>;

export type MetaImportRequest = {
  get: MetaImportGraphGet;
  post: MetaImportGraphPost;
};

export type MetaImportRecordedCall = {
  method: "GET" | "POST";
  path: string;
  params: Record<string, unknown>;
  ok: boolean;
  data: unknown;
  error: { message: string } | null;
  startedAt: string;
  durationMs: number;
};

export type MetaLiveCampaignBundle = {
  campaign: Record<string, unknown>;
  adSets: Record<string, unknown>[];
  ads: Record<string, unknown>[];
  creatives: Record<string, Record<string, unknown>>;
};

/**
 * Targeting keys the draft has no field for. Named once so a new Meta
 * key cannot fall through an `if` and disappear.
 */
export const META_IMPORT_UNCARRIABLE_TARGETING_FIELDS = [
  "locales",
  "genders",
  "device_platforms",
  "publisher_platforms",
  "facebook_positions",
  "instagram_positions",
  "targeting_automation",
  "targeting_relaxation_types",
  "brand_safety_content_filter_levels",
  "attribution_spec",
  "destination_type",
  "location_types",
  "age_range",
] as const;

/** Absent is not empty. A read that never returned the key stays absent. */
export type MetaImportFlexibleSpec = {
  state: "absent" | "empty" | "present";
  interestIds: string[];
};

export type MetaImportDropped = {
  field: string;
  adSetId?: string;
  adSetName?: string;
  creativeId?: string;
  value: unknown;
};

export type MetaImportNotCarried = {
  id: string;
  name: string;
  reason: string;
};

export type MetaImportReadProgress = {
  adSetsRead: number;
  adsRead: number;
  creativesRead: number;
};

export type MetaImportMeta = {
  sourceCampaignId: string;
  sourceCampaignName: string;
  sourceAdAccountId: string;
  dropped: MetaImportDropped[];
  notCarried: MetaImportNotCarried[];
  creativeCounts: { read: number; carried: number; notCarried: number };
  /** Per source ad set. Absent stays distinct from an empty array. */
  flexibleSpec: Record<string, MetaImportFlexibleSpec>;
  /** `X-App-Usage` call_count when a read reported one. */
  appUsageCallCount: number | null;
};

export const META_IMPORT_EVENT_ID_REQUIRED = "event_id is required";
export const META_IMPORT_EVENT_ID_CLIENT_MISMATCH =
  "event_id does not belong to this client";
export const META_IMPORT_ACCOUNT_NOT_LINKED =
  "This ad account is not linked to a client";
