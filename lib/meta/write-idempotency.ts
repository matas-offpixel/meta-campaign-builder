import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Meta write idempotency ledger — mirrors tiktok_write_idempotency
 * (migration 062 / lib/tiktok/write/idempotency.ts).
 *
 * Additive: if `meta_write_idempotency` is missing at runtime (migration
 * 156 not applied), or the ledger cannot be used for this draft (no
 * draft id, FK miss because the draft row is not persisted yet), the
 * write proceeds exactly as today. Named warn, never a silent drop.
 */

export type MetaWriteOpKind =
  | "campaign_create"
  | "adset_create"
  | "ad_create"
  | "creative_upload";

export interface MetaWriteContext {
  supabase: Pick<SupabaseClient, "from">;
  userId: string;
  draftId: string;
  eventId: string | null;
}

interface IdempotencyRow {
  id: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
}

export function hashMetaWritePayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export function isMetaIdempotencyTableMissing(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  if (code === "PGRST205" || code === "42P01") return true;
  if (
    message.includes("meta_write_idempotency") &&
    (message.includes("schema cache") ||
      message.includes("does not exist") ||
      message.includes("could not find the table"))
  ) {
    return true;
  }
  return false;
}

function ledgerUnavailableReason(error: {
  code?: string;
  message?: string;
} | null): string | null {
  if (!error) return null;
  if (isMetaIdempotencyTableMissing(error)) return "table_absent";
  if (error.code === "23503") return "foreign_key";
  const message = (error.message ?? "").toLowerCase();
  if (message.includes("foreign key") || message.includes("violates foreign key")) {
    return "foreign_key";
  }
  return `ledger_error:${error.code ?? "unknown"}`;
}

export async function withMetaWriteIdempotency(
  context: MetaWriteContext | null,
  opKind: MetaWriteOpKind,
  payload: unknown,
  run: () => Promise<string>,
): Promise<string> {
  if (!context?.draftId || !context.userId) {
    return run();
  }

  const payloadHash = hashMetaWritePayload(payload);
  const { data: existing, error: lookupError } = await context.supabase
    .from("meta_write_idempotency")
    .select("id,op_result_id,op_status")
    .eq("draft_id", context.draftId)
    .eq("op_kind", opKind)
    .eq("op_payload_hash", payloadHash)
    .maybeSingle();

  const lookupUnavailable = ledgerUnavailableReason(lookupError);
  if (lookupUnavailable) {
    console.warn(
      `[meta-write-idempotency] ledger unavailable (${lookupUnavailable}); proceeding without idempotency`,
    );
    return run();
  }
  if (lookupError) {
    console.warn(
      `[meta-write-idempotency] ledger unavailable (ledger_error:${lookupError.code ?? "unknown"}); proceeding without idempotency`,
    );
    return run();
  }

  const existingRow = existing as IdempotencyRow | null;
  // Success is the only short-circuit. `failed` and `pending` fall through
  // and re-run — that is what makes post-launch "Retry failed ads" safe.
  if (existingRow?.op_status === "success" && existingRow.op_result_id) {
    return existingRow.op_result_id;
  }

  const { data: pending, error: pendingError } = await context.supabase
    .from("meta_write_idempotency")
    .upsert(
      {
        user_id: context.userId,
        event_id: context.eventId,
        draft_id: context.draftId,
        op_kind: opKind,
        op_payload_hash: payloadHash,
        op_status: "pending",
      },
      { onConflict: "draft_id,op_kind,op_payload_hash" },
    )
    .select("id")
    .maybeSingle();

  const pendingUnavailable = ledgerUnavailableReason(pendingError);
  if (pendingUnavailable) {
    console.warn(
      `[meta-write-idempotency] ledger unavailable (${pendingUnavailable}); proceeding without idempotency`,
    );
    return run();
  }
  if (pendingError) {
    console.warn(
      `[meta-write-idempotency] ledger unavailable (ledger_error:${pendingError.code ?? "unknown"}); proceeding without idempotency`,
    );
    return run();
  }

  const rowId = (pending as { id?: string } | null)?.id ?? existingRow?.id ?? null;
  if (!rowId) {
    console.warn(
      "[meta-write-idempotency] ledger unavailable (row_not_returned); proceeding without idempotency",
    );
    return run();
  }

  try {
    const resultId = await run();
    const { error: successError } = await context.supabase
      .from("meta_write_idempotency")
      .update({ op_result_id: resultId, op_status: "success" })
      .eq("id", rowId);
    if (successError) {
      const reason = ledgerUnavailableReason(successError) ?? "success_write_failed";
      console.warn(
        `[meta-write-idempotency] ledger unavailable (${reason}); write already succeeded id=${resultId}`,
      );
    }
    return resultId;
  } catch (err) {
    await context.supabase
      .from("meta_write_idempotency")
      .update({ op_status: "failed" })
      .eq("id", rowId);
    throw err;
  }
}

/**
 * Drops every ledger row for a draft so a post-rollback retry cannot
 * short-circuit onto deleted Meta object IDs. Meta launch has no rollback
 * today; this is the TikTok-parity primitive for when one is added.
 * Table-absent is a no-op (named warn).
 */
export interface FailedMetaWrite {
  op_kind: MetaWriteOpKind;
  op_payload_hash: string;
}

const RETRYABLE_FAILED_KINDS: MetaWriteOpKind[] = ["ad_create", "adset_create"];

/**
 * Failed ad / ad-set ledger rows for a draft. The retry surface is
 * offered only when this list is non-empty — a launch summary with
 * failures but no ledger rows cannot safely short-circuit successes.
 */
export async function listFailedMetaWrites(
  context: Pick<MetaWriteContext, "supabase" | "draftId">,
  opKinds: MetaWriteOpKind[] = RETRYABLE_FAILED_KINDS,
): Promise<FailedMetaWrite[]> {
  const { data, error } = await context.supabase
    .from("meta_write_idempotency")
    .select("op_kind,op_payload_hash,op_status")
    .eq("draft_id", context.draftId);

  if (error || !data) return [];
  const kinds = new Set(opKinds);
  return (data as Array<FailedMetaWrite & { op_status?: string }>)
    .filter((row) => row.op_status === "failed" && kinds.has(row.op_kind))
    .map((row) => ({ op_kind: row.op_kind, op_payload_hash: row.op_payload_hash }));
}

export async function clearMetaWriteIdempotency(
  context: Pick<MetaWriteContext, "supabase" | "draftId">,
): Promise<void> {
  const { error } = await context.supabase
    .from("meta_write_idempotency")
    .delete()
    .eq("draft_id", context.draftId);
  const unavailable = ledgerUnavailableReason(error);
  if (unavailable) {
    console.warn(
      `[meta-write-idempotency] clear skipped (${unavailable}) draft=${context.draftId}`,
    );
    return;
  }
  if (error) {
    throw new Error(error.message);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => {
      const record = value as Record<string, unknown>;
      return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
    })
    .join(",")}}`;
}
