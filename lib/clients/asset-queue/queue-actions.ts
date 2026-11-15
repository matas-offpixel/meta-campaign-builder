import type { AssetQueueStatus } from "../../db/asset-queue.ts";

/**
 * Operator retry / requeue for a client_asset_queue row.
 *
 * The table does not store the status a row had before `error`. Retry infers
 * it from columns that already exist:
 *   - resolved_event_codes_multi → prepare had an umbrella row (matched_umbrella)
 *   - dropbox_url, unless the error is no_venue_mapping → prepare failed after
 *     a venue match (matched). Scrape inserts no_venue_mapping as error; those
 *     rows were never matched.
 *   - otherwise pending (and prepare is not re-run)
 */

export interface QueueActionSnapshot {
  status: AssetQueueStatus;
  error_message: string | null;
  dropbox_url: string | null;
  resolved_event_codes_multi: string[] | null;
}

export interface QueueActionDecision {
  /** 409 when the action is not allowed from the current status. */
  statusCode: 200 | 409;
  /** Null when the action is rejected — the row must not change. */
  nextStatus: AssetQueueStatus | null;
  clearError: boolean;
  clearOverrides: boolean;
  /** Call the existing prepare POST after the status update. */
  rerunPrepare: boolean;
}

const REJECTED: QueueActionDecision = {
  statusCode: 409,
  nextStatus: null,
  clearError: false,
  clearOverrides: false,
  rerunPrepare: false,
};

function hasUmbrellaCodes(codes: string[] | null): boolean {
  return Array.isArray(codes) && codes.length > 0;
}

function hasDropboxUrl(url: string | null): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

export function decideQueueAction(
  row: QueueActionSnapshot,
  action: "retry" | "requeue",
): QueueActionDecision {
  if (action === "retry") {
    if (row.status !== "error") return REJECTED;

    let nextStatus: AssetQueueStatus;
    if (hasUmbrellaCodes(row.resolved_event_codes_multi)) {
      nextStatus = "matched_umbrella";
    } else if (hasDropboxUrl(row.dropbox_url) && row.error_message !== "no_venue_mapping") {
      nextStatus = "matched";
    } else {
      nextStatus = "pending";
    }

    return {
      statusCode: 200,
      nextStatus,
      clearError: true,
      clearOverrides: false,
      rerunPrepare: nextStatus === "matched" || nextStatus === "matched_umbrella",
    };
  }

  if (row.status !== "skipped") return REJECTED;

  return {
    statusCode: 200,
    nextStatus: "pending",
    clearError: false,
    clearOverrides: true,
    rerunPrepare: false,
  };
}

/** Apply a decision to a row. A 409 decision returns the same row. */
export function projectQueueAction<
  T extends QueueActionSnapshot & { confirmed_overrides: Record<string, unknown> | null },
>(row: T, decision: QueueActionDecision): T {
  if (decision.statusCode !== 200 || decision.nextStatus == null) return row;
  return {
    ...row,
    status: decision.nextStatus,
    error_message: decision.clearError ? null : row.error_message,
    confirmed_overrides: decision.clearOverrides ? null : row.confirmed_overrides,
  };
}
