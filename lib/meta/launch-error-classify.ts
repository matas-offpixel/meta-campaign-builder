/**
 * lib/meta/launch-error-classify.ts
 *
 * Maps a Meta Graph error code to an honest, actionable launch message.
 *
 * The launch path used to treat ANY token-validation failure as token expiry
 * ("Your Facebook connection has expired… reconnect"). But Meta's /debug_token
 * call can itself be RATE-LIMITED (#4 "Application request limit reached",
 * is_transient:true) when the token is perfectly fresh — so the user was sent
 * reconnecting repeatedly for nothing (see memory
 * project_auth_error_masks_rate_limit). This classifier separates the two.
 *
 * Mirrors the code-mapping shape of `campaignFetchSkipReason` (PR #394) and is
 * dependency-free + duck-typed so it imports cleanly under the strip-only test
 * runner (no `@/` imports, no `server-only`).
 */

/**
 * App/user/account-level rate limits. The fix is to wait — NOT reconnect
 * Facebook, and NOT burn more BUC budget with in-launch transient retries.
 *   4     — Application request limit reached (often a BUC envelope)
 *   17    — User request limit reached
 *   32    — Page request limit reached
 *   341   — Application-level rate cap (alt code on some edges)
 *   613   — Custom audiences / ads rate limit
 *   80004 — Ad-account request limit reached
 */
const META_RATE_LIMIT_CODES: ReadonlySet<number> = new Set([
  4, 17, 32, 341, 613, 80004,
]);

/**
 * Genuine auth failures — the token really is expired/invalid, so reconnecting
 * Facebook IS the correct fix.
 *   190 — Access token expired / invalidated
 *   102 — Session key invalid / expired
 */
const META_AUTH_CODES: ReadonlySet<number> = new Set([190, 102]);

export type LaunchErrorKind = "rate_limit" | "auth" | "other";

/** Classify a Meta error code into the three launch-relevant buckets. */
export function classifyLaunchMetaCode(
  code: number | undefined | null,
): LaunchErrorKind {
  if (typeof code !== "number") return "other";
  if (META_RATE_LIMIT_CODES.has(code)) return "rate_limit";
  if (META_AUTH_CODES.has(code)) return "auth";
  return "other";
}

export interface LaunchTokenErrorMapping {
  kind: LaunchErrorKind;
  /** User-facing message. */
  message: string;
  /** HTTP status the launch route should return. */
  status: number;
  /** Whether the client should prompt a Facebook reconnect. */
  reconnect: boolean;
}

/** Honest reconnect copy — kept verbatim so the existing client UX still fires. */
const RECONNECT_MESSAGE =
  "Your Facebook connection has expired. Please reconnect Facebook in Account Setup before launching.";

/**
 * Map a failed token-validation code to the response the launch route should
 * send. Rate limits get a transient/retry message and do NOT prompt a reconnect;
 * everything else (genuine auth failures AND inconclusive/unknown validation
 * errors) keeps the pre-existing reconnect block so the auth gate isn't weakened.
 */
export function mapLaunchTokenError(
  code: number | undefined | null,
): LaunchTokenErrorMapping {
  const kind = classifyLaunchMetaCode(code);
  if (kind === "rate_limit") {
    return {
      kind,
      status: 429,
      reconnect: false,
      message: `Meta rate limit reached (#${code}) — this is temporary; retry after the window resets.`,
    };
  }
  return { kind, status: 401, reconnect: true, message: RECONNECT_MESSAGE };
}

/**
 * Ad create refused because the creative has no website URL (subcode
 * 2061015). This is not the Development-mode bucket.
 */
/**
 * Ad set refused because its parent campaign is archived (subcode
 * 1487866). This is not the Development-mode bucket.
 */
/** The #985 refusal. Shared by launch (subcode 1487866) and Add to campaign. */
export function archivedCampaignRefusal(campaignId: string): string {
  const id = campaignId.trim() || "unknown";
  return (
    `Campaign ${id} is archived in Meta. Unarchive it in Ads Manager, ` +
    `or duplicate this draft to launch a new campaign.`
  );
}

