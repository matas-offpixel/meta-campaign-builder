/**
 * The gated ad-status write: pause (or resume) one live Meta ad.
 *
 * POST /{ad_id} { status }. Nothing else on the ad changes: its creative,
 * copy and ad set stay as they are. This is the only ad-status write in
 * the app; the on-sale refresh's Pause creative line is its first caller
 * (docs/design-record/2026-11-12-on-sale-refresh.html, R4 / HR4).
 *
 * Gate: OFFPIXEL_META_AD_STATUS_WRITES_ENABLED must be exactly "true".
 * Unset, or any other value, refuses before the ledger or Graph is
 * touched. Every write is recorded on meta_write_idempotency as
 * `ad_status_update` with `{ required: true }`: no ledger row, no POST.
 *
 * The Graph call is passed in, so this file does not import
 * lib/meta/client.ts and tests run on fakes.
 */

import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

export const AD_STATUS_WRITES_ENV = "OFFPIXEL_META_AD_STATUS_WRITES_ENABLED";

export const AD_STATUS_WRITES_DISABLED_MESSAGE = "Pausing ads is switched off on this deployment.";

export type AdStatus = "PAUSED" | "ACTIVE";

export function adStatusWritesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[AD_STATUS_WRITES_ENV] === "true";
}

export class AdStatusWritesDisabledError extends Error {
  constructor() {
    super(AD_STATUS_WRITES_DISABLED_MESSAGE);
    this.name = "AdStatusWritesDisabledError";
  }
}

export type AdStatusGraph = {
  /** POST /{adId} { status }. Single shot: never retried here. */
  post(adId: string, status: AdStatus): Promise<void>;
};

/**
 * Set one ad's status through the ledger. A success already on the ledger
 * for this ad, status and key returns without a POST (a double click or a
 * retry). Returns the ad id.
 */
export async function writeAdStatus(args: {
  env?: Record<string, string | undefined>;
  ledger: MetaWriteContext;
  graph: AdStatusGraph;
  adId: string;
  status: AdStatus;
  /**
   * What asked for the write (the refresh line id). A retry of the same ask
   * finds its success on the ledger; a later, separate ask writes again,
   * so an ad resumed by hand in Ads Manager is paused for real next time.
   */
  key?: string;
}): Promise<string> {
  if (!adStatusWritesEnabled(args.env ?? process.env)) throw new AdStatusWritesDisabledError();
  if (!/^\d+$/.test(args.adId)) throw new Error(`not a Meta ad id: ${args.adId}`);
  return withMetaWriteIdempotency(
    args.ledger,
    "ad_status_update",
    { ad_id: args.adId, status: args.status, key: args.key ?? null },
    async () => {
      await args.graph.post(args.adId, args.status);
      return args.adId;
    },
    { required: true },
  );
}
