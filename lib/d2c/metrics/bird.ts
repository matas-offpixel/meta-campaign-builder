/**
 * lib/d2c/metrics/bird.ts
 *
 * Bird broadcast delivery metrics → normalised D2CSendMetrics (Goal 4).
 *
 * Shape sourced from a REAL live capture of a fired broadcast (see
 * .scratch/bird-broadcast-metrics-capture.txt, per
 * feedback_devtools_capture_lands_first + project_bird_uses_flat_shape_not_meta):
 *
 *   GET /workspaces/{wid}/campaigns/{cid}/broadcasts/{bid}?expand=counters
 *   → { counters: {
 *         campaign:   { total, dispatched, dispatchFailed, skipped },
 *         recipients: { total, reachable, subscribed, ... }
 *       } }
 *
 * SPEC CORRECTION: Bird exposes DELIVERY metrics only. There is no opens /
 * clicks / read / button-tap surface on the broadcast API (no /statistics
 * endpoint — returns 422). So opens/clicks are always null for Bird.
 *
 * Relative imports only (testable seam).
 */

import { birdJson } from "../bird/client.ts";
import type { D2CSendMetrics } from "./types.ts";

export interface BirdBroadcastCounters {
  counters?: {
    campaign?: {
      total?: number;
      dispatched?: number;
      dispatchFailed?: number;
      skipped?: number;
    };
    recipients?: { total?: number; reachable?: number; subscribed?: number };
  };
}

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Map a raw Bird broadcast (with counters) into normalised metrics. Pure. */
export function mapBirdBroadcast(
  broadcast: BirdBroadcastCounters,
  nowIso: string,
): D2CSendMetrics {
  const c = broadcast.counters?.campaign ?? {};
  const attempted = n(c.total);
  const failed = n(c.dispatchFailed);
  return {
    fetched_at: nowIso,
    provider: "bird",
    attempted,
    delivered: n(c.dispatched),
    // Engagement is not available on Bird's broadcast API — explicitly null.
    opens: null,
    clicks: null,
    bounces: failed,
    unsubscribes: null,
    raw: broadcast,
  };
}

/**
 * Fetch a Bird broadcast's delivery counters and normalise them. Requires the
 * campaign id + broadcast id (both persisted on d2c_scheduled_sends). Uses
 * `?expand=counters` so recipients.total hydrates (the base GET returns 0).
 */
export async function fetchBirdMetrics(
  apiKey: string,
  workspaceId: string,
  campaignId: string,
  broadcastId: string,
  opts?: { nowIso?: string },
): Promise<D2CSendMetrics> {
  const broadcast = await birdJson<BirdBroadcastCounters>(
    apiKey,
    `/workspaces/${workspaceId}/campaigns/${campaignId}/broadcasts/${broadcastId}?expand=counters`,
    { method: "GET" },
  );
  return mapBirdBroadcast(broadcast, opts?.nowIso ?? new Date().toISOString());
}
