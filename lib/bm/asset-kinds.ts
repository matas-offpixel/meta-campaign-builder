/**
 * lib/bm/asset-kinds.ts
 *
 * Single source of truth for the four BM asset types the sync tool handles.
 * PURE — no imports from `lib/meta/client.ts` or Supabase, so the request
 * builders and their byte-diff tests can import this under Node's
 * `--experimental-strip-types` mode (same rationale as
 * `business-manager-grant-request.ts`).
 *
 * ── Everything here was verified live, not read from docs ───────────────────
 *
 * Meta's Business Manager docs are materially wrong about several of these, so
 * every edge name and task enum below was captured against Graph API v23.0 on
 * 2026-07-28 using the operator's own token. Full capture + verbatim responses:
 * docs/session-logs/pr-726-ops-bm-asset-sync-v2.md. The three findings that
 * would otherwise have shipped as bugs:
 *
 *   1. `client_instagram_accounts` DOES NOT EXIST. It 400s with code 100
 *      ("Tried accessing nonexisting field"). The real edge pair is
 *      `owned_instagram_assets` / `client_instagram_assets`.
 *
 *   2. Pixels have NO `MANAGE` task. Their verified permitted set is
 *      {EDIT, ANALYZE, UPLOAD, ADVERTISE, AA_ANALYZE}. Granting MANAGE on a
 *      pixel is a guaranteed 400.
 *
 *   3. Instagram tasks are NOT the page vocabulary. There is no `MANAGE_ACCESS`
 *      and no `CREATE_CONTENT`; the real values are CONTENT / MESSAGES /
 *      COMMUNITY_ACTIVITY / CREATIVE_MANAGEMENT / CREATOR_MANAGEMENT /
 *      FULL_CONTROL (+ ADVERTISE / ANALYZE). IG assets also do not expose a
 *      `permitted_tasks` field at all, so their enum was derived by observing
 *      `tasks` across real assignments in 8 production BMs.
 */

import type { BMPageRole } from "./types.ts";

/** The asset types the BM sync tool enumerates and grants on. */
export type BMAssetKind = "page" | "ad_account" | "pixel" | "ig_account";

export const BM_ASSET_KINDS: readonly BMAssetKind[] = [
  "page",
  "ad_account",
  "pixel",
  "ig_account",
] as const;

/** Kinds added by v2 (migration 147). `page` predates them (migration 145). */
export const BM_V2_ASSET_KINDS: readonly BMAssetKind[] = [
  "ad_account",
  "pixel",
  "ig_account",
] as const;

export function isBMAssetKind(value: string): value is BMAssetKind {
  return (BM_ASSET_KINDS as readonly string[]).includes(value);
}

/**
 * URL-path form used by the asset routes (`/api/business-managers/{biz}/assets/{slug}`).
 * Kept distinct from the snake_case kind so the URLs read naturally.
 */
export const KIND_BY_SLUG: Record<string, BMAssetKind> = {
  pages: "page",
  "ad-accounts": "ad_account",
  pixels: "pixel",
  "ig-accounts": "ig_account",
};

export const SLUG_BY_KIND: Record<BMAssetKind, string> = {
  page: "pages",
  ad_account: "ad-accounts",
  pixel: "pixels",
  ig_account: "ig-accounts",
};

export interface BMAssetKindDescriptor {
  kind: BMAssetKind;
  label: string;
  labelPlural: string;
  /** Postgres table backing this kind. */
  table: string;
  /** Column on `table` holding the Meta id that grants address. */
  idColumn: string;
  /** Column used for display + sorting. */
  nameColumn: string;
  /** `GET /{bizId}/{ownedEdge}` — assets the BM owns outright. */
  ownedEdge: string;
  /**
   * `GET /{bizId}/{clientEdge}` — assets shared into the BM by someone else.
   * Verified to exist for all four kinds (pixels/IG frequently return an empty
   * `data` array, which is NOT the same as the edge being absent).
   */
  clientEdge: string;
  /** Fields requested on the list edges — all verified to be accepted. */
  listFields: readonly string[];
  /**
   * The task values Meta accepts on this asset's `assigned_users` edge.
   * For ad accounts and pixels this is Meta's own `permitted_tasks` value read
   * back from a live asset. For IG it is the observed union (no permitted_tasks
   * field exists). For pages it is the documented set — the only kind not
   * live-verifiable here, because `GET /{pageId}/assigned_users` additionally
   * requires `pages_manage_metadata`, which the operator token does not hold.
   */
  permittedTasks: readonly string[];
  /** Whether Meta exposes `permitted_tasks` on this kind's assigned_users read. */
  exposesPermittedTasks: boolean;
}

const AD_ACCOUNT: BMAssetKindDescriptor = {
  kind: "ad_account",
  label: "Ad account",
  labelPlural: "Ad accounts",
  table: "bm_ad_accounts",
  idColumn: "ad_account_id",
  nameColumn: "name",
  ownedEdge: "owned_ad_accounts",
  clientEdge: "client_ad_accounts",
  listFields: [
    "id",
    "account_id",
    "name",
    "account_status",
    "currency",
    "timezone_name",
    "disable_reason",
  ],
  // Verbatim `permitted_tasks` from GET /act_932846012721428/assigned_users.
  permittedTasks: [
    "MANAGE",
    "ADVERTISE",
    "ANALYZE",
    "FB_EMPLOYEE_DSO_ADVERTISE",
    "CREATIVE",
    "DRAFT",
    "AA_ANALYZE",
  ],
  exposesPermittedTasks: true,
};

