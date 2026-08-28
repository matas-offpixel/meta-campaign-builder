/**
 * lib/meta/rate-limit-ui.ts
 *
 * Structured rate-limit state for the launch-failed dialog, Review
 * pre-launch warning, and retry cooldown. Pure — no Graph client.
 *
 * Inventory of launch-path rate-limit shapes (task #100):
 *
 *   code 4            — Application request limit reached. Often the
 *                       envelope when the *account* BUC is exhausted;
 *                       X-Business-Use-Case-Usage names the real bucket.
 *   code 4 + sub 80004
 *   code 80004        — Ad-account request limit.
 *   code 17           — User request limit reached.
 *   code 32           — Page request limit.
 *   code 341          — App-level cap (alt code on some edges).
 *   code 613          — Custom audiences / ads rate limit.
 *   subcode 2446079   — Accompanies user/app quota errors.
 *
 * Historically /debug_token #4 was mapped to "session expired / reconnect"
 * (project_auth_error_masks_rate_limit). classifyLaunchMetaCode already
 * splits rate_limit vs auth; this module builds the named UI state so
 * the dialog never says "few minutes" when Meta sent an ETA, and never
 * says reconnect for #4/#17/#80004.
 */

import {
  formatBusinessUseCaseLimitMessage,
  pickAdsManagementBucket,
  resumeAtIsoFromEtaMinutes,
  type BusinessUseCaseBucket,
  type BusinessUseCaseSnapshot,
} from "./app-usage.ts";

export const META_LAUNCH_RATE_LIMIT_CODES: ReadonlySet<number> = new Set([
  4, 17, 32, 341, 613, 80004,
]);

export const META_LAUNCH_RATE_LIMIT_SUBCODES: ReadonlySet<number> = new Set([
  80004, 2446079,
]);

export type RateLimitUiKind = "business_use_case" | "app" | "user" | "ad_account" | "page";

export interface RateLimitUiState {
  kind: RateLimitUiKind;
  bucket?: string;
  adAccountId?: string;
  accountLabel?: string;
  percent?: number;
  estimatedTimeToRegainAccessMinutes: number | null;
  resumeAt: string | null;
  code?: number;
  subcode?: number;
  message: string;
}

export function isMetaRateLimitCode(
  code: number | undefined | null,
  subcode?: number | null,
): boolean {
  if (typeof subcode === "number" && META_LAUNCH_RATE_LIMIT_SUBCODES.has(subcode)) {
    return true;
  }
  return typeof code === "number" && META_LAUNCH_RATE_LIMIT_CODES.has(code);
}

export function classifyRateLimitShape(
  code: number | undefined | null,
  subcode?: number | null,
): RateLimitUiKind {
  if (subcode === 80004 || code === 80004) return "ad_account";
  if (code === 17) return "user";
  if (code === 32) return "page";
  if (code === 613) return "ad_account";
  if (code === 4 || code === 341) return "app";
  if (subcode === 2446079) return "app";
  return "app";
}

export function remainingCooldownMs(
  resumeAt: string | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (!resumeAt) return 0;
  const t = Date.parse(resumeAt);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, t - nowMs);
}

export function formatCooldownLabel(remainingMs: number): string {
  const totalSec = Math.ceil(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min <= 0) return `${sec}s`;
  return `${min}m ${String(sec).padStart(2, "0")}s`;
}

export function buildRateLimitUiState(input: {
  code?: number | null;
  subcode?: number | null;
  buc?: BusinessUseCaseSnapshot | null;
  adAccountId?: string | null;
  accountLabel?: string | null;
  nowMs?: number;
}): RateLimitUiState {
  const bucket = pickAdsManagementBucket(input.buc ?? null, input.adAccountId);
  if (bucket) {
    return uiStateFromBucket(bucket, input);
  }
  const kind = classifyRateLimitShape(input.code, input.subcode);
  const code = typeof input.code === "number" ? input.code : undefined;
  return {
    kind,
    adAccountId: input.adAccountId ? normalizeAct(input.adAccountId) : undefined,
    accountLabel: input.accountLabel ?? undefined,
    estimatedTimeToRegainAccessMinutes: null,
    resumeAt: null,
    code,
    subcode: typeof input.subcode === "number" ? input.subcode : undefined,
    message: fallbackRateLimitMessage(kind, code),
  };
}

export function uiStateFromBucket(
  bucket: BusinessUseCaseBucket,
  input: {
    code?: number | null;
    subcode?: number | null;
    adAccountId?: string | null;
    accountLabel?: string | null;
    nowMs?: number;
  },
): RateLimitUiState {
  const eta = bucket.estimatedTimeToRegainAccessMinutes;
  return {
    kind: "business_use_case",
    bucket: bucket.type,
    adAccountId: bucket.adAccountId,
    accountLabel: input.accountLabel ?? undefined,
    percent: bucket.maxPercent,
    estimatedTimeToRegainAccessMinutes: eta,
    resumeAt: resumeAtIsoFromEtaMinutes(eta, input.nowMs),
    code: typeof input.code === "number" ? input.code : undefined,
    subcode: typeof input.subcode === "number" ? input.subcode : undefined,
    message: formatBusinessUseCaseLimitMessage(bucket, input.accountLabel),
  };
}

function fallbackRateLimitMessage(kind: RateLimitUiKind, code?: number): string {
  const tag = code != null ? ` (#${code})` : "";
  switch (kind) {
    case "user":
      return `Meta user request limit reached${tag} — wait for the window to reset, then retry. Do not reconnect Facebook.`;
    case "ad_account":
      return `Meta ad-account request limit reached${tag} — wait for the window to reset, then retry.`;
    case "page":
      return `Meta page request limit reached${tag} — wait for the window to reset, then retry.`;
    default:
      return `Meta rate limit reached${tag} — this is temporary; retry after the window resets.`;
  }
}

function normalizeAct(id: string): string {
  const t = id.trim();
  return t.startsWith("act_") ? t : `act_${t}`;
}

export const BUC_COOLDOWN_STORAGE_PREFIX = "meta-buc-cooldown:";

export function bucCooldownStorageKey(adAccountId: string): string {
  return `${BUC_COOLDOWN_STORAGE_PREFIX}${normalizeAct(adAccountId)}`;
}

export function writeBucCooldown(
  storage: Pick<Storage, "setItem">,
  adAccountId: string,
  resumeAt: string,
): void {
  storage.setItem(bucCooldownStorageKey(adAccountId), resumeAt);
}

export function readBucCooldown(
  storage: Pick<Storage, "getItem">,
  adAccountId: string,
  nowMs: number = Date.now(),
): { resumeAt: string; remainingMs: number } | null {
  const raw = storage.getItem(bucCooldownStorageKey(adAccountId));
  if (!raw) return null;
  const remainingMs = remainingCooldownMs(raw, nowMs);
  if (remainingMs <= 0) return null;
  return { resumeAt: raw, remainingMs };
}
