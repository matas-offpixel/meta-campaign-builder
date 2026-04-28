/**
 * lib/ticketing/eventbrite/client.ts
 *
 * Thin fetch wrapper for the Eventbrite v3 REST API. The base URL is
 * fixed (Eventbrite has no per-region routing). Auth is bearer-token —
 * the v1 model is a personal OAuth token pasted into client settings.
 *
 * The wrapper deliberately exposes only `get` — Eventbrite reads are the
 * only operation the dashboard performs in v1 (no event creation, no
 * order updates). When write paths arrive, add them here.
 *
 * TODO (Apr 2026): the 4theFans Eventbrite personal token was
 * generated in a chat transcript during the session that built out
 * the manual connection. Rotate it via eventbrite.com → account →
 * developer → API user keys → rotate, then re-save through
 * `/clients/[id]/ticketing-connections` so the new token is
 * encrypted via `set_ticketing_credentials`. The stored token is
 * at-rest-encrypted (migration 038) but anything that ever lived in
 * a plaintext transcript should be considered compromised.
 */

const EVENTBRITE_API_BASE = "https://www.eventbriteapi.com/v3";

export class EventbriteApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  constructor(status: number, endpoint: string, message: string) {
    super(message);
    this.name = "EventbriteApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

interface EventbriteFetchOptions {
  /**
   * Query parameters appended to the URL. Values are stringified; arrays
   * land as repeated keys (Eventbrite supports this for `expand`).
   */
  query?: Record<string, string | number | string[] | undefined>;
  /**
   * Override the default fetch timeout. Eventbrite is normally fast
   * (<1s) so the default 8s catches outliers without blocking Next.
   */
  timeoutMs?: number;
  /**
   * AbortSignal forwarded to fetch. Honoured before the timeout.
   */
  signal?: AbortSignal;
}

function buildUrl(
  endpoint: string,
  query?: EventbriteFetchOptions["query"],
): string {
  const trimmed = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = new URL(`${EVENTBRITE_API_BASE}${trimmed}`);
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
 * GET an Eventbrite endpoint with bearer auth. Returns the parsed JSON
 * body on 2xx, throws `EventbriteApiError` on non-2xx with the response
 * body's `error_description` (or status text) attached.
 */
export async function eventbriteGet<T = unknown>(
  token: string,
  endpoint: string,
  options: EventbriteFetchOptions = {},
): Promise<T> {
  const url = buildUrl(endpoint, options.query);

  // Compose abort: external signal + internal timeout. AbortController
  // covers both — fetch aborts as soon as either fires.
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
      // Eventbrite responses must not be cached by the Next fetch cache —
      // ticket counts move minute-to-minute.
      cache: "no-store",
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason = err instanceof Error ? err.message : String(err);
    throw new EventbriteApiError(0, endpoint, `Network error: ${reason}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Eventbrite occasionally returns plain text (e.g. on 502s). Fall
      // back to status text if the body isn't JSON.
    }
    const description =
      (body && typeof body === "object" && "error_description" in body
        ? String((body as { error_description?: unknown }).error_description)
        : null) ?? res.statusText;
    throw new EventbriteApiError(res.status, endpoint, description);
  }

  return (await res.json()) as T;
}
