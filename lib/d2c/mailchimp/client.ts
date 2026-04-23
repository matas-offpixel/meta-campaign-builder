/**
 * Mailchimp Marketing API v3 fetch helper — Basic auth, timeout, one 5xx retry.
 */

const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 2_000;

export class MailchimpHttpError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Mailchimp HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "MailchimpHttpError";
    this.status = status;
    this.body = body;
  }
}

export function isMailchimpAuthErrorStatus(status: number): boolean {
  return status === 401 || status === 403;
}

function buildUrl(serverPrefix: string, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://${serverPrefix}.api.mailchimp.com${p}`;
}

export async function mailchimpFetch(
  serverPrefix: string,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = buildUrl(serverPrefix, path);
  const auth = Buffer.from(`anystring:${apiKey}`, "utf8").toString("base64");
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Basic ${auth}`);

  const run = async (): Promise<Response> => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        headers,
        signal: ctrl.signal,
      });
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

export async function mailchimpJson<T>(
  serverPrefix: string,
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await mailchimpFetch(serverPrefix, apiKey, path, init);
  const text = await res.text();
  if (!res.ok) {
    throw new MailchimpHttpError(res.status, text);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MailchimpHttpError(res.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}
