/**
 * POST /api/meta/customer-audience-upload
 *
 * Receives PRE-HASHED audience data from the browser and uploads it to a Meta
 * Custom Audience. Raw PII NEVER reaches this route — the browser hashes
 * everything using SHA-256 (Web Crypto API) before any network call.
 *
 * PII Safety:
 *   - This route receives only SHA-256 hashes and audience metadata.
 *   - Logs: audience name, chunk index, hash count per chunk, Meta status.
 *   - NEVER logs hashes — even though they are one-way digests, they can be
 *     re-identified against Meta's graph, so they are treated as PII.
 *
 * Flow:
 *   mode === "create" + chunkIndex === 0:
 *     1. POST to /act_{X}/customaudiences → get audienceId
 *     2. POST users to /act_{X}/customaudiences/{ID}/users (chunk 0)
 *   mode === "append" OR chunkIndex > 0:
 *     1. POST users directly to /act_{X}/customaudiences/{ID}/users
 *
 *   Client sends chunks sequentially; last chunk carries last_batch_flag=true
 *   in the Meta session structure to close the upload session cleanly.
 *
 * Meta session upload: https://developers.facebook.com/docs/marketing-api/audiences/guides/custom-audiences/#step-2--add-users-using-session-uploads
 *
 * GET /api/meta/customer-audience-upload/list?adAccountId=act_...
 *   Returns existing CUSTOM type audiences (excluding lookalikes) for the
 *   append-mode picker. Cached 60s per ad account.
 */

export const maxDuration = 300;

import { createClient } from "@/lib/supabase/server";
import { resolveServerMetaToken } from "@/lib/meta/server-token";
import { normalizeAdAccountId } from "@/lib/meta/ad-account";
import {
  classifyLaunchMetaCode,
  type LaunchErrorKind,
} from "@/lib/meta/launch-error-classify";

const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const BASE = `https://graph.facebook.com/${API_VERSION}`;

// ─── Types ────────────────────────────────────────────────────────────────────

type MatchSchema = "EMAIL_SHA256" | "PHONE_SHA256";

interface UploadBody {
  adAccountId: string;
  /** Required when mode === "append" or chunkIndex > 0 */
  audienceId?: string;
  /** Required when mode === "create" and chunkIndex === 0 */
  audienceName?: string;
  audienceDescription?: string;
  retentionDays?: number;
  mode: "create" | "append";
  schema: MatchSchema[];
  /** Hashed data rows, max 10,000 per chunk */
  data: string[][];
  /** 0-based chunk index */
  chunkIndex: number;
  /** Total number of chunks for this upload session */
  totalChunks: number;
  /** Stable session ID generated client-side for the entire upload */
  sessionId: number;
  /** Total hashed records across all chunks */
  estimatedTotal: number;
}

interface MetaCreateAudienceResponse {
  id: string;
}

interface MetaUsersResponse {
  audience_id?: string;
  num_received?: number;
  num_invalid_entries?: number;
  invalid_entry_samples?: Record<string, unknown>;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function friendlyMetaError(code: number | undefined, message: string): string {
  const kind: LaunchErrorKind = classifyLaunchMetaCode(code);
  if (kind === "rate_limit") {
    return "Rate limit reached — try again in a few minutes.";
  }
  if (kind === "auth") {
    return "Connection expired — reconnect Facebook in Account Setup, then try again.";
  }
  return `Meta error: ${message}`;
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function resolveAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorised", status: 401, user: null, token: null };

  let token: string;
  try {
    const resolved = await resolveServerMetaToken(supabase, user.id);
    token = resolved.token;
  } catch {
    return {
      error: "Facebook session expired or not connected. Reconnect Facebook in Account Setup.",
      status: 401,
      user: null,
      token: null,
    };
  }

  return { error: null, status: 200, user, token };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const auth = await resolveAuth();
  if (auth.error || !auth.token) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }
  const { token } = auth;

