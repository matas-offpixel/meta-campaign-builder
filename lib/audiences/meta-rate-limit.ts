/**
 * Duck-typed detection so tests can run under Node strip-types without loading
 * `lib/meta/client.ts` (MetaApiError uses TS parameter properties).
 */
export function isMetaAdAccountRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    name?: string;
    subcode?: number;
    code?: number;
    message?: string;
  };
  if (e.name !== "MetaApiError") return false;
  return (
    e.subcode === 80004 ||
    e.code === 80004 ||
    /\b80004\b/.test(String(e.message ?? ""))
  );
}

/** JSON body for audience source routes when Meta returns account rate-limit (#80004). */
export function audienceSourceRateLimitBody(): {
  error: "rate_limited";
  retryAfterMinutes: number;
  message: string;
} {
  return {
    error: "rate_limited",
    retryAfterMinutes: 30,
    message:
      "Meta is rate-limiting this ad account. Try again in ~30 minutes.",
  };
}
