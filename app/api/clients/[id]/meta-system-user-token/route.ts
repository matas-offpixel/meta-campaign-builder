import { NextResponse, type NextRequest } from "next/server";

import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  getMetaSystemTokenKey,
  metaSystemUserEnabled,
} from "@/lib/meta/system-user-token";
import { validateMetaToken } from "@/lib/meta/server-token";

/**
 * /api/clients/[id]/meta-system-user-token
 *
 * Phase 1 admin endpoint for the per-client Meta Business Manager
 * System User token (see
 * `docs/META_TOKEN_ARCHITECTURE_2026-05-11.md` §5).
 *
 * `POST` — accepts `{ token: string }` in the body, validates the
 * token via Meta's `/debug_token` endpoint (must come back
 * `is_valid: true` with `ads_management` in the granted scopes), then
 * encrypts + persists via the `set_meta_system_user_token` RPC. The
 * raw token is never echoed back; we return a masked preview + the
 * `meta_system_user_token_set_at` timestamp so the UI can confirm the
 * save without re-reading the secret.
 *
 * `DELETE` — clears the column via `clear_meta_system_user_token`.
 *
 * `GET` — returns whether a token is currently saved + masked preview
 *   + timestamps. We **never** decrypt the token for display, just
 *   the prefix that the operator passed on save (kept on the server
 *   in the response for the original POST; subsequent reads after
 *   refresh show only the timestamp because we can't decrypt to
 *   re-mask without leaking secrets).
 *
 * Auth posture mirrors `/api/clients/[id]` PATCH — caller must own the
 * client row. RLS catches this too; we return an explicit 403 so the
 * UI toast is unmissable. RPCs themselves run on a service-role
 * client because migration 090 only grants execute to `service_role`.
 *
 * Feature flag: when `OFFPIXEL_META_SYSTEM_USER_ENABLED` is unset, all
 * three handlers return 503 so the UI hides the section anyway. We
 * still surface a clear "feature flag off" message in case someone
 * pokes the endpoint directly during rollback.
 */

interface OwningClient {
  id: string;
  user_id: string;
  meta_system_user_token_set_at: string | null;
  meta_system_user_token_last_used_at: string | null;
  meta_system_user_token_present: boolean;
}

async function loadOwningClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  userId: string,
): Promise<
  | { ok: true; client: OwningClient }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await supabase
    .from("clients")
    .select(
      // The new columns aren't in the generated types yet; cast through
      // unknown when we read the rows. Selecting `*` keeps it cheap and
      // forwards-compatible.
      "id, user_id",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 500, error: error.message };
  }
  if (!data) {
    return { ok: false, status: 404, error: "Client not found" };
  }
  if ((data as { user_id: string }).user_id !== userId) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  // Re-read with the service-role client to pull the new columns
  // (`meta_system_user_token_*`) which the cookie-bound client may
  // refuse depending on RLS shape and which the generated types
  // don't yet know about.
  let serviceClient: ReturnType<typeof createServiceRoleClient>;
  try {
    serviceClient = createServiceRoleClient();
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Service-role unavailable",
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tokenRow, error: tokenErr } = await (serviceClient as any)
    .from("clients")
    .select(
      "id, meta_system_user_token_set_at, meta_system_user_token_last_used_at, meta_system_user_token_encrypted",
    )
    .eq("id", clientId)
    .maybeSingle();
  if (tokenErr) {
    return { ok: false, status: 500, error: tokenErr.message };
  }

  const present = Boolean(tokenRow?.meta_system_user_token_encrypted);

  return {
    ok: true,
    client: {
      id: clientId,
      user_id: userId,
      meta_system_user_token_set_at:
        (tokenRow as { meta_system_user_token_set_at?: string | null } | null)
          ?.meta_system_user_token_set_at ?? null,
      meta_system_user_token_last_used_at:
        (
          tokenRow as {
            meta_system_user_token_last_used_at?: string | null;
          } | null
        )?.meta_system_user_token_last_used_at ?? null,
      meta_system_user_token_present: present,
    },
  };
}

function maskToken(token: string): string {
  if (token.length <= 12) return `${token.slice(0, 2)}…${token.slice(-2)}`;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function ensureFeatureEnabled(): NextResponse | null {
  if (metaSystemUserEnabled()) return null;
  return NextResponse.json(
    {
      ok: false,
      error:
        "Meta System User tokens are disabled. Set OFFPIXEL_META_SYSTEM_USER_ENABLED=true to enable.",
    },
    { status: 503 },
  );
}

async function authenticate(): Promise<
  | { ok: true; userId: string; supabase: Awaited<ReturnType<typeof createClient>> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Not signed in" },
        { status: 401 },
      ),
    };
  }
  return { ok: true, userId: user.id, supabase };
}

