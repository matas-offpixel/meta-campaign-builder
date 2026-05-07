import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAudienceById,
  updateAudience,
} from "@/lib/db/meta-custom-audiences";
import type { Database } from "@/lib/db/database.types";
import {
  metaAudienceIdempotencyKey,
  withMetaAudienceWriteIdempotency,
} from "@/lib/meta/audience-idempotency";
import { buildMetaCustomAudiencePayload } from "@/lib/meta/audience-payload";
import { withActPrefix } from "@/lib/meta/ad-account-id";
import { MetaApiError } from "@/lib/meta/client";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { createClient } from "@/lib/supabase/server";
import type { MetaCustomAudience } from "@/lib/types/audience";

type TypedSupabaseClient = SupabaseClient<Database>;

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

export { buildMetaCustomAudiencePayload } from "@/lib/meta/audience-payload";

export interface MetaAudienceWriteSuccess {
  audienceId: string;
  metaAudienceId: string;
}

export interface MetaAudienceWriteFailure {
  audienceId: string;
  error: string;
}

export interface MetaAudienceBatchResult {
  successes: MetaAudienceWriteSuccess[];
  failures: MetaAudienceWriteFailure[];
}

export type MetaAudiencePost = (
  path: string,
  body: Record<string, string>,
  token: string,
) => Promise<{ id: string }>;

export function metaAudienceWritesEnabled(): boolean {
  return process.env.OFFPIXEL_META_AUDIENCE_WRITES_ENABLED === "true";
}

export function assertMetaAudienceWritesEnabled() {
  if (!metaAudienceWritesEnabled()) {
    throw new Error("Meta audience writes are disabled");
  }
}

export async function createMetaCustomAudience(
  audienceId: string,
  options: {
    userId: string;
    supabase?: TypedSupabaseClient;
    request?: MetaAudiencePost;
  },
): Promise<MetaCustomAudience> {
  assertMetaAudienceWritesEnabled();
  const supabase = options.supabase ?? (await createClient());
  const audience = await getAudienceById(audienceId);
  if (!audience || audience.userId !== options.userId) {
    throw new Error("Audience not found");
  }
  if (audience.status !== "draft" && audience.status !== "failed") {
    throw new Error("Only draft or failed audiences can be created on Meta");
  }

  const { token } = await resolveServerMetaToken(supabase, options.userId);
  const idempotencyKey = metaAudienceIdempotencyKey(audience.id, options.userId);

  await updateAudience(audience.id, { status: "creating", statusError: null });
  try {
    const payload = buildMetaCustomAudiencePayload(audience);
    const post = options.request ?? postMetaAudienceForm;
    const metaAudienceId = await withMetaAudienceWriteIdempotency(
      supabase,
      {
        idempotencyKey,
        userId: options.userId,
        audienceId: audience.id,
      },
      async () => {
        const result = await post(
          `/${withActPrefix(audience.metaAdAccountId)}/customaudiences`,
          payload,
          token,
        );
        if (!result.id) throw new Error("Meta returned no audience id");
        return result.id;
      },
    );

    const updated = await updateAudience(audience.id, {
      status: "ready",
      metaAudienceId,
      statusError: null,
    });
    if (!updated) throw new Error("Audience not found after Meta write");
    return updated;
  } catch (err) {
    const message = formatMetaWriteError(err);
    const updated = await updateAudience(audience.id, {
      status: "failed",
      statusError: message,
    });
    if (updated) return updated;
    throw err;
  }
}

export async function createMetaCustomAudienceBatch(
  audienceIds: string[],
  options: {
    userId: string;
    supabase?: TypedSupabaseClient;
    request?: MetaAudiencePost;
  },
): Promise<MetaAudienceBatchResult> {
  assertMetaAudienceWritesEnabled();
  const successes: MetaAudienceWriteSuccess[] = [];
  const failures: MetaAudienceWriteFailure[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < audienceIds.length) {
      const audienceId = audienceIds[cursor];
      cursor += 1;
      try {
        const updated = await createMetaCustomAudience(audienceId, options);
        if (!updated.metaAudienceId) {
          throw new Error("Meta audience id missing after write");
        }
        successes.push({
          audienceId,
          metaAudienceId: updated.metaAudienceId,
        });
      } catch (err) {
        failures.push({
          audienceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, audienceIds.length) }, worker));
  return { successes, failures };
}

export async function archiveMetaCustomAudience(
  audienceId: string,
  options: { userId: string; supabase?: TypedSupabaseClient },
): Promise<boolean> {
  const audience = await getAudienceById(audienceId);
  if (!audience || audience.userId !== options.userId) return false;
  if (metaAudienceWritesEnabled() && audience.metaAudienceId) {
    const supabase = options.supabase ?? (await createClient());
    const { token } = await resolveServerMetaToken(supabase, options.userId);
    await deleteMetaAudience(
      audience.metaAdAccountId,
      audience.metaAudienceId,
      token,
    ).catch((err) => {
      console.warn(
        "[archiveMetaCustomAudience] Meta delete failed; archiving locally:",
        err instanceof Error ? err.message : String(err),
      );
    });
  }
  const updated = await updateAudience(audienceId, { status: "archived" });
  return Boolean(updated);
}

async function postMetaAudienceForm(
  path: string,
  body: Record<string, string>,
  token: string,
): Promise<{ id: string }> {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("access_token", token);

  // DIAGNOSTIC: log the exact form payload being sent to Meta (without token).
  // Remove this logging once audience writes are stable across all subtypes.
  console.log(
    `[audience-write] POST ${path}\n` +
      `  name: ${body.name}\n` +
      `  subtype: ${body.subtype}\n` +
      `  retention_days: ${body.retention_days}\n` +
      `  prefill: ${body.prefill}\n` +
      `  rule (raw JSON string): ${body.rule}`,
  );

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });
  const json = (await response.json()) as Record<string, unknown>;
  if (!response.ok || json.error) {
    const e = (json.error ?? {}) as Record<string, unknown>;
    // DIAGNOSTIC: log full error response from Meta for debugging.
    console.error(
      `[audience-write] Meta rejected payload for ${path}:\n`,
      JSON.stringify(e, null, 2),
    );
    throw new MetaApiError(
      (e.message as string) ?? `HTTP ${response.status}`,
      e.code as number | undefined,
      e.type as string | undefined,
      e.fbtrace_id as string | undefined,
      e.error_subcode as number | undefined,
      (e.error_user_msg ?? e.error_user_title) as string | undefined,
      e as Record<string, unknown>,
    );
  }
  return json as { id: string };
}

async function deleteMetaAudience(
  adAccountId: string,
  metaAudienceId: string,
  token: string,
): Promise<void> {
  const url = new URL(
    `${BASE}/${withActPrefix(adAccountId)}/customaudiences/${metaAudienceId}`,
  );
  url.searchParams.set("access_token", token);
  const response = await fetch(url.toString(), {
    method: "DELETE",
    cache: "no-store",
  });
  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const error = (json.error ?? {}) as Record<string, unknown>;
    throw new Error((error.message as string | undefined) ?? `HTTP ${response.status}`);
  }
}

function formatMetaWriteError(err: unknown): string {
  if (err instanceof MetaApiError) {
    const suffix = [
      err.code ? `code ${err.code}` : null,
      err.subcode ? `subcode ${err.subcode}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return suffix ? `${err.message} (${suffix})` : err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
