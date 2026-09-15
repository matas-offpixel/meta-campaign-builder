/**
 * lib/cirqlin/client.ts
 *
 * One function. Bearer from `CIRQLIN_PARTNER_READ_SECRET`, base from
 * `CIRQLIN_API_BASE` (default https://app.cirqlin.com). Counts only.
 */

import type { CirqlinFetchResult, CirqlinSignupsPayload } from "./types.ts";

export const CIRQLIN_DEFAULT_API_BASE = "https://app.cirqlin.com";

/** A Cirqlin that accepts the socket and never responds must not hang the cron. */
export const CIRQLIN_FETCH_TIMEOUT_MS = 8_000;

function partnerUrl(base: string, tag: string): string {
  const url = new URL("/api/partner/signups", base);
  url.searchParams.set("tag", tag);
  return url.toString();
}

function isDailyRow(value: unknown): boolean {
  if (value == null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  if (typeof row.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.day)) {
    return false;
  }
  return Number.isFinite(row.signups);
}

export function isCirqlinSignupsPayload(
  value: unknown,
): value is CirqlinSignupsPayload {
  if (value == null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.ok !== true) return false;
  if (typeof v.tag !== "string") return false;
  if (v.page == null || typeof v.page !== "object") return false;
  if (v.totals == null || typeof v.totals !== "object") return false;
  const totals = v.totals as Record<string, unknown>;
  if (!Number.isFinite(totals.counted)) return false;
  if (!Array.isArray(v.daily)) return false;
  return v.daily.every(isDailyRow);
}

/**
 * Fetch Cirqlin's counted signups for one CRM tag.
 *
 * Never throws — a down partner, a missing secret, or a tag with no
 * page all come back as `{ ok: false, reason }` so the Mailchimp leg
 * of a refresh can keep writing.
 */
export async function fetchCirqlinSignupsByTag(
  tag: string,
  opts?: {
    base?: string;
    secret?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<CirqlinFetchResult> {
  const trimmed = tag.trim();
  if (!trimmed) {
    return { ok: false, reason: "no_page", message: "empty tag" };
  }

  const secret = (opts?.secret ?? process.env.CIRQLIN_PARTNER_READ_SECRET ?? "").trim();
  if (!secret) {
    return { ok: false, reason: "not_configured" };
  }

  const base = (
    opts?.base ??
    process.env.CIRQLIN_API_BASE ??
    CIRQLIN_DEFAULT_API_BASE
  ).replace(/\/+$/, "");
  const fetchImpl = opts?.fetchImpl ?? fetch;

  const timeoutMs = opts?.timeoutMs ?? CIRQLIN_FETCH_TIMEOUT_MS;
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    const request = fetchImpl(partnerUrl(base, trimmed), {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal,
    });
    const abort = new Promise<never>((_, reject) => {
      const fail = () => {
        reject(
          signal.reason ??
            new DOMException("Cirqlin fetch timed out", "TimeoutError"),
        );
      };
      if (signal.aborted) {
        fail();
        return;
      }
      signal.addEventListener("abort", fail, { once: true });
    });
    abort.catch(() => {
      /* race loser — do not surface as unhandled after a successful read */
    });
    res = await Promise.race([request, abort]);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const timedOut =
      name === "TimeoutError" ||
      name === "AbortError" ||
      (err instanceof Error && /timed? ?out|aborted/i.test(err.message));
    return {
      ok: false,
      reason: "error",
      message: timedOut
        ? "Cirqlin fetch timed out"
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }

  if (res.status === 401) {
    return { ok: false, reason: "unauthorized", status: 401 };
  }
  if (res.status === 404) {
    return { ok: false, reason: "no_page", status: 404 };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      ok: false,
      reason: "error",
      status: res.status,
      message: "response was not JSON",
    };
  }

  if (res.ok && isCirqlinSignupsPayload(body)) {
    return { ok: true, payload: body };
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (res.status === 200 && record?.ok === false) {
    return {
      ok: false,
      reason: "no_page",
      status: 200,
      message: typeof record.error === "string" ? record.error : "no page for tag",
    };
  }

  return {
    ok: false,
    reason: "error",
    status: res.status,
    message:
      record && typeof record.error === "string"
        ? record.error
        : `unexpected status ${res.status}`,
  };
}
