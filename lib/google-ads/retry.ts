export type GoogleAdsRetryKind = "rate_limit" | "transient" | "auth" | "none";

export interface GoogleAdsRetryDecision {
  kind: GoogleAdsRetryKind;
  retry: boolean;
  delayMs: number;
}

const MAX_ATTEMPTS = 5;
const RATE_LIMIT_DELAY_MS = 10_000;
const TRANSIENT_BACKOFFS_MS = [500, 1_500, 4_000, 8_000];

export function classifyGoogleAdsRetry(input: {
  error: unknown;
  attempt: number;
}): GoogleAdsRetryDecision {
  const parsed = parseGoogleAdsError(input.error);
  if (isAuthError(parsed)) return { kind: "auth", retry: false, delayMs: 0 };
  if (isRateLimitError(parsed)) {
    return {
      kind: "rate_limit",
      retry: input.attempt === 0,
      delayMs: RATE_LIMIT_DELAY_MS,
    };
  }
  if (isTransientError(parsed)) {
    return {
      kind: "transient",
      retry: input.attempt < MAX_ATTEMPTS - 1,
      delayMs: TRANSIENT_BACKOFFS_MS[input.attempt] ?? 8_000,
    };
  }
  return { kind: "none", retry: false, delayMs: 0 };
}

export function parseGoogleAdsError(error: unknown): {
  code?: number | string;
  status?: string;
  httpStatus?: number;
  message: string;
} {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const response =
    record.response && typeof record.response === "object"
      ? (record.response as Record<string, unknown>)
      : {};
  const data =
    response.data && typeof response.data === "object"
      ? (response.data as Record<string, unknown>)
      : {};
  const nestedError =
    data.error && typeof data.error === "object"
      ? (data.error as Record<string, unknown>)
      : {};
  const metadata =
    record.metadata && typeof record.metadata === "object"
      ? (record.metadata as Record<string, unknown>)
      : {};

  return {
    code: valueAsCode(record.code) ?? valueAsCode(nestedError.code),
    status:
      valueAsString(record.status) ??
      valueAsString(nestedError.status) ??
      valueAsString(metadata.status),
    httpStatus:
      valueAsNumber(response.status) ??
      valueAsNumber(record.httpStatus) ??
      valueAsNumber(record.statusCode),
    message:
      valueAsString(record.message) ??
      valueAsString(nestedError.message) ??
      "Google Ads API request failed.",
  };
}

function isRateLimitError(error: ReturnType<typeof parseGoogleAdsError>): boolean {
  return error.status === "RESOURCE_EXHAUSTED" || error.code === 8 || error.httpStatus === 429;
}

function isAuthError(error: ReturnType<typeof parseGoogleAdsError>): boolean {
  return (
    error.status === "UNAUTHENTICATED" ||
    error.status === "PERMISSION_DENIED" ||
    error.code === 16 ||
    error.code === 7 ||
    error.httpStatus === 401 ||
    error.httpStatus === 403
  );
}

function isTransientError(error: ReturnType<typeof parseGoogleAdsError>): boolean {
  return (
    error.status === "UNAVAILABLE" ||
    error.status === "DEADLINE_EXCEEDED" ||
    error.code === 14 ||
    error.code === 4 ||
    (error.httpStatus != null && error.httpStatus >= 500 && error.httpStatus <= 599)
  );
}

function valueAsCode(value: unknown): number | string | undefined {
  if (typeof value === "number" || typeof value === "string") return value;
  return undefined;
}

function valueAsNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function valueAsString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
