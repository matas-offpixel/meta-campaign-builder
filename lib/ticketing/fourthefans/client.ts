/**
 * lib/ticketing/fourthefans/client.ts
 *
 * Fetch wrapper for the 4TheFans native API. The shape of
 * `fourthefansGet` mirrors `eventbriteGet` so the provider implementation
 * is shaped identically across both adapters.
 *
 * The base URL is configurable via `FOURTHEFANS_API_BASE` so we can
 * point at a staging endpoint during integration without code changes.
 *
 * Auth: bearer token. v1 uses a per-client token pasted into client
 * settings (same pattern as Eventbrite); OAuth lands when 4TheFans
 * publish their app registration flow.
 */

export const DEFAULT_API_BASE =
  "https://4thefans.book.tickets/wp-json/agency/v1";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RETRIES = 3;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 60_000;

export class FourthefansApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly retryAfterMs: number | null;
  constructor(
    status: number,
    endpoint: string,
    message: string,
    retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "FourthefansApiError";
    this.status = status;
    this.endpoint = endpoint;
    this.retryAfterMs = retryAfterMs;
  }
}

interface FourthefansFetchOptions {
  query?: Record<string, string | number | string[] | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Per-call API base URL override. When provided, this takes precedence over
   * the `FOURTHEFANS_API_BASE` env var and `DEFAULT_API_BASE`. Use when a
   * single bearer token serves multiple WordPress/WooCommerce booking sites
   * (e.g. `wearefootballfestival.book.tickets` alongside the default
   * `4thefans.book.tickets`). Sourced from
   * `event_ticketing_links.external_api_base` (migration 083).
   */
  apiBase?: string | null;
}

function getBaseUrl(apiBaseOverride?: string | null): string {
  if (apiBaseOverride && apiBaseOverride.trim()) {
    const raw = apiBaseOverride.trim();
    return raw.endsWith("/") ? raw : `${raw}/`;
  }
  const envBase = process.env.FOURTHEFANS_API_BASE;
  const raw = envBase && envBase.trim() ? envBase.trim() : DEFAULT_API_BASE;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function buildUrl(
  endpoint: string,
  query?: FourthefansFetchOptions["query"],
  apiBase?: string | null,
): string {
  const trimmed = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const url = new URL(`${getBaseUrl(apiBase)}${trimmed}`);
  if (!query) return url.toString();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) url.searchParams.append(key, String(v));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

/**
 * GET a 4TheFans endpoint with bearer auth. Same contract as
 * `eventbriteGet`. Throws `FourthefansApiError` on non-2xx with the
 * response body's error message attached when available.
 *
 * Until the spec is finalised, callers will likely need to inspect the
 * raw payload — keep this routine generic; provider-level interpretation
 * happens in `provider.ts`.
 */
export async function fourthefansGet<T = unknown>(
  token: string,
  endpoint: string,
  options: FourthefansFetchOptions = {},
): Promise<T> {
  const url = buildUrl(endpoint, options.query, options.apiBase);
  let lastError: FourthefansApiError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      options.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      clearTimeout(timeout);
      const reason = err instanceof Error ? err.message : String(err);
      lastError = new FourthefansApiError(
        0,
        endpoint,
        `Network error: ${reason}`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt, null));
        continue;
      }
      throw lastError;
    }
    clearTimeout(timeout);

    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // Fall back to status text when the body isn't JSON.
      }
      const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
      const message =
        res.status === 429
          ? `Rate limit exceeded. Retry in ${Math.ceil((retryAfterMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS) / 1000)}s.`
          : (extractErrorMessage(body) ?? res.statusText);
      lastError = new FourthefansApiError(
        res.status,
        endpoint,
        message,
        retryAfterMs,
      );
      if (attempt < MAX_RETRIES && shouldRetry(res.status)) {
        await sleep(fourthefansRetryDelayMs(attempt, retryAfterMs, res.status));
        continue;
      }
      throw lastError;
    }

    return (await res.json()) as T;
  }

  throw lastError ?? new FourthefansApiError(0, endpoint, "Unknown error");
}

function shouldRetry(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(raw: string | null): number | null {
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return null;
}

function backoffMs(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null) return retryAfterMs;
  return 250 * 2 ** attempt;
}

export function fourthefansRetryDelayMs(
  attempt: number,
  retryAfterMs: number | null,
  status: number,
): number {
  if (retryAfterMs != null) return retryAfterMs;
  if (status === 429) return DEFAULT_RATE_LIMIT_BACKOFF_MS * 2 ** attempt;
  return backoffMs(attempt, null);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  for (const key of ["message", "error", "error_description", "detail"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}
