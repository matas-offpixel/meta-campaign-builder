/**
 * lib/d2c/bird/client.ts
 *
 * Bird.com API fetch helper. Mirrors the Mailchimp client shape:
 *   - Basic auth header `Authorization: AccessKey ${apiKey}` (Bird keys are
 *     long-lived workspace API keys — no token refresh).
 *   - 20s timeout via AbortController.
 *   - Single retry on 5xx with a 2s delay.
 *
 * All Bird traffic MUST go through here so timeout / retry / error shaping is
 * consistent (constraint from the orchestration sprint).
 */

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 2_000;
const BIRD_API_BASE = process.env.BIRD_API_BASE?.trim() || "https://api.bird.com";

export class BirdHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Bird HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "BirdHttpError";
    this.status = status;
    this.body = body;
  }
}

export function isBirdAuthErrorStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function buildUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BIRD_API_BASE}${p}`;
}

export async function birdFetch(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = buildUrl(path);
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `AccessKey ${apiKey}`);

  const run = async (): Promise<Response> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, headers, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };

  let res = await run();
  if (res.status >= 500 && res.status < 600) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    res = await run();
  }
  return res;
}

export async function birdJson<T>(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await birdFetch(apiKey, path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new BirdHttpError(res.status, text);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BirdHttpError(res.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}