export function archivedCampaignMessage(
  campaignId: string,
  err: { code?: number; subcode?: number; message?: string; userMsg?: string },
): string | null {
  const text = `${err.message ?? ""} ${err.userMsg ?? ""}`;
  const hit =
    err.subcode === 1487866 || /may not be added to archived campaigns/i.test(text);
  if (!hit) return null;
  return archivedCampaignRefusal(campaignId);
}

/**
 * Lifetime ad set created with no end date. Probe d on
 * act_606252931141334: HTTP 400, code 100, error_subcode 1487094,
 * error_user_title "No end date entered".
 */
export const LIFETIME_BUDGET_END_DATE_SUBCODE = 1487094;

export function lifetimeBudgetEndDateMessage(err: {
  code?: number;
  subcode?: number;
  message?: string;
  userMsg?: string;
}): string | null {
  const text = `${err.message ?? ""} ${err.userMsg ?? ""}`;
  const hit =
    err.subcode === LIFETIME_BUDGET_END_DATE_SUBCODE ||
    /lifetime as the budget type must have an end date/i.test(text);
  if (!hit) return null;
  return "Lifetime budgets need an end date.";
}

export function websiteUrlRequiredMessage(
  creativeName: string,
  err: { code?: number; subcode?: number; message?: string; userMsg?: string },
): string | null {
  const text = `${err.message ?? ""} ${err.userMsg ?? ""}`;
  const hit = err.subcode === 2061015 || /website URL field is required/i.test(text);
  if (!hit) return null;
  const name = creativeName.trim() || "This creative";
  return (
    `"${name}" is an Instagram video in a campaign that optimises for a website event. ` +
    `Set its destination URL on the creative in the Creatives step, then launch again.`
  );
}

interface MetaErrorLike {
  code?: number;
  subcode?: number;
  message?: string;
  userMsg?: string;
  fbtraceId?: string;
}

export type CreativeCreateErrorKind =
  | "app_mode"
  | "permission"
  | "website_url_required"
  | "archived_campaign"
  | "other";

/** Assets the failed creative uses, plus the context the existing helpers need. */
export interface CreativeCreateErrorIdentity {
  creativeName?: string;
  campaignId?: string;
  pageId?: string | null;
  instagramAccountId?: string | null;
}

export interface CreativeCreateErrorClassification {
  kind: CreativeCreateErrorKind;
  message: string;
  skippedReason?: "app_mode_blocked" | "permission";
}

/**
 * Only Meta's explicit wording counts as a Development-mode block. Code 200 is
 * Meta's generic Permissions error and a bare "development" substring shows up
 * in unrelated messages, so neither is enough on its own.
 */
const APP_MODE_PATTERN =
  /app (that )?(is )?(in )?development mode|not (in )?live mode|switch (the )?app to live/i;

const PERMISSION_CODES: ReadonlySet<number> = new Set([200, 10]);
const PERMISSION_SUBCODES: ReadonlySet<number> = new Set([1349125, 1349131]);

function toMetaErrorLike(err: unknown): MetaErrorLike {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    return {
      code: typeof e.code === "number" ? e.code : undefined,
      subcode: typeof e.subcode === "number" ? e.subcode : undefined,
      message: typeof e.message === "string" ? e.message : String(err),
      userMsg: typeof e.userMsg === "string" ? e.userMsg : undefined,
      fbtraceId: typeof e.fbtraceId === "string" ? e.fbtraceId : undefined,
    };
  }
  return { message: String(err) };
}

function withMetaCodes(err: MetaErrorLike): string {
  const parts: string[] = [err.message ?? ""];
  if (err.code) parts.push(`code=${err.code}`);
  if (err.subcode) parts.push(`subcode=${err.subcode}`);
  if (err.userMsg) parts.push(`detail: "${err.userMsg}"`);
  if (err.fbtraceId) parts.push(`trace=${err.fbtraceId}`);
  return parts.join(" · ");
}

/** "a", "a and b", "a, b and c". */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function creativeAssetLabels(identity?: {
  pageId?: string | null;
  instagramAccountId?: string | null;
}): string[] {
  const labels: string[] = [];
  const pageId = identity?.pageId?.trim();
  const igId = identity?.instagramAccountId?.trim();
  if (pageId) labels.push(`Page ${pageId}`);
  if (igId) labels.push(`Instagram account ${igId}`);
  return labels;
}

