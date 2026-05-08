type MetaRateLimitScope = "user account" | "ad account" | "app";

function readMetaApiErrorShape(err: unknown): {
  isMetaApi: boolean;
  code?: number;
  subcode?: number;
  message: string;
} {
  if (!err || typeof err !== "object") {
    return { isMetaApi: false, message: "" };
  }
  const e = err as {
    name?: string;
    code?: number;
    subcode?: number;
    message?: string;
  };
  if (e.name !== "MetaApiError") {
    return { isMetaApi: false, message: "" };
  }
  return {
    isMetaApi: true,
    code: typeof e.code === "number" ? e.code : undefined,
    subcode: typeof e.subcode === "number" ? e.subcode : undefined,
    message: String(e.message ?? ""),
  };
}

/**
 * Meta rate limits surfaced as recoverable API errors:
 * - Per-ad-account (#80004 / subcode 80004)
 * - Per-user OAuth token (#17, "User request limit reached")
 * - Per-app (#4, "Application request limit reached")
 * - Subcode 2446079 may accompany user/app quota errors
 *
 * Name kept as `isMetaAdAccountRateLimitError` for historical imports — it now
 * signals any Meta quota-style rate limit we normalize for the audience UI.
 */
export function isMetaAdAccountRateLimitError(err: unknown): boolean {
  const { isMetaApi, code, subcode, message } = readMetaApiErrorShape(err);
  if (!isMetaApi) return false;
  const m = message.toLowerCase();
  return (
    subcode === 80004 ||
    code === 80004 ||
    /\b80004\b/.test(message) ||
    code === 17 ||
    code === 4 ||
    subcode === 2446079 ||
    m.includes("user request limit") ||
    m.includes("application request limit")
  );
}

function metaRateLimitScopeLabel(err: unknown): MetaRateLimitScope {
  const { code, subcode, message } = readMetaApiErrorShape(err);
  const m = message.toLowerCase();
  // Per-ad-account (#80004) — Meta often keeps code 4 alongside subcode 80004;
  // classify ad-account quota before treating bare code 4 as app-level.
  if (subcode === 80004 || code === 80004 || /\b80004\b/.test(message)) {
    return "ad account";
  }
  if (code === 17 || m.includes("user request limit")) return "user account";
  if (code === 4 || m.includes("application request limit")) return "app";
  if (subcode === 2446079) {
    if (m.includes("user request") || m.includes("user limit")) return "user account";
    if (m.includes("application request") || m.includes("application limit")) return "app";
  }
  return "ad account";
}

function coverGenericRateLimitBody(scope: MetaRateLimitScope): {
  error: "rate_limited";
  retryAfterMinutes: number;
  message: string;
} {
  return {
    error: "rate_limited",
    retryAfterMinutes: 45,
    message: `Meta is rate-limiting this ${scope}. Try again in ~30-60 minutes.`,
  };
}

export function audienceSourceRateLimitBody(err?: unknown): {
  error: "rate_limited";
  retryAfterMinutes: number;
  message: string;
} {
  const scope = err !== undefined ? metaRateLimitScopeLabel(err) : "ad account";
  return coverGenericRateLimitBody(scope);
}