  let body: UploadBody;
  try {
    body = (await req.json()) as UploadBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  const {
    adAccountId: adAccountRaw,
    audienceId: audienceIdRaw,
    audienceName,
    audienceDescription,
    retentionDays = 180,
    mode,
    schema,
    data,
    chunkIndex = 0,
    totalChunks = 1,
    sessionId,
    estimatedTotal,
  } = body;

  if (!adAccountRaw) {
    return Response.json({ error: "adAccountId is required" }, { status: 400 });
  }
  const adAccountId = normalizeAdAccountId(adAccountRaw);
  if (!adAccountId) {
    return Response.json({ error: "Invalid adAccountId format" }, { status: 400 });
  }

  if (!Array.isArray(data) || data.length === 0) {
    return Response.json({ error: "data must be a non-empty array" }, { status: 400 });
  }
  if (data.length > 10_000) {
    return Response.json({ error: "data exceeds 10,000 rows per chunk" }, { status: 400 });
  }
  if (!Array.isArray(schema) || schema.length === 0) {
    return Response.json({ error: "schema is required" }, { status: 400 });
  }
  if (!["create", "append"].includes(mode)) {
    return Response.json({ error: "mode must be 'create' or 'append'" }, { status: 400 });
  }
  if (mode === "create" && chunkIndex === 0 && !audienceName?.trim()) {
    return Response.json({ error: "audienceName is required for mode=create" }, { status: 400 });
  }
  if ((mode === "append" || chunkIndex > 0) && !audienceIdRaw) {
    return Response.json({ error: "audienceId is required for append mode or subsequent chunks" }, { status: 400 });
  }

  // ── Step 1: Create audience (first chunk of a new audience only) ───────────

  let audienceId = audienceIdRaw;

  if (mode === "create" && chunkIndex === 0) {
    const createUrl = new URL(`${BASE}/${adAccountId}/customaudiences`);
    createUrl.searchParams.set("access_token", token);

    const createPayload = new URLSearchParams({
      name: audienceName!.trim(),
      subtype: "CUSTOM",
      customer_file_source: "USER_PROVIDED_ONLY",
      retention_days: String(retentionDays),
    });
    if (audienceDescription?.trim()) {
      createPayload.set("description", audienceDescription.trim());
    }

    console.info(
      `[customer-audience-upload] Creating audience name="${audienceName?.trim()}" ` +
      `adAccount=${adAccountId} retentionDays=${retentionDays}`,
    );

    const createRes = await fetch(createUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: createPayload.toString(),
    });

    const createJson = (await createRes.json()) as MetaCreateAudienceResponse & {
      error?: { message: string; code?: number };
    };

    if (!createRes.ok || createJson.error) {
      const e = createJson.error ?? { message: `HTTP ${createRes.status}` };
      const kind = classifyLaunchMetaCode(e.code);
      console.error(
        `[customer-audience-upload] Failed to create audience: code=${e.code} msg="${e.message}"`,
      );
      return Response.json(
        {
          error: friendlyMetaError(e.code, e.message),
          rateLimited: kind === "rate_limit",
          tokenExpired: kind === "auth",
        },
        { status: kind === "rate_limit" ? 429 : kind === "auth" ? 401 : 502 },
      );
    }

    audienceId = createJson.id;
    console.info(
      `[customer-audience-upload] Audience created id=${audienceId}`,
    );
  }

  if (!audienceId) {
    return Response.json({ error: "audienceId could not be determined" }, { status: 500 });
  }

  // ── Step 2: Upload hashed users ────────────────────────────────────────────

  const isLastBatch = chunkIndex === totalChunks - 1;

  const session = {
    session_id: sessionId,
    batch_seq: chunkIndex + 1,
    last_batch_flag: isLastBatch,
    estimated_num_total: estimatedTotal,
  };

  const uploadUrl = new URL(`${BASE}/${audienceId}/users`);
  uploadUrl.searchParams.set("access_token", token);

  const uploadPayload = {
    payload: {
      schema,
      data,
    },
    session,
  };

  console.info(
    `[customer-audience-upload] Uploading chunk ${chunkIndex + 1}/${totalChunks} ` +
    `audienceId=${audienceId} adAccount=${adAccountId} ` +
    `rows=${data.length} schema=${schema.join(",")} ` +
    `lastBatch=${isLastBatch}`,
  );

  const uploadRes = await fetch(uploadUrl.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(uploadPayload),
  });

  const uploadJson = (await uploadRes.json()) as MetaUsersResponse & {
    error?: { message: string; code?: number };
  };

  if (!uploadRes.ok || uploadJson.error) {
    const e = uploadJson.error ?? { message: `HTTP ${uploadRes.status}` };
    const kind = classifyLaunchMetaCode(e.code);
    console.error(
      `[customer-audience-upload] Chunk upload failed: audienceId=${audienceId} ` +
      `chunk=${chunkIndex + 1}/${totalChunks} code=${e.code} msg="${e.message}"`,
    );
    return Response.json(
      {
        error: friendlyMetaError(e.code, e.message),
        audienceId,
        chunkIndex,
        rateLimited: kind === "rate_limit",
        tokenExpired: kind === "auth",
      },
      { status: kind === "rate_limit" ? 429 : kind === "auth" ? 401 : 502 },
    );
  }

  console.info(
    `[customer-audience-upload] Chunk OK: audienceId=${audienceId} ` +
    `chunk=${chunkIndex + 1}/${totalChunks} ` +
    `numReceived=${uploadJson.num_received ?? "unknown"} ` +
    `numInvalid=${uploadJson.num_invalid_entries ?? 0}`,
  );

  return Response.json({
    audienceId,
    chunkIndex,
    numReceived: uploadJson.num_received ?? data.length,
    numInvalid: uploadJson.num_invalid_entries ?? 0,
    lastBatch: isLastBatch,
  });
}