const PIXEL: BMAssetKindDescriptor = {
  kind: "pixel",
  label: "Pixel",
  labelPlural: "Pixels",
  table: "bm_pixels",
  idColumn: "pixel_id",
  nameColumn: "name",
  ownedEdge: "owned_pixels",
  clientEdge: "client_pixels",
  listFields: [
    "id",
    "name",
    "last_fired_time",
    "creation_time",
    "is_unavailable",
    "enable_automatic_matching",
    "data_use_setting",
  ],
  // Verbatim `permitted_tasks` from GET /1475359374117271/assigned_users.
  // Note the absence of MANAGE — the original brief assumed it.
  permittedTasks: ["EDIT", "ANALYZE", "UPLOAD", "ADVERTISE", "AA_ANALYZE"],
  exposesPermittedTasks: true,
};

const IG_ACCOUNT: BMAssetKindDescriptor = {
  kind: "ig_account",
  label: "Instagram account",
  labelPlural: "Instagram accounts",
  table: "bm_ig_accounts",
  idColumn: "ig_asset_id",
  nameColumn: "ig_username",
  ownedEdge: "owned_instagram_assets",
  clientEdge: "client_instagram_assets",
  listFields: [
    "id",
    "ig_user_id",
    "ig_username",
    "profile_pic",
    "followed_by_count",
    "media_count",
  ],
  // Observed union across 8 production BMs — IG exposes no permitted_tasks.
  permittedTasks: [
    "ADVERTISE",
    "ANALYZE",
    "CONTENT",
    "MESSAGES",
    "COMMUNITY_ACTIVITY",
    "CREATIVE_MANAGEMENT",
    "CREATOR_MANAGEMENT",
    "FULL_CONTROL",
  ],
  exposesPermittedTasks: false,
};

const PAGE: BMAssetKindDescriptor = {
  kind: "page",
  label: "Page",
  labelPlural: "Pages",
  table: "bm_pages",
  idColumn: "page_id",
  nameColumn: "page_name",
  ownedEdge: "owned_pages",
  clientEdge: "client_pages",
  listFields: ["id", "name", "category", "fan_count", "picture{url}"],
  permittedTasks: ["MANAGE", "CREATE_CONTENT", "MODERATE", "ADVERTISE", "ANALYZE"],
  exposesPermittedTasks: false,
};

export const BM_ASSET_DESCRIPTORS: Record<BMAssetKind, BMAssetKindDescriptor> = {
  page: PAGE,
  ad_account: AD_ACCOUNT,
  pixel: PIXEL,
  ig_account: IG_ACCOUNT,
};

export function describeAssetKind(kind: BMAssetKind): BMAssetKindDescriptor {
  return BM_ASSET_DESCRIPTORS[kind];
}

/**
 * Role → tasks, per asset type. Deliberately NOT one shared map: the four
 * kinds have genuinely different task vocabularies (see the header note), so a
 * shared map would silently send an invalid task for three of them.
 *
 * `ADVERTISE` is the one task valid on all four kinds, which is why
 * ADVERTISER stays the default grant role for every type (least privilege that
 * still lets the wizard run ads).
 *
 * Where a kind has no exact analogue for a role, the mapping degrades to the
 * closest task Meta actually permits rather than inventing one:
 *   - pixels have no MANAGE/FULL_CONTROL, so ADMIN maps to EDIT
 *   - ad accounts have no CREATE_CONTENT, so EDITOR maps to DRAFT
 */
export const ROLE_TASKS: Record<BMAssetKind, Record<BMPageRole, string[]>> = {
  page: {
    ADVERTISER: ["ADVERTISE"],
    ANALYST: ["ANALYZE"],
    EDITOR: ["CREATE_CONTENT"],
    ADMIN: ["MANAGE"],
  },
  ad_account: {
    ADVERTISER: ["ADVERTISE"],
    ANALYST: ["ANALYZE"],
    EDITOR: ["DRAFT"],
    ADMIN: ["MANAGE"],
  },
  pixel: {
    ADVERTISER: ["ADVERTISE"],
    ANALYST: ["ANALYZE"],
    EDITOR: ["EDIT"],
    ADMIN: ["EDIT"],
  },
  ig_account: {
    ADVERTISER: ["ADVERTISE"],
    ANALYST: ["ANALYZE"],
    EDITOR: ["CONTENT"],
    ADMIN: ["FULL_CONTROL"],
  },
};

/** Tasks a given role resolves to on a given asset kind. */
export function tasksForRole(kind: BMAssetKind, role: BMPageRole): string[] {
  return ROLE_TASKS[kind][role];
}

/**
 * True when every task is one Meta accepts for this asset kind. Guards against
 * sending e.g. MANAGE to a pixel, which Meta rejects with a generic 400 that is
 * hard to diagnose after the fact.
 */
export function areTasksValidForKind(kind: BMAssetKind, tasks: readonly string[]): boolean {
  const permitted = new Set(BM_ASSET_DESCRIPTORS[kind].permittedTasks);
  return tasks.length > 0 && tasks.every((t) => permitted.has(t));
}

/**
 * Whether a grant took effect, given the tasks we asked for and the tasks read
 * back from Meta.
 *
 * SUPERSET, never equality: Meta expands grants. Verified live — requesting
 * `tasks=["ADVERTISE"]` on IG asset 1026165617251103 read back as
 * `["ADVERTISE","ANALYZE","CONTENT","MESSAGES","COMMUNITY_ACTIVITY"]`. An
 * equality check would report every successful IG grant as a failure.
 */
export function grantSatisfied(
  requested: readonly string[],
  actual: readonly string[],
): boolean {
  if (requested.length === 0) return false;
  const have = new Set(actual);
  return requested.every((t) => have.has(t));
}
