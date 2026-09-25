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
 * The re-fetch failed and the stored id was not proven dead. The ledger
 * row stays. Phase 1 turns a rate-limit code into the existing 429 and
 * everything else into a 502.
 */
export class CampaignLedgerVerifyError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly source?: unknown;
  constructor(
    message: string,
    details?: { code?: number; subcode?: number; source?: unknown },
  ) {
    super(message);
    this.name = "CampaignLedgerVerifyError";
    this.code = details?.code;
    this.subcode = details?.subcode;
    this.source = details?.source;
  }
}

export type CampaignGoneReason = "not_found" | "not_found_or_no_permission";

export interface CampaignLedgerNotFound {
  notFound: true;
  reason?: CampaignGoneReason;
}

export interface CampaignLedgerFetchError {
  error: {
    message: string;
    code?: number;
    subcode?: number;
  };
  source?: unknown;
}

export type CampaignLedgerFetchResult =
  | StoredCampaign
  | CampaignLedgerNotFound
  | CampaignLedgerFetchError
  | null;

/**
 * Code 100 / subcode 33 is Meta's "does not exist, or this token cannot
 * see it". Code 803 is a missing object. A campaign the launch token
 * cannot read is one it cannot add ad sets to, so both are dead.
 */
export function campaignGoneReason(
  code: number | undefined,
  subcode: number | undefined,
): CampaignGoneReason | null {
  if (code === 100 && subcode === 33) return "not_found_or_no_permission";
  if (code === 803) return "not_found";
  return null;
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
 * minted — re-fetch it. ARCHIVED, DELETED, or a definite not-found
 * (code 100 / subcode 33, or code 803) drops the row and creates.
 * Any other re-fetch failure — rate limit, expired token, 5xx — fails
 * the launch and leaves the row in place. A live match is reused. A
 * live objective change is refused before any ad set is posted.
 */
export async function runCampaignCreateLedger(input: {
  context: MetaWriteContext | null;
  payload: unknown;
  draftObjective: CampaignObjective;
  campaignName: string;
  fetchCampaign: (id: string) => Promise<CampaignLedgerFetchResult>;
  create: () => Promise<string>;
}): Promise<{ id: string; outcome: CampaignLedgerOutcome }> {
  const hit = await lookupSuccess(input.context, input.payload);
  if (!hit) {
    const id = await withMetaWriteIdempotency(input.context, "campaign_create", input.payload, input.create);
    return { id, outcome: "created" };
  }

  const read = await readStoredCampaign(input.fetchCampaign, hit.op_result_id);
  if (read.kind === "unverified") {
    throw new CampaignLedgerVerifyError(
      `Failed to verify the stored campaign ${hit.op_result_id}: ${read.detail}. Retry the launch.`,
      { code: read.code, subcode: read.subcode, source: read.source },
    );
  }
  if (read.kind === "dead") {
    console.log(
      `[campaign-ledger] campaign_reused_dead → recreated id=${hit.op_result_id} status=${read.status}`,
    );
    if (input.context) {
      await invalidateDeadCampaignLedger(input.context, hit.id);
    }
    const id = await withMetaWriteIdempotency(input.context, "campaign_create", input.payload, input.create);
    return { id, outcome: "recreated" };
  }
  const live = read.campaign;

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

type StoredRead =
  | { kind: "live"; campaign: StoredCampaign }
  | { kind: "dead"; status: string }
  | {
      kind: "unverified";
      detail: string;
      code?: number;
      subcode?: number;
      source?: unknown;
    };

async function readStoredCampaign(
  fetchCampaign: (id: string) => Promise<CampaignLedgerFetchResult>,
  campaignId: string,
): Promise<StoredRead> {
  let fetched: CampaignLedgerFetchResult;
  try {
    fetched = await fetchCampaign(campaignId);
  } catch (err) {
    fetched = { error: readThrown(err), source: err };
  }

  if (isStoredCampaign(fetched)) {
    const status = fetched.effective_status?.toUpperCase() ?? "";
    if (DEAD.has(status)) return { kind: "dead", status };
    return { kind: "live", campaign: fetched };
  }
  if (fetched && "notFound" in fetched && fetched.notFound) {
    return { kind: "dead", status: fetched.reason ?? "not_found" };
  }
  if (fetched && "error" in fetched) {
    const gone = campaignGoneReason(fetched.error.code, fetched.error.subcode);
    if (gone) return { kind: "dead", status: gone };
    return {
      kind: "unverified",
      detail: fetched.error.message || "the re-fetch failed",
      code: fetched.error.code,
      subcode: fetched.error.subcode,
      source: fetched.source,
    };
  }
  return {
    kind: "unverified",
    detail: "the re-fetch returned no campaign",
  };
}

function isStoredCampaign(
  value: CampaignLedgerFetchResult,
): value is StoredCampaign {
  return !!value && typeof value === "object" && "id" in value && !("notFound" in value) && !("error" in value);
}

function readThrown(err: unknown): { message: string; code?: number; subcode?: number } {
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; code?: unknown; subcode?: unknown };
    return {
      message: typeof o.message === "string" && o.message ? o.message : "the re-fetch failed",
      code: typeof o.code === "number" ? o.code : undefined,
      subcode: typeof o.subcode === "number" ? o.subcode : undefined,
    };
  }
  return { message: err instanceof Error && err.message ? err.message : "the re-fetch failed" };
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
