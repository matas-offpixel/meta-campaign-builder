import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import {
  listConnectionsForUser,
  upsertConnection,
} from "@/lib/db/ticketing";
import { getProvider } from "@/lib/ticketing/registry";
import type { TicketingProviderName } from "@/lib/ticketing/types";

/**
 * /api/ticketing/connections
 *
 * GET ?clientId=X      → list ticketing connections for the current
 *                         user, optionally filtered to a single client.
 * POST { clientId, provider, credentials }
 *                       → validate credentials with the provider, then
 *                         upsert the connection. Bad credentials → 400
 *                         with the provider's error message; nothing is
 *                         written to the DB on failure.
 *
 * RLS does the per-user scoping; we still gate on the cookie session so
 * anonymous traffic doesn't reach Supabase.
 */

const ALLOWED_PROVIDERS: TicketingProviderName[] = [
  "eventbrite",
  "fourthefans",
];

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

  const sp = req.nextUrl.searchParams;
  const clientId = sp.get("clientId");
  const connections = await listConnectionsForUser(supabase, {
    clientId: clientId || null,
  });

  return NextResponse.json({
    ok: true,
    // Strip the credentials blob from the public response — the
    // dashboard never re-reads stored tokens, and we don't want them
    // round-tripping through the browser. Spread + overwrite is cleaner
    // than a destructure-and-discard (which trips no-unused-vars).
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
  const provider = body.provider as TicketingProviderName | undefined;
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

  // Defensive ownership check on the client row so we surface a clean
  // 404 instead of the silent zero-row insert RLS would return.
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

  // Validate the credentials against the provider before persisting.
  // A bad token must never become a stored row — otherwise the cron
  // builds up `last_error` noise on a connection that was never going
  // to work.
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

  const connection = await upsertConnection(supabase, {
    userId: user.id,
    clientId,
    provider,
    credentials,
    externalAccountId: validation.externalAccountId ?? null,
  });

  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "Failed to persist the connection." },
      { status: 500 },
    );
  }

  // Same redaction rule as GET — never echo credentials back.
  return NextResponse.json(
    { ok: true, connection: { ...connection, credentials: null } },
    { status: 201 },
  );
}
