import { mapObjectiveToMeta } from "./campaign.ts";
import type { CampaignObjective } from "../types.ts";
import {
  hashMetaWritePayload,
  invalidateDeadCampaignLedger,
  withMetaWriteIdempotency,
  type MetaWriteContext,
} from "./write-idempotency.ts";

export type CampaignLedgerOutcome = "created" | "reused" | "recreated";

export interface StoredCampaign {
  id: string;
  name?: string;
  effective_status?: string | null;
  objective?: string | null;
}

const DEAD = new Set(["ARCHIVED", "DELETED"]);

export class CampaignLedgerObjectiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignLedgerObjectiveError";
  }
}

/**
 * The attach path's refusal, for a ledger hit whose live campaign no
 * longer has the objective this draft would create.
 */
export function campaignObjectiveChangedMessage(
  campaignName: string,
  draftObjective: string,
  liveObjective: string,
): string {
  return (
    `Campaign "${campaignName}" objective changed since you picked it ` +
    `(snapshot: "${draftObjective}", live: "${liveObjective}"). Re-open Step 1 and re-select.`
  );
}

/**
 * campaign_create ledger hit. A stored id is not a campaign we just
 * minted — re-fetch it. Archived, deleted, or missing rows are dropped
 * and the create runs. A live match is reused. A live objective change
 * is refused before any ad set is posted.
 */
export async function runCampaignCreateLedger(input: {
  context: MetaWriteContext | null;
  payload: unknown;
  draftObjective: CampaignObjective;
  campaignName: string;
  fetchCampaign: (id: string) => Promise<StoredCampaign | null>;
  create: () => Promise<string>;
}): Promise<{ id: string; outcome: CampaignLedgerOutcome }> {
  const hit = await lookupSuccess(input.context, input.payload);
  if (!hit) {
    const id = await withMetaWriteIdempotency(input.context, "campaign_create", input.payload, input.create);
    return { id, outcome: "created" };
  }

  const live = await input.fetchCampaign(hit.op_result_id);
  const status = live?.effective_status?.toUpperCase() ?? "";
  if (!live || DEAD.has(status)) {
    console.log(
      `[campaign-ledger] campaign_reused_dead → recreated id=${hit.op_result_id} status=${status || "not_found"}`,
    );
    if (input.context) {
      await invalidateDeadCampaignLedger(input.context, hit.id);
    }
    const id = await withMetaWriteIdempotency(input.context, "campaign_create", input.payload, input.create);
    return { id, outcome: "recreated" };
  }

  const expected = mapObjectiveToMeta(input.draftObjective);
  const actual = (live.objective ?? "").trim().toUpperCase();
  if (actual !== expected) {
    const liveInternal = actual || "unknown";
    throw new CampaignLedgerObjectiveError(
      campaignObjectiveChangedMessage(live.name?.trim() || input.campaignName, input.draftObjective, liveInternal),
    );
  }

  console.log(`[campaign-ledger] Campaign reused (ledger) ID ${hit.op_result_id}`);
  return { id: hit.op_result_id, outcome: "reused" };
}

async function lookupSuccess(
  context: MetaWriteContext | null,
  payload: unknown,
): Promise<{ id: string; op_result_id: string } | null> {
  if (!context?.draftId || !context.userId) return null;
  const payloadHash = hashMetaWritePayload(payload);
  const { data, error } = await context.supabase
    .from("meta_write_idempotency")
    .select("id,op_result_id,op_status")
    .eq("draft_id", context.draftId)
    .eq("op_kind", "campaign_create")
    .eq("op_payload_hash", payloadHash)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id?: string; op_result_id?: string | null; op_status?: string };
  if (row.op_status !== "success" || !row.op_result_id || !row.id) return null;
  return { id: row.id, op_result_id: row.op_result_id };
}