/**
 * Single entry point for a failed creative create in launch Phase 3. Decides
 * whether the failure is a genuine Development-mode block, a missing
 * permission on the creative's Page / Instagram account, one of the known
 * website-URL / archived-campaign refusals, or something else.
 */
export function classifyCreativeCreateError(
  err: unknown,
  identity?: CreativeCreateErrorIdentity,
): CreativeCreateErrorClassification {
  const e = toMetaErrorLike(err);

  const websiteUrl = websiteUrlRequiredMessage(identity?.creativeName ?? "", e);
  if (websiteUrl) return { kind: "website_url_required", message: websiteUrl };

  const archived = archivedCampaignMessage(identity?.campaignId ?? "", e);
  if (archived) return { kind: "archived_campaign", message: archived };

  if (APP_MODE_PATTERN.test(e.message ?? "") || APP_MODE_PATTERN.test(e.userMsg ?? "")) {
    return {
      kind: "app_mode",
      skippedReason: "app_mode_blocked",
      message:
        `Creative blocked — this ad type requires your Meta app to be in Live/Public mode. ` +
        `Ads will not deliver until the app is switched to Live mode in Meta for Developers → App Settings → Status. ` +
        `Original error: ${e.message ?? ""}`,
    };
  }

  const isPermission =
    (e.code !== undefined && PERMISSION_CODES.has(e.code)) ||
    (e.subcode !== undefined && PERMISSION_SUBCODES.has(e.subcode));
  if (isPermission) {
    const assets = creativeAssetLabels(identity);
    const target = assets.length > 0 ? joinList(assets) : "the Page or Instagram account this creative uses";
    return {
      kind: "permission",
      skippedReason: "permission",
      message:
        `Creative blocked — the launch token lacks a permission on ${target}. ` +
        `Grant access in Business Managers (/business-managers), then relaunch. ` +
        `Meta said: ${withMetaCodes(e)}`,
    };
  }

  return { kind: "other", message: withMetaCodes(e) };
}

/** Shape of a failed creative on `LaunchSummary.creativesFailed`. */
export interface CreativeFailureLike {
  skippedReason?: string;
  pageId?: string;
  instagramAccountId?: string;
}

export interface CreativeFailureBanners {
  appMode: { count: number; allBlocked: boolean; title: string } | null;
  permission: {
    count: number;
    allBlocked: boolean;
    assets: string[];
    title: string;
    body: string;
  } | null;
}

/**
 * Banner copy for the Review & Launch result card and the Phase 3 preflight
 * warning. Each banner appears only when its own bucket has failures.
 */
export function creativeFailureBanners(summary: {
  creativesFailed: readonly CreativeFailureLike[];
  creativesCreated: readonly unknown[];
}): CreativeFailureBanners {
  const noneCreated = summary.creativesCreated.length === 0;
  const plural = (n: number) => (n !== 1 ? "s" : "");

  const appModeCount = summary.creativesFailed.filter(
    (c) => c.skippedReason === "app_mode_blocked",
  ).length;
  const appMode =
    appModeCount > 0
      ? {
          count: appModeCount,
          allBlocked: noneCreated,
          title: noneCreated
            ? "Campaign structure created — creatives not launched"
            : `${appModeCount} creative${plural(appModeCount)} blocked by Meta app mode`,
        }
      : null;

  const permissionFailures = summary.creativesFailed.filter(
    (c) => c.skippedReason === "permission",
  );
  let permission: CreativeFailureBanners["permission"] = null;
  if (permissionFailures.length > 0) {
    const count = permissionFailures.length;
    const allBlocked = noneCreated && count === summary.creativesFailed.length;
    const assets = [...new Set(permissionFailures.flatMap((c) => creativeAssetLabels(c)))];
    const target = assets.length > 0 ? joinList(assets) : "the Pages or Instagram accounts these creatives use";
    permission = {
      count,
      allBlocked,
      assets,
      title: `${count} creative${plural(count)} blocked — launch token lacks permission`,
      body:
        (allBlocked
          ? "Your campaign and ad sets were created in Meta, but no creatives were launched. "
          : "") +
        `Meta refused ${count === 1 ? "this creative" : "these creatives"} because the launch token lacks a permission on ${target}. ` +
        `Grant access to ${assets.length === 1 ? "that asset" : "those assets"} in Business Managers, then relaunch.`,
    };
  }

  return { appMode, permission };
}
