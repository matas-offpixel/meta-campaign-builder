import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BodyValue } from "../client.ts";

export type TikTokWriteOpKind =
  | "campaign_create"
  | "adgroup_create"
  | "ad_create"
  | "creative_upload";

export type TikTokPost = <T>(
  path: string,
  body: Record<string, BodyValue>,
  token: string,
) => Promise<T>;

export type Sleep = (ms: number) => Promise<void>;

export interface TikTokWriteContext {
  supabase: Pick<SupabaseClient, "from">;
  userId: string;
  eventId: string;
  draftId: string;
  advertiserId: string;
  token: string;
  request: TikTokPost;
  sleep?: Sleep;
}

interface IdempotencyRow {
  id: string;
  op_result_id: string | null;
  op_status: "pending" | "success" | "failed";
}

export function hashTikTokWritePayload(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

export async function withTikTokWriteIdempotency(
  context: TikTokWriteContext,
  opKind: TikTokWriteOpKind,
  payload: Record<string, BodyValue>,
  run: () => Promise<string>,
): Promise<string> {
  const payloadHash = hashTikTokWritePayload(payload);
  const { data: existing, error: lookupError } = await context.supabase
    .from("tiktok_write_idempotency")
    .select("id,op_result_id,op_status")
    .eq("draft_id", context.draftId)
    .eq("op_kind", opKind)
    .eq("op_payload_hash", payloadHash)
    .maybeSingle();

  if (lookupError) throw new Error(lookupError.message);

  const existingRow = existing as IdempotencyRow | null;
  if (existingRow?.op_status === "success" && existingRow.op_result_id) {
    return existingRow.op_result_id;
  }

  const { data: pending, error: pendingError } = await context.supabase
    .from("tiktok_write_idempotency")
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

  if (pendingError) throw new Error(pendingError.message);
  const rowId =
    (pending as { id?: string } | null)?.id ?? existingRow?.id ?? null;
  if (!rowId) throw new Error("TikTok write idempotency row was not returned");

  try {
    const resultId = await run();
    const { error: successError } = await context.supabase
      .from("tiktok_write_idempotency")
      .update({ op_result_id: resultId, op_status: "success" })
      .eq("id", rowId);
    if (successError) throw new Error(successError.message);
    return resultId;
  } catch (err) {
    await context.supabase
      .from("tiktok_write_idempotency")
      .update({ op_status: "failed" })
      .eq("id", rowId);
    throw err;
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
