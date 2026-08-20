/**
 * lib/tiktok/write/error-classify.ts
 *
 * Maps TikTok Business API error codes to readable launch messages,
 * same shape as lib/meta/launch-error-classify.ts.
 */

import {
  isTikTokCampaignNameCollisionMessage,
  TIKTOK_CAMPAIGN_NAME_COLLISION_STEP,
  tikTokCampaignNameCollisionMessage,
} from "./campaign-names.ts";

export type TikTokLaunchErrorKind =
  | "rate_limit"
  | "auth"
  | "name_collision"
  | "other";

export interface TikTokLaunchErrorMapping {
  kind: TikTokLaunchErrorKind;
  message: string;
  status: number;
}

const RATE_LIMIT_CODES = new Set([40100, 40101, 50001]);
// 40002 is TikTok's generic parameter-validation error, not auth.
// Live 40002s: budget floors, identity mismatches, name collisions.
const AUTH_CODES = new Set([40001, 40105]);

export function classifyTikTokLaunchCode(
  code: number | undefined | null,
): TikTokLaunchErrorKind {
  if (typeof code !== "number") return "other";
  if (RATE_LIMIT_CODES.has(code)) return "rate_limit";
  if (AUTH_CODES.has(code)) return "auth";
  return "other";
}

export function mapTikTokLaunchError(input: {
  code?: number;
  message?: string;
  requestId?: string;
  campaignName?: string;
}): TikTokLaunchErrorMapping {
  const requestSuffix = input.requestId ? ` (request_id ${input.requestId})` : "";
  const raw = input.message?.trim() || "TikTok write failed";

  if (isTikTokCampaignNameCollisionMessage(input.message)) {
    const name = input.campaignName?.trim();
    return {
      kind: "name_collision",
      status: 400,
      message: `${
        name
          ? tikTokCampaignNameCollisionMessage(name)
          : `This campaign name is already used on this advertiser. ${TIKTOK_CAMPAIGN_NAME_COLLISION_STEP}. Keep the [EVENT_CODE] prefix — reporting uses it.`
      }${requestSuffix}`,
    };
  }

  const kind = classifyTikTokLaunchCode(input.code);

  if (kind === "rate_limit") {
    return {
      kind,
      status: 429,
      message: `TikTok rate limit (${input.code ?? "unknown"}): ${raw}${requestSuffix}`,
    };
  }
  if (kind === "auth") {
    return {
      kind,
      status: 401,
      message: `TikTok connection is invalid (${input.code ?? "unknown"}): ${raw}${requestSuffix}`,
    };
  }
  return {
    kind,
    status: 502,
    message: `TikTok error${input.code != null ? ` ${input.code}` : ""}: ${raw}${requestSuffix}`,
  };
}
