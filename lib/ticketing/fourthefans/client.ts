/**
 * lib/ticketing/fourthefans/client.ts
 *
 * Fetch wrapper for the 4TheFans native API. Their spec is not yet
 * published — every endpoint string and field name in this file is a
 * placeholder marked with TODO so a single editor pass replaces them
 * once docs land. The shape of `fourthefansGet` mirrors
 * `eventbriteGet` so the provider implementation is shaped identically
 * across both adapters.
 *
 * The base URL is configurable via `FOURTHEFANS_API_BASE` so we can
 * point at a staging endpoint during integration without code changes.
 *
 * Auth: bearer token. v1 uses a per-client token pasted into client
 * settings (same pattern as Eventbrite); OAuth lands when 4TheFans
 * publish their app registration flow.
 */

const DEFAULT_API_BASE = "https://api.4thefans.tv/";

export class FourthefansApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  constructor(status: number, endpoint: string, message: string) {
    super(message);
    this.name = "FourthefansApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

interface FourthefansFetchOptions {
  query?: Record<string, string | number | string[] | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function getBaseUrl(): string {
  const envBase = process.env.FOURTHEFANS_API_BASE;
  const raw = envBase && envBase.trim() ? envBase.trim() : DEFAULT_API_BASE;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

function buildUrl(
  endpoint: string,
  query?: FourthefansFetchOptions["query"],
): string {
  const trimmed = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
  const url = new URL(`${getBaseUrl()}${trimmed}`);
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
  const url = buildUrl(endpoint, options.query);

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 8000;
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
    throw new FourthefansApiError(0, endpoint, `Network error: ${reason}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // 4TheFans error envelope is TBD; fall back to status text when
      // the body isn't JSON.
    }
    const message =
      (body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message)
        : null) ?? res.statusText;
    throw new FourthefansApiError(res.status, endpoint, message);
  }

  return (await res.json()) as T;
}
