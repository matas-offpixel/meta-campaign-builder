/**
 * The gated ad-set status write: turn one live Meta ad set on or off.
 *
 * POST /{adset_id} { status }. Nothing else on the ad set changes: its
 * budget, targeting, schedule and ads stay as they are. The on-sale
 * refresh's Bring back (a stopped ad set) and Drop lines are its callers
 * (docs/design-record/2026-11-12-on-sale-refresh.html, R4 / HR4, P3).
 *
 * Gate: OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED must be exactly "true".
 * Unset, or any other value, refuses before the ledger or Graph is
 * touched. Every write is recorded on meta_write_idempotency as
 * `adset_status_update` with `{ required: true }`: no ledger row, no POST.
 *
 * The Graph call is passed in, so this file does not import
 * lib/meta/client.ts and tests run on fakes. It mirrors
 * lib/meta/ad-status-write.ts.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

export const ADSET_STATUS_WRITES_ENV = "OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED";

export const ADSET_STATUS_WRITES_DISABLED_MESSAGE = "Turning ad sets on or off is switched off on this deployment.";

export type AdSetStatus = "PAUSED" | "ACTIVE";

export function adsetStatusWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[ADSET_STATUS_WRITES_ENV] === "true";
}

export class AdSetStatusWritesDisabledError extends Error {
  constructor() {
    super(ADSET_STATUS_WRITES_DISABLED_MESSAGE);
    this.name = "AdSetStatusWritesDisabledError";
  }
}

export type AdSetStatusGraph = {
  /** POST /{adsetId} { status }. Single shot: never retried here. */
  postAdSetStatus(adsetId: string, status: AdSetStatus): Promise<void>;
};

/**
 * Set one ad set's status through the ledger. A success already on the
 * ledger for this ad set, status and key returns without a POST (a double
 * click or a retry); a later, separate ask writes again. Returns the id.
 */
export async function writeAdSetStatus(args: {
  env?: Record<string, string | undefined>;
  ledger: MetaWriteContext;
  graph: AdSetStatusGraph;
  adsetId: string;
  status: AdSetStatus;
  /** What asked for the write (the refresh line id). */
  key?: string;
}): Promise<string> {
  if (!adsetStatusWritesEnabled(args.env ?? process.env)) throw new AdSetStatusWritesDisabledError();
  if (!/^\d+$/.test(args.adsetId)) throw new Error(`not a Meta ad set id: ${args.adsetId}`);
  return withMetaWriteIdempotency(
    args.ledger,
    "adset_status_update",
    { adset_id: args.adsetId, status: args.status, key: args.key ?? null },
    async () => {
      await args.graph.postAdSetStatus(args.adsetId, args.status);
      return args.adsetId;
    },
    { required: true },
  );
}
