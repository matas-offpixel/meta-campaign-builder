/**
 * The gated campaign status write: turn one live Meta campaign on or off.
 *
 * POST /{campaign_id} { status }. Nothing else on the campaign changes. The
 * connector's pause / resume on a campaign (M3b) is its caller. It mirrors
 * lib/meta/adset-status-write.ts and sits behind the same switch:
 * OFFPIXEL_META_ADSET_STATUS_WRITES_ENABLED must be exactly "true" (a
 * campaign's status starts or stops every ad set in it). Every write is
 * recorded on meta_write_idempotency as `campaign_status_update` with
 * `{ required: true }`: no ledger row, no POST.
 *
 * The Graph call is passed in, so tests run on fakes.
 */

import { adsetStatusWritesEnabled, AdSetStatusWritesDisabledError } from "./adset-status-write.ts";
import { withMetaWriteIdempotency, type MetaWriteContext } from "./write-idempotency.ts";

/** DELETED: Today's Undo of a paused campaign the connector launched (the MCP's Today Undo). */
export type CampaignStatus = "PAUSED" | "ACTIVE" | "DELETED";

export type CampaignStatusGraph = {
  /** POST /{campaignId} { status }. Single shot: never retried here. */
  postCampaignStatus(campaignId: string, status: CampaignStatus): Promise<void>;
};

/** Set one campaign's status through the ledger. A success already on the ledger for this campaign, status and key returns without a POST. */
export async function writeCampaignStatus(args: {
  env?: Record<string, string | undefined>;
  ledger: MetaWriteContext;
  graph: CampaignStatusGraph;
  campaignId: string;
  status: CampaignStatus;
  key?: string;
}): Promise<string> {
  if (!adsetStatusWritesEnabled(args.env ?? process.env)) throw new AdSetStatusWritesDisabledError();
  if (!/^\d+$/.test(args.campaignId)) throw new Error(`not a Meta campaign id: ${args.campaignId}`);
  return withMetaWriteIdempotency(
    args.ledger,
    "campaign_status_update",
    { campaign_id: args.campaignId, status: args.status, key: args.key ?? null },
    async () => {
      await args.graph.postCampaignStatus(args.campaignId, args.status);
      return args.campaignId;
    },
    { required: true },
  );
}
