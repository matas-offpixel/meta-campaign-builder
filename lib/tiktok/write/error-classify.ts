/**
 * lib/tiktok/write/error-classify.ts
 *
 * Maps TikTok Business API error codes to readable launch messages,
 * same shape as lib/meta/launch-error-classify.ts.
 */

export type TikTokLaunchErrorKind = "rate_limit" | "auth" | "other";

export interface TikTokLaunchErrorMapping {
  kind: TikTokLaunchErrorKind;
  message: string;
  status: number;
}

const RATE_LIMIT_CODES = new Set([40100, 40101, 50001]);
const AUTH_CODES = new Set([40001, 40002, 40105]);

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
}): TikTokLaunchErrorMapping {
  const kind = classifyTikTokLaunchCode(input.code);
  const requestSuffix = input.requestId ? ` (request_id ${input.requestId})` : "";
  const raw = input.message?.trim() || "TikTok write failed";

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
