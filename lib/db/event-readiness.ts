/**
 * lib/db/event-readiness.ts
 *
 * Pure (I/O-free) readiness classifier for the client rollout audit page
 * (`/clients/[id]/rollout`). Given an event plus its resolved ticketing
 * connections, ticketing links, and report share, return a traffic-light
 * status + a list of missing requirements the operator still needs to
 * fix before the per-event dashboard is production-ready.
 *
 * The rules encode the checklist in
 * `docs/CLIENT_DASHBOARD_BRIEF_2026-04-27.md §1.2`. Anything reading this
 * helper should treat the output as structural, not cosmetic — for
 * example, `missing` is what we surface in the row tooltip and in the
 * bulk-action "still to do" line.
 */
export type ReadinessStatus = "ready" | "partial" | "blocked";

export type ReadinessTicketingMode =
  | "eventbrite"
  | "fourthefans"
  | "manual"
  | "none";

export interface ReadinessInput {
  event: {
    id: string;
    name?: string | null;
    event_code: string | null;
    capacity: number | null;
    event_date: string | null;
    general_sale_at: string | null;
    kind?: string | null;
  };
  client: {
    meta_ad_account_id: string | null;
  };
  ticketingLinks: Array<{
    connection_id: string;
    external_event_id: string | null;
  }>;
  ticketingConnections: Array<{
    id: string;
    provider: string;
    status: string | null;
  }>;
  share: {
    token: string;
    can_edit: boolean;
    enabled: boolean;
    scope: string | null;
    event_id: string | null;
  } | null;
  /**
   * Milliseconds since epoch — injected so tests are deterministic.
   * Defaults to `Date.now()` at call time.
   */
  nowMs?: number;
}

export interface ReadinessResult {
  status: ReadinessStatus;
  /** Hard blockers (red) surfaced first in the tooltip. */
  missing: string[];
  /** Non-blocking notices (amber). */
  warnings: string[];
  hasShare: boolean;
  shareIsEditable: boolean;
  ticketingMode: ReadinessTicketingMode;
  /**
   * Validated event_code in bracket-friendly form — uppercase, no spaces,
   * only `A-Z0-9-_`. `null` when the raw code is missing or malformed.
   */
  normalizedEventCode: string | null;
  eventCodeOk: boolean;
}

/**
 * Loose upper-bound on how far in the past an event can be and still be
 * considered "current" for dashboard purposes. Matches the 30-day
 * lookback the brief cites; older events skip the date check (they're
 * out of scope for the rollout audit but still render in the table for
 * reference — they flip to blocked here so operators can spot them).
 */
export const STALE_EVENT_DAYS = 30;

const EVENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,63}$/;

/**
 * Returns the upper-cased event_code when it's bracket-friendly (letters,
 * digits, hyphens, underscores only; 2-64 chars). Returns `null` when the
 * input is missing / contains spaces / contains lowercase / contains any
 * character outside the safe set. Callers use the return value both to
 * decide whether to show the "fix event code" warning AND to compute the
 * `[event_code]` substring for Meta campaign names.
 */
export function normalizeEventCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed !== trimmed.toUpperCase()) return null;
  if (!EVENT_CODE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 86_400_000);
}

function pickTicketingMode(
  links: ReadinessInput["ticketingLinks"],
  connections: ReadinessInput["ticketingConnections"],
): ReadinessTicketingMode {
  if (!connections.length) return "none";
  const active = connections.filter(
    (c) => (c.status ?? "active") !== "error",
  );
  const primary = active[0] ?? connections[0];
  if (!primary) return "none";
  const providerRaw = primary.provider?.toLowerCase() ?? "";
  if (providerRaw === "eventbrite") {
    const link = links.find((l) => l.connection_id === primary.id);
    if (!link || !link.external_event_id) return "none";
    return "eventbrite";
  }
  if (providerRaw === "fourthefans") return "fourthefans";
  if (providerRaw === "manual") return "manual";
  return "none";
}

/**
 * Classify a single event against the rollout checklist. Pure function —
 * zero I/O. All preconditions must be resolved by the caller.
 *
 * Status rubric:
 *   - `blocked`  → at least one hard requirement is missing (event_code,
 *                  capacity, event_date, ticketing connection). Card can
 *                  render but the share dashboard will be incomplete.
 *   - `partial`  → the event has the hard requirements but at least one
 *                  rollout-critical item is missing (share link,
 *                  general_sale_at, meta_ad_account_id).
 *   - `ready`    → every checklist item is green; dashboard is ready to
 *                  hand to the client.
 */
export function computeEventReadiness(input: ReadinessInput): ReadinessResult {
  const missing: string[] = [];
  const warnings: string[] = [];

  const normalizedEventCode = normalizeEventCode(input.event.event_code);
  const eventCodeOk = normalizedEventCode !== null;
  if (!input.event.event_code?.trim()) {
    missing.push("event_code is empty");
  } else if (!eventCodeOk) {
    missing.push(
      "event_code is not bracket-friendly (uppercase, A-Z 0-9 - _)",
    );
  }

  const capacity = input.event.capacity;
  if (capacity == null || !Number.isFinite(capacity) || capacity <= 0) {
    missing.push("capacity is empty or not > 0");
  }

  if (!input.event.event_date) {
    missing.push("event_date is empty");
  } else {
    const ts = Date.parse(input.event.event_date);
    if (!Number.isFinite(ts)) {
      missing.push("event_date does not parse");
    } else {
      const now = input.nowMs ?? Date.now();
      const diff = daysBetween(ts, now);
      if (diff > STALE_EVENT_DAYS) {
        missing.push(
          `event_date is >${STALE_EVENT_DAYS}d in the past (${diff}d)`,
        );
      }
    }
  }

  if (!input.event.general_sale_at) {
    warnings.push("general_sale_at empty — presale bucket will be empty");
  }

  if (!input.client.meta_ad_account_id) {
    warnings.push(
      "client meta_ad_account_id is empty — ad spend won't populate",
    );
  }

  const ticketingMode = pickTicketingMode(
    input.ticketingLinks,
    input.ticketingConnections,
  );
  if (ticketingMode === "none") {
    missing.push(
      "no ticketing connection (Eventbrite / 4thefans / manual)",
    );
  } else if (ticketingMode === "fourthefans") {
    warnings.push(
      "4thefans ticketing — auto-sync awaits Russ's API; use manual entry",
    );
  }

  const hasShare = !!input.share && input.share.event_id === input.event.id;
  const shareEnabled = hasShare && !!input.share && input.share.enabled;
  const shareIsEditable =
    hasShare && !!input.share && input.share.can_edit && shareEnabled;
  if (!hasShare) {
    warnings.push("no report_shares row — share link not generated yet");
  } else if (!shareEnabled) {
    warnings.push("report_shares.enabled = false — share is disabled");
  } else if (!input.share?.can_edit) {
    warnings.push(
      "report_shares.can_edit = false — client can view but not edit",
    );
  }

  let status: ReadinessStatus;
  if (missing.length > 0) status = "blocked";
  else if (warnings.length > 0) status = "partial";
  else status = "ready";

  return {
    status,
    missing,
    warnings,
    hasShare,
    shareIsEditable,
    ticketingMode,
    normalizedEventCode,
    eventCodeOk,
  };
}
