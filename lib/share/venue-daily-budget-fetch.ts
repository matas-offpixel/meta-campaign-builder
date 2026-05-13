/**
 * Per-venue Meta daily-budget fetcher with defensive JSON parsing.
 *
 * Vercel/CDN error pages (504 gateway timeouts, 502 bad gateway, etc.) return
 * HTML — not JSON. Calling `res.json()` directly on those bodies throws
 * `Unexpected token '<', "<!DOCTYPE"... is not valid JSON`, which surfaces to
 * users as the raw parse error. We read the body as text, try JSON.parse, and
 * fall back to a friendly "Service temporarily unavailable" label on failure.
 * Mirrors the pattern in `lib/audiences/source-picker-fetch.ts` (PR #356).
 */

export const DAILY_BUDGET_UPDATED_EVENT = "venue-daily-budget:updated";

export interface DailyBudgetUpdateDetail {
  clientId: string;
  eventCode: string;
  dailyBudget: number | null;
  label: "daily" | "effective_daily";
  reason: string | null;
  reasonLabel: string | null;
}

interface DailyBudgetApiResponse {
  dailyBudget?: number | null;
  label?: "daily" | "effective_daily";
  reason?: string | null;
  reasonLabel?: string | null;
  error?: string;
}

const dailyBudgetUpdates = new Map<string, DailyBudgetUpdateDetail>();

function updateKey(clientId: string, eventCode: string): string {
  return `${clientId}::${eventCode}`;
}

export function dispatchDailyBudgetUpdate(detail: DailyBudgetUpdateDetail) {
  dailyBudgetUpdates.set(updateKey(detail.clientId, detail.eventCode), detail);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<DailyBudgetUpdateDetail>(DAILY_BUDGET_UPDATED_EVENT, {
      detail,
    }),
  );
}

export function getDailyBudgetUpdate(
  clientId: string,
  eventCode: string,
): DailyBudgetUpdateDetail | null {
  return dailyBudgetUpdates.get(updateKey(clientId, eventCode)) ?? null;
}

export async function fetchVenueDailyBudgetDetail(opts: {
  clientId: string;
  eventCode: string;
  shareToken?: string;
}): Promise<DailyBudgetUpdateDetail> {
  let dispatched = false;
  try {
    const qs = new URLSearchParams();
    if (opts.shareToken) qs.set("client_token", opts.shareToken);
    const res = await fetch(
      `/api/clients/${encodeURIComponent(opts.clientId)}/venues/${encodeURIComponent(opts.eventCode)}/daily-budget${
        qs.size > 0 ? `?${qs.toString()}` : ""
      }`,
      { cache: "no-store" },
    );
    const text = await res.text();
    let json: DailyBudgetApiResponse = {};
    try {
      json = text ? (JSON.parse(text) as DailyBudgetApiResponse) : {};
    } catch {
      json = {
        error: `Daily budget API returned non-JSON (status ${res.status})`,
        reasonLabel: "Service temporarily unavailable",
      };
    }
    const reason =
      json.reasonLabel ?? json.error ?? "Daily budget unavailable";
    const detail: DailyBudgetUpdateDetail = {
      clientId: opts.clientId,
      eventCode: opts.eventCode,
      dailyBudget: json.dailyBudget ?? null,
      label: json.label ?? "daily",
      reason: json.reason ?? (res.ok ? null : "fetch_error"),
      reasonLabel: reason,
    };
    dispatchDailyBudgetUpdate(detail);
    dispatched = true;
    if (!res.ok) throw new Error(reason);
    return detail;
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Daily budget unavailable";
    if (!dispatched) {
      dispatchDailyBudgetUpdate({
        clientId: opts.clientId,
        eventCode: opts.eventCode,
        dailyBudget: null,
        label: "daily",
        reason: "fetch_error",
        reasonLabel: msg,
      });
    }
    throw err instanceof Error ? err : new Error(msg);
  }
}
