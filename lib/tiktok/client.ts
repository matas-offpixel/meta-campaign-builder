const TIKTOK_BASE = "https://business-api.tiktok.com/open_api/v1.3";

/**
 * TikTok's reporting API has a much lower practical burst tolerance than
 * Meta. Keep chunk fan-out serial until we have production evidence that a
 * higher value is safe for the connected advertiser accounts.
 */
export const TIKTOK_CHUNK_CONCURRENCY = 1;

const MAX_ATTEMPTS = 3;
const RATE_LIMIT_CODE = 50001;
const RATE_LIMIT_DELAY_MS = 10_000;
const TRANSIENT_BACKOFFS_MS = [750, 2_000];

export class TikTokApiError extends Error {
  readonly code?: number;
  readonly requestId?: string;
  readonly httpStatus?: number;

  constructor(
    message: string,
    code?: number,
    requestId?: string,
    httpStatus?: number,
  ) {
    super(message);
    this.name = "TikTokApiError";
    this.code = code;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
  }
}

export type TikTokRetryKind = "rate_limit" | "transient" | "none";

export interface TikTokRetryDecision {
  kind: TikTokRetryKind;
  retry: boolean;
  delayMs: number;
}

export function classifyTikTokRetry(input: {
  httpStatus: number;
  code?: number;
  attempt: number;
}): TikTokRetryDecision {
  if (input.code === RATE_LIMIT_CODE) {
    return {
      kind: "rate_limit",
      retry: input.attempt === 0,
      delayMs: RATE_LIMIT_DELAY_MS,
    };
  }
  if (input.httpStatus >= 500 && input.httpStatus <= 599) {
    return {
      kind: "transient",
      retry: input.attempt < MAX_ATTEMPTS - 1,
      delayMs: TRANSIENT_BACKOFFS_MS[input.attempt] ?? 2_000,
    };
  }
  return { kind: "none", retry: false, delayMs: 0 };
}

interface TikTokApiEnvelope<T> {
  code?: number;
  message?: string;
  msg?: string;
  request_id?: string;
  data?: T;
}

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | string[]
  | Record<string, unknown>;

export async function tiktokGet<T>(
  path: string,
  params: Record<string, QueryValue>,
  token: string,
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), `${TIKTOK_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    url.searchParams.set(
      key,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  }

  let lastError: TikTokApiError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: { "Access-Token": token },
        cache: "no-store",
      });
    } catch (err) {
      lastError = new TikTokApiError(
        `Network error calling TikTok Business API: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (attempt >= MAX_ATTEMPTS - 1) throw lastError;
      await sleep(TRANSIENT_BACKOFFS_MS[attempt] ?? 2_000);
      continue;
    }

    const raw = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const envelope = raw as TikTokApiEnvelope<T>;
    const code = typeof envelope.code === "number" ? envelope.code : undefined;
    const requestId =
      typeof envelope.request_id === "string" ? envelope.request_id : undefined;

    if (response.ok && (code == null || code === 0)) {
      return (envelope.data ?? raw) as T;
    }

    const message =
      typeof envelope.message === "string"
        ? envelope.message
        : typeof envelope.msg === "string"
          ? envelope.msg
          : `HTTP ${response.status}`;
    lastError = new TikTokApiError(message, code, requestId, response.status);

    const decision = classifyTikTokRetry({
      httpStatus: response.status,
      code,
      attempt,
    });
    if (!decision.retry) throw lastError;
    console.warn(
      `[tiktokGet] retry ${attempt + 1}/${MAX_ATTEMPTS - 1} after ${decision.delayMs}ms: ${path} (reason: ${decision.kind})`,
    );
    await sleep(decision.delayMs);
  }

  throw lastError ?? new TikTokApiError("TikTok Business API request failed.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