// ─── GET ────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const featureCheck = ensureFeatureEnabled();
  if (featureCheck) return featureCheck;

  const { id } = await params;
  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  const lookup = await loadOwningClient(auth.supabase, id, auth.userId);
  if (!lookup.ok) {
    return NextResponse.json(
      { ok: false, error: lookup.error },
      { status: lookup.status },
    );
  }

  return NextResponse.json({
    ok: true,
    present: lookup.client.meta_system_user_token_present,
    setAt: lookup.client.meta_system_user_token_set_at,
    lastUsedAt: lookup.client.meta_system_user_token_last_used_at,
  });
}

// ─── POST ───────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const featureCheck = ensureFeatureEnabled();
  if (featureCheck) return featureCheck;

  const { id } = await params;
  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  const lookup = await loadOwningClient(auth.supabase, id, auth.userId);
  if (!lookup.ok) {
    return NextResponse.json(
      { ok: false, error: lookup.error },
      { status: lookup.status },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Body must be a JSON object." },
      { status: 400 },
    );
  }
  const token = (body as { token?: unknown }).token;
  if (typeof token !== "string" || token.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "`token` must be a non-empty string." },
      { status: 400 },
    );
  }

  // Validate via Meta /debug_token before persistence. We require:
  //   - is_valid: true (so a stale or revoked token is rejected at save
  //     time, not three days later when the cron logs it)
  //   - ads_management in granted scopes (the BUC bucket only applies
  //     when the System User has the Marketing API permission)
  let validation: Awaited<ReturnType<typeof validateMetaToken>>;
  try {
    validation = await validateMetaToken(token);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `Token validation threw: ${err.message}`
            : "Token validation threw",
      },
      { status: 502 },
    );
  }
  if (!validation.valid) {
    return NextResponse.json(
      {
        ok: false,
        error:
          validation.error ??
          "Meta /debug_token rejected the token. Generate a fresh System User token and retry.",
      },
      { status: 400 },
    );
  }
  const scopes = validation.scopes ?? [];
  if (!scopes.includes("ads_management")) {
    return NextResponse.json(
      {
        ok: false,
        error: `System User token missing 'ads_management' scope (got: ${scopes.join(", ") || "<none>"}). Re-create the System User with the Marketing API permission.`,
      },
      { status: 400 },
    );
  }

  let key: string;
  try {
    key = getMetaSystemTokenKey();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Encryption key missing",
      },
      { status: 500 },
    );
  }

  let serviceClient: ReturnType<typeof createServiceRoleClient>;
  try {
    serviceClient = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role unavailable",
      },
      { status: 500 },
    );
  }

  const { error: rpcError } = await serviceClient.rpc(
    "set_meta_system_user_token",
    { p_client_id: id, p_token: token, p_key: key },
  );
  if (rpcError) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to save token: ${rpcError.message}`,
      },
      { status: 500 },
    );
  }

  // Re-read the timestamp we just wrote so the UI can render the
  // confirmation without a separate fetch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: refreshed } = await (serviceClient as any)
    .from("clients")
    .select(
      "meta_system_user_token_set_at, meta_system_user_token_last_used_at",
    )
    .eq("id", id)
    .maybeSingle();

  console.info(
    `[meta-system-user-token] saved client_id=${id} prefix=${token.slice(0, 8)}… scopes=${scopes.join(",")} expires_at=${
      validation.expiresAt ? new Date(validation.expiresAt * 1000).toISOString() : "never"
    }`,
  );

  return NextResponse.json({
    ok: true,
    present: true,
    masked: maskToken(token),
    setAt:
      (refreshed as { meta_system_user_token_set_at?: string | null } | null)
        ?.meta_system_user_token_set_at ?? null,
    lastUsedAt:
      (
        refreshed as {
          meta_system_user_token_last_used_at?: string | null;
        } | null
      )?.meta_system_user_token_last_used_at ?? null,
    validation: {
      appId: validation.appId,
      userId: validation.userId,
      expiresAt: validation.expiresAt ?? null,
      scopes,
    },
  });
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const featureCheck = ensureFeatureEnabled();
  if (featureCheck) return featureCheck;

  const { id } = await params;
  const auth = await authenticate();
  if (!auth.ok) return auth.response;

  const lookup = await loadOwningClient(auth.supabase, id, auth.userId);
  if (!lookup.ok) {
    return NextResponse.json(
      { ok: false, error: lookup.error },
      { status: lookup.status },
    );
  }

  let serviceClient: ReturnType<typeof createServiceRoleClient>;
  try {
    serviceClient = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Service-role unavailable",
      },
      { status: 500 },
    );
  }

  const { error: rpcError } = await serviceClient.rpc(
    "clear_meta_system_user_token",
    { p_client_id: id },
  );
  if (rpcError) {
    return NextResponse.json(
      { ok: false, error: rpcError.message },
      { status: 500 },
    );
  }

  console.info(`[meta-system-user-token] cleared client_id=${id}`);

  return NextResponse.json({
    ok: true,
    present: false,
    setAt: null,
    lastUsedAt: null,
  });
}
