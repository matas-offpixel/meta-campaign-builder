import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  listD2CConnectionsForUser,
  upsertD2CConnection,
} from "@/lib/db/d2c";
import { getD2CProvider, listD2CProviderNames } from "@/lib/d2c/registry";
import { MissingD2CTokenKeyError } from "@/lib/d2c/secrets";
import type { D2CProviderName } from "@/lib/d2c/types";

/**
 * /api/d2c/connections
 *
 * GET ?clientId=X            → list D2C connections for this user.
 * POST { clientId, provider, credentials }
 *                              → validate credentials with the provider, then
 *                                 upsert. Bad credentials → 400; nothing is
 *                                 written to the DB on failure. Credentials
 *                                 are always redacted on response.
 *
 * Mirrors the ticketing connections route surface.
 */

const ALLOWED_PROVIDERS = listD2CProviderNames();

interface PostBody {
  clientId?: unknown;
  provider?: unknown;
  credentials?: unknown;
}

export async function GET(req: NextRequest) {
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

  const clientId = req.nextUrl.searchParams.get("clientId");
  const connections = await listD2CConnectionsForUser(supabase, {
    clientId: clientId || null,
  });

  return NextResponse.json({
    ok: true,
    connections: connections.map((c) => ({ ...c, credentials: null })),
  });
}

export async function POST(req: NextRequest) {
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

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const clientId =
    typeof body.clientId === "string" ? body.clientId.trim() : "";
  const provider = body.provider as D2CProviderName | undefined;
  const credentials =
    body.credentials && typeof body.credentials === "object"
      ? (body.credentials as Record<string, unknown>)
      : null;

  if (!clientId) {
    return NextResponse.json(
      { ok: false, error: "clientId is required" },
      { status: 400 },
    );
  }
  if (!provider || !ALLOWED_PROVIDERS.includes(provider)) {
    return NextResponse.json(
      {
        ok: false,
        error: `provider must be one of: ${ALLOWED_PROVIDERS.join(", ")}`,
      },
      { status: 400 },
    );
  }
  if (!credentials) {
    return NextResponse.json(
      { ok: false, error: "credentials object is required" },
      { status: 400 },
    );
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) {
    return NextResponse.json(
      { ok: false, error: clientErr.message },
      { status: 500 },
    );
  }
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Client not found" },
      { status: 404 },
    );
  }

  const providerImpl = getD2CProvider(provider);
  const validation = await providerImpl.validateCredentials(credentials);
  if (!validation.ok) {
    // While FEATURE_D2C_LIVE is off the providers always return
    // ok:false with a "live mode disabled" message — we still surface
    // a 400 so the dashboard knows nothing was stored. Once the flag
    // is on, this is a real validation result.
    return NextResponse.json(
      {
        ok: false,
        error: validation.error ?? "Provider rejected the credentials.",
      },
      { status: 400 },
    );
  }

  let connection;
  try {
    connection = await upsertD2CConnection(supabase, {
      userId: user.id,
      clientId,
      provider,
      credentials,
      externalAccountId: validation.externalAccountId ?? null,
    });
  } catch (e) {
    if (e instanceof MissingD2CTokenKeyError) {
      return NextResponse.json(
        { ok: false, error: e.message },
        { status: 500 },
      );
    }
    throw e;
  }
  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "Failed to persist the connection." },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { ok: true, connection: { ...connection, credentials: null } },
    { status: 201 },
  );
}
