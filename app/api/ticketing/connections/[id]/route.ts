import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  deleteConnection,
  getConnectionById,
  getConnectionWithDecryptedCredentials,
  setConnectionStatus,
  upsertConnection,
} from "@/lib/db/ticketing";
import { getProvider } from "@/lib/ticketing/registry";
import type {
  TicketingConnectionStatus,
  TicketingProviderName,
} from "@/lib/ticketing/types";

/**
 * /api/ticketing/connections/[id]
 *
 * PATCH  → update credentials and / or status. Re-validation is run
 *          when credentials are supplied — the same belt-and-braces
 *          rule from POST applies (no bad token ever lands in the DB).
 * DELETE → soft-delete by flipping status to 'paused'. The row stays
 *          for audit trail; pass `?hard=1` to actually delete.
 */

const ALLOWED_STATUSES: TicketingConnectionStatus[] = [
  "active",
  "paused",
  "error",
];

interface PatchBody {
  credentials?: unknown;
  status?: unknown;
  retry?: unknown;
}

async function loadOwnedConnection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  userId: string,
) {
  const connection = await getConnectionById(supabase, id);
  if (!connection) return { ok: false as const, status: 404, error: "Not found" };
  if (connection.user_id !== userId)
    return { ok: false as const, status: 403, error: "Forbidden" };
  return { ok: true as const, connection };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const owned = await loadOwnedConnection(supabase, id, user.id);
  if (!owned.ok) {
    return NextResponse.json(
      { ok: false, error: owned.error },
      { status: owned.status },
    );
  }

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const status =
    typeof body.status === "string"
      ? (body.status as TicketingConnectionStatus)
      : undefined;
  const credentials =
    body.credentials && typeof body.credentials === "object"
      ? (body.credentials as Record<string, unknown>)
      : null;
  const retry = body.retry === true;

  if (status && !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json(
      {
        ok: false,
        error: `status must be one of: ${ALLOWED_STATUSES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  if (retry && !credentials) {
    const decrypted = await getConnectionWithDecryptedCredentials(
      supabase,
      owned.connection.id,
    );
    if (!decrypted) {
      return NextResponse.json(
        { ok: false, error: "Connection credentials could not be loaded." },
        { status: 404 },
      );
    }
    const providerImpl = getProvider(decrypted.provider);
    const validation = await providerImpl.validateCredentials(
      decrypted.credentials,
    );
    if (!validation.ok) {
      await setConnectionStatus(
        supabase,
        owned.connection.id,
        "error",
        validation.error ?? "Provider rejected the credentials.",
      );
      return NextResponse.json(
        {
          ok: false,
          error: validation.error ?? "Provider rejected the credentials.",
        },
        { status: 400 },
      );
    }
    await setConnectionStatus(supabase, owned.connection.id, "active", null);
    const updated = await getConnectionById(supabase, owned.connection.id);
    return NextResponse.json({
      ok: true,
      connection: updated ? { ...updated, credentials: null } : null,
    });
  }

  // Credential update path — re-validate via the provider, then upsert.
  if (credentials) {
    const provider = owned.connection.provider as TicketingProviderName;
    const providerImpl = getProvider(provider);
    const validation = await providerImpl.validateCredentials(credentials);
    if (!validation.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: validation.error ?? "Provider rejected the credentials.",
        },
        { status: 400 },
      );
    }
    const updated = await upsertConnection(supabase, {
      userId: user.id,
      clientId: owned.connection.client_id,
      provider,
      credentials,
      externalAccountId: validation.externalAccountId ?? null,
      status: status ?? "active",
    });
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: "Failed to update credentials." },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      connection: { ...updated, credentials: null },
    });
  }

  // Status-only update path — short-circuit when nothing changed.
  if (status) {
    await setConnectionStatus(supabase, id, status, null);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { ok: false, error: "No updatable fields provided." },
    { status: 400 },
  );
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Not signed in" },
      { status: 401 },
    );
  }

  const owned = await loadOwnedConnection(supabase, id, user.id);
  if (!owned.ok) {
    return NextResponse.json(
      { ok: false, error: owned.error },
      { status: owned.status },
    );
  }

  // Default behaviour is soft-delete (status=paused) so we keep the row
  // for audit + so re-saving the same connection later doesn't lose the
  // event_ticketing_links pivot rows. Hard delete on demand.
  const sp = req.nextUrl.searchParams;
  if (sp.get("hard") === "1") {
    await deleteConnection(supabase, id);
    return NextResponse.json({ ok: true, hard: true });
  }
  await setConnectionStatus(supabase, id, "paused", null);
  return NextResponse.json({ ok: true, hard: false });
}
