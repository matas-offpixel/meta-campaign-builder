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
